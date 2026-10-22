import type { DatabaseSync } from 'node:sqlite';
import { getCustomer, WALK_IN } from './customers';
import { type Actor, checkQty, InventoryError, postAdjustment, postRelease } from './inventory';
import { ACC, cashAccountFor, journalEntryFor, type JournalLineInput, nextNumber, type PayMethod, postJournal, reverseJournal } from './ledger';
import { checkMoney, roundMoney, vatSplit } from './money';
import { assertOpen } from './periods';
import { vatRegistered } from './settings';
import { tx } from './sqlite';
import { isDay, manilaDay, nowIso } from './time';

export type SaleMethod = PayMethod | 'credit';
export const SALE_METHODS: SaleMethod[] = ['cash', 'gcash', 'bank', 'credit'];
export const isSaleMethod = (s: unknown): s is SaleMethod => (SALE_METHODS as unknown[]).includes(s);
export const SALE_METHOD_LABEL: Record<SaleMethod, string> = { cash: 'Cash', gcash: 'GCash', bank: 'Bank', credit: 'On account' };

export type SaleLineInput = { itemId: number; qty: number; unitPrice: number; label?: string };
export type SaleInput = { date: string; customerId: number | null; method: SaleMethod; note?: string; lines: SaleLineInput[] };

export type SaleLineView = { id: number; itemId: number; sku: string; name: string; unit: string; qty: number; unitPrice: number; lineTotal: number; unitCost: number };
export type SaleRow = {
  id: number; number: string; date: string; customerId: number | null; customerName: string; method: SaleMethod;
  subtotal: number; vat: number; total: number; cogs: number; note: string; status: 'posted' | 'void'; voidReason: string | null; voidedAt: string | null;
  actor: Actor; createdAt: string; paid: number; balance: number;
};
export type SaleView = SaleRow & { lines: SaleLineView[]; journalEntryId: number | null; voidEntryId: number | null };
export type SaleFilter = { from?: string; to?: string; customerId?: number; method?: SaleMethod; status?: 'posted' | 'void'; limit?: number };

function checkDate(date: string): string {
  if (!isDay(date)) throw new InventoryError('Pick a valid date.');
  return date;
}

export function postSale(db: DatabaseSync, input: SaleInput, actor: Actor, at = nowIso()): { id: number; number: string; total: number } {
  const date = checkDate(input.date);
  if (!isSaleMethod(input.method)) throw new InventoryError('Pick a payment method.');
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  const note = (input.note ?? '').trim().slice(0, 200);
  return tx(db, () => {
    assertOpen(db, date);
    let customerName = WALK_IN;
    if (input.customerId !== null) {
      const c = getCustomer(db, input.customerId);
      if (!c) throw new InventoryError('Customer not found.');
      if (!c.active) throw new InventoryError(`${c.name} is inactive.`);
      customerName = c.name;
    } else if (input.method === 'credit') {
      throw new InventoryError('On-account sales need a customer.');
    }
    const lines = input.lines.map((l, i) => {
      const label = l.label ?? `Line ${i + 1}`;
      const qty = checkQty(l.qty, label);
      const unitPrice = checkMoney(l.unitPrice, `${label}: price`);
      return { itemId: l.itemId, qty, unitPrice, lineTotal: roundMoney(qty * unitPrice), label };
    });
    const total = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
    const { net, vat } = vatSplit(total, vatRegistered(db));
    // Cost of goods is fixed before the header is written (the void-only trigger forbids updating it later).
    // Releases never change avg cost, so this is exactly the unit cost postRelease will record.
    const costed = lines.map((l) => {
      const item = db.prepare('SELECT avg_cost FROM items WHERE id = ?').get(l.itemId) as { avg_cost: number } | undefined;
      if (!item) throw new InventoryError(`${l.label}: item not found.`);
      return { ...l, unitCost: item.avg_cost };
    });
    const cogs = roundMoney(costed.reduce((s, l) => s + l.qty * l.unitCost, 0));
    const number = nextNumber(db, 'SI');
    const id = Number(
      db.prepare(`INSERT INTO sales (number, date, customer_id, customer_name, payment_method, subtotal, vat, total, cogs, note, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(number, date, input.customerId, customerName, input.method, net, vat, total, cogs, note, actor, at).lastInsertRowid,
    );
    // postRelease enforces the over-release block (totals per item across lines) and writes the movements.
    postRelease(db, { counterparty: customerName, refNo: number, note, saleId: id, lines: costed.map((l) => ({ itemId: l.itemId, qty: l.qty, label: l.label })) }, actor, at);
    const insertLine = db.prepare('INSERT INTO sale_lines (sale_id, item_id, qty, unit_price, line_total, unit_cost) VALUES (?, ?, ?, ?, ?, ?)');
    for (const l of costed) insertLine.run(id, l.itemId, l.qty, l.unitPrice, l.lineTotal, l.unitCost);
    const journal: JournalLineInput[] = [
      { account: input.method === 'credit' ? ACC.ar : cashAccountFor(input.method), debit: total },
      { account: ACC.sales, credit: net },
      { account: ACC.outputVat, credit: vat },
      { account: ACC.cogs, debit: cogs },
      { account: ACC.inventory, credit: cogs },
    ];
    postJournal(db, { date, sourceType: 'sale', sourceId: id, memo: `${number} ${customerName}`, lines: journal }, actor, at);
    return { id, number, total };
  });
}

export function voidSale(db: DatabaseSync, id: number, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  tx(db, () => {
    const s = getSale(db, id);
    if (!s) throw new InventoryError('Sale not found.');
    if (s.status === 'void') throw new InventoryError(`${s.number} is already void.`);
    if (why.length < 3) throw new InventoryError('Give a reason for the void.');
    // Real recorded payments only — a cash sale shows paid = total but has no payment rows to void.
    const payments = db.prepare("SELECT COUNT(*) AS n FROM customer_payments WHERE sale_id = ? AND status = 'posted'").get(id) as { n: number };
    if (payments.n > 0) throw new InventoryError('Void the payment(s) first.');
    const today = manilaDay(at);
    assertOpen(db, s.date);
    assertOpen(db, today);
    for (const l of s.lines) {
      postAdjustment(db, { itemId: l.itemId, qtyDelta: l.qty, refNo: s.number, note: `Void ${s.number}`, unitCost: l.unitCost, saleId: id }, actor, at);
    }
    const entry = journalEntryFor(db, 'sale', id);
    if (entry === null) throw new InventoryError(`${s.number} has no journal entry to reverse.`);
    reverseJournal(db, entry, { date: today, sourceType: 'sale_void', sourceId: id, memo: `Void ${s.number}: ${why}` }, actor, at);
    db.prepare("UPDATE sales SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(why, at, id);
  });
}

const SALE_SELECT = `SELECT s.id, s.number, s.date, s.customer_id AS customerId, s.customer_name AS customerName, s.payment_method AS method,
    s.subtotal, s.vat, s.total, s.cogs, s.note, s.status, s.void_reason AS voidReason, s.voided_at AS voidedAt, s.actor, s.created_at AS createdAt,
    COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.sale_id = s.id AND p.status = 'posted'), 0) AS paid
  FROM sales s`;

function finish(r: Omit<SaleRow, 'balance'>): SaleRow {
  // Cash-type sales are settled on the spot; only on-account sales carry a balance.
  const paid = r.method === 'credit' ? roundMoney(r.paid) : r.total;
  const balance = r.status === 'void' ? 0 : roundMoney(r.total - paid);
  return { ...r, paid: r.status === 'void' ? 0 : paid, balance };
}

export function getSale(db: DatabaseSync, id: number): SaleView | null {
  const r = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(id) as Omit<SaleRow, 'balance'> | undefined;
  if (!r) return null;
  const lines = (db
    .prepare(`SELECT l.id, l.item_id AS itemId, i.sku, i.name, u.name AS unit, l.qty, l.unit_price AS unitPrice, l.line_total AS lineTotal, l.unit_cost AS unitCost
      FROM sale_lines l JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id WHERE l.sale_id = ? ORDER BY l.id`)
    .all(id) as SaleLineView[]).map((l) => ({ ...l }));
  return { ...finish({ ...r }), lines, journalEntryId: journalEntryFor(db, 'sale', id), voidEntryId: journalEntryFor(db, 'sale_void', id) };
}

export function listSales(db: DatabaseSync, f: SaleFilter = {}): SaleRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (isDay(f.from)) { where.push('s.date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('s.date <= ?'); params.push(f.to); }
  if (f.customerId) { where.push('s.customer_id = ?'); params.push(f.customerId); }
  if (f.method) { where.push('s.payment_method = ?'); params.push(f.method); }
  if (f.status) { where.push('s.status = ?'); params.push(f.status); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `${SALE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY s.date DESC, s.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as Omit<SaleRow, 'balance'>[]).map((r) => finish({ ...r }));
}

export function salesTotals(db: DatabaseSync, f: Omit<SaleFilter, 'limit' | 'status'> = {}): { count: number; total: number; cogs: number; vat: number } {
  const where: string[] = ["status = 'posted'"];
  const params: (string | number)[] = [];
  if (isDay(f.from)) { where.push('date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('date <= ?'); params.push(f.to); }
  if (f.customerId) { where.push('customer_id = ?'); params.push(f.customerId); }
  if (f.method) { where.push('payment_method = ?'); params.push(f.method); }
  const r = db
    .prepare(`SELECT COUNT(*) AS count, ROUND(COALESCE(SUM(total), 0), 2) AS total, ROUND(COALESCE(SUM(cogs), 0), 2) AS cogs, ROUND(COALESCE(SUM(vat), 0), 2) AS vat FROM sales WHERE ${where.join(' AND ')}`)
    .get(...params) as { count: number; total: number; cogs: number; vat: number };
  return { ...r };
}
