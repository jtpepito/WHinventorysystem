import type { DatabaseSync } from 'node:sqlite';
import { type Actor, checkCost, checkQty, InventoryError, postAdjustment, postReceipt, type ReceiptLine } from './inventory';
import { ACC, cashAccountFor, isPayMethod, journalEntryFor, type JournalLineInput, nextNumber, type PayMethod, postJournal, reverseJournal } from './ledger';
import { checkMoney, roundMoney, VAT_RATE, vatSplit } from './money';
import { formatPeso, formatQty, round } from './num';
import { assertOpen } from './periods';
import { vatRegistered } from './settings';
import { tx } from './sqlite';
import { isDay, manilaDay, nowIso } from './time';

export type PurchaseMethod = PayMethod | 'credit';
export const isPurchaseMethod = (s: unknown): s is PurchaseMethod => isPayMethod(s) || s === 'credit';
export type PurchaseInput = { date: string; supplierId: number; refNo: string; method: PurchaseMethod; vatInvoice: boolean; note?: string; lines: ReceiptLine[] };
export type PurchaseLineView = { movementId: number; itemId: number; sku: string; name: string; unit: string; qty: number; unitCost: number; lineTotal: number };
export type PurchaseRow = {
  id: number; number: string; date: string; supplierId: number | null; supplierName: string; refNo: string; method: PurchaseMethod;
  subtotal: number; vat: number; total: number; vatInvoice: boolean; note: string; status: 'posted' | 'void'; voidReason: string | null; voidedAt: string | null;
  actor: Actor; createdAt: string; paid: number; balance: number;
};
export type PurchaseView = PurchaseRow & { lines: PurchaseLineView[]; journalEntryId: number | null };
export type PurchaseFilter = { from?: string; to?: string; supplierId?: number; method?: PurchaseMethod; status?: 'posted' | 'void'; limit?: number };

export function postPurchase(db: DatabaseSync, input: PurchaseInput, actor: Actor, at = nowIso()): { id: number; number: string; total: number } {
  if (!isDay(input.date)) throw new InventoryError('Pick a valid date.');
  if (!isPurchaseMethod(input.method)) throw new InventoryError('Pick how it was paid.');
  const refNo = (input.refNo ?? '').trim();
  if (!refNo) throw new InventoryError('Supplier invoice no. is required.');
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  const note = (input.note ?? '').trim().slice(0, 200);
  return tx(db, () => {
    assertOpen(db, input.date);
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(input.supplierId) as { name: string } | undefined;
    if (!supplier) throw new InventoryError('Pick a supplier.');
    const withVat = vatRegistered(db) && input.vatInvoice;
    // Gross as printed on the invoice; with a VAT invoice the recoverable VAT is kept out of stock cost.
    const lines = input.lines.map((l, i) => {
      const label = l.label ?? `Line ${i + 1}`;
      const qty = checkQty(l.qty, label);
      const gross = checkCost(l.unitCost, label);
      const unitCost = withVat ? round(gross / (1 + VAT_RATE), 4) : gross;
      return { itemId: l.itemId, qty, unitCost, lineTotal: roundMoney(qty * gross), label };
    });
    const total = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
    const { net, vat } = vatSplit(total, withVat);
    const number = nextNumber(db, 'PUR');
    const id = Number(
      db.prepare(`INSERT INTO purchases (number, date, supplier_id, supplier_name, ref_no, payment_method, subtotal, vat, total, vat_invoice, note, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(number, input.date, input.supplierId, supplier.name, refNo, input.method, net, vat, total, withVat ? 1 : 0, note, actor, at).lastInsertRowid,
    );
    postReceipt(db, { supplierId: input.supplierId, refNo: number, note: note || `Supplier invoice ${refNo}`, purchaseId: id, lines: lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitCost: l.unitCost, label: l.label })) }, actor, at);
    const journal: JournalLineInput[] = [
      { account: ACC.inventory, debit: net },
      { account: ACC.inputVat, debit: vat },
      { account: input.method === 'credit' ? ACC.ap : cashAccountFor(input.method), credit: total },
    ];
    postJournal(db, { date: input.date, sourceType: 'purchase', sourceId: id, memo: `${number} ${supplier.name} inv ${refNo}`, lines: journal }, actor, at);
    return { id, number, total };
  });
}

export function voidPurchase(db: DatabaseSync, id: number, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  tx(db, () => {
    const p = getPurchase(db, id);
    if (!p) throw new InventoryError('Purchase not found.');
    if (p.status === 'void') throw new InventoryError(`${p.number} is already void.`);
    if (why.length < 3) throw new InventoryError('Give a reason for the void.');
    const payments = db.prepare("SELECT COUNT(*) AS n FROM supplier_payments WHERE purchase_id = ? AND status = 'posted'").get(id) as { n: number };
    if (payments.n > 0) throw new InventoryError('Void the payment(s) first.');
    const today = manilaDay(at);
    assertOpen(db, p.date);
    assertOpen(db, today);
    for (const l of p.lines) {
      const onHand = (db.prepare('SELECT qty FROM items WHERE id = ?').get(l.itemId) as { qty: number }).qty;
      if (onHand + 1e-9 < l.qty) {
        throw new InventoryError(`${l.sku} has only ${formatQty(onHand)} on hand; ${formatQty(l.qty)} were received on this purchase. Adjust stock first.`);
      }
    }
    for (const l of p.lines) {
      postAdjustment(db, { itemId: l.itemId, qtyDelta: -l.qty, refNo: p.number, note: `Void ${p.number}`, unitCost: l.unitCost, purchaseId: id }, actor, at);
    }
    const entry = journalEntryFor(db, 'purchase', id);
    if (entry === null) throw new InventoryError(`${p.number} has no journal entry to reverse.`);
    reverseJournal(db, entry, { date: today, sourceType: 'purchase_void', sourceId: id, memo: `Void ${p.number}: ${why}` }, actor, at);
    db.prepare("UPDATE purchases SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(why, at, id);
  });
}

const PURCHASE_SELECT = `SELECT p.id, p.number, p.date, p.supplier_id AS supplierId, p.supplier_name AS supplierName, p.ref_no AS refNo, p.payment_method AS method,
    p.subtotal, p.vat, p.total, p.vat_invoice AS vatInvoice, p.note, p.status, p.void_reason AS voidReason, p.voided_at AS voidedAt, p.actor, p.created_at AS createdAt,
    COALESCE((SELECT SUM(s.amount) FROM supplier_payments s WHERE s.purchase_id = p.id AND s.status = 'posted'), 0) AS paid
  FROM purchases p`;

type RawPurchase = Omit<PurchaseRow, 'vatInvoice' | 'balance'> & { vatInvoice: number };

function finish(r: RawPurchase): PurchaseRow {
  const paid = r.method === 'credit' ? roundMoney(r.paid) : r.total;
  const balance = r.status === 'void' ? 0 : roundMoney(r.total - paid);
  return { ...r, vatInvoice: r.vatInvoice === 1, paid: r.status === 'void' ? 0 : paid, balance };
}

export function getPurchase(db: DatabaseSync, id: number): PurchaseView | null {
  const r = db.prepare(`${PURCHASE_SELECT} WHERE p.id = ?`).get(id) as RawPurchase | undefined;
  if (!r) return null;
  const withVat = r.vatInvoice === 1;
  const lines = (db
    .prepare(`SELECT m.id AS movementId, m.item_id AS itemId, i.sku, i.name, u.name AS unit, m.qty_delta AS qty, m.unit_cost AS unitCost
      FROM movements m JOIN items i ON i.id = m.item_id JOIN units u ON u.id = i.unit_id WHERE m.purchase_id = ? AND m.type = 'receive' ORDER BY m.id`)
    .all(id) as Omit<PurchaseLineView, 'lineTotal'>[]).map((l) => ({ ...l, lineTotal: roundMoney(l.qty * (withVat ? l.unitCost * (1 + VAT_RATE) : l.unitCost)) }));
  return { ...finish({ ...r }), lines, journalEntryId: journalEntryFor(db, 'purchase', id) };
}

export function listPurchases(db: DatabaseSync, f: PurchaseFilter = {}): PurchaseRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (isDay(f.from)) { where.push('p.date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('p.date <= ?'); params.push(f.to); }
  if (f.supplierId) { where.push('p.supplier_id = ?'); params.push(f.supplierId); }
  if (f.method) { where.push('p.payment_method = ?'); params.push(f.method); }
  if (f.status) { where.push('p.status = ?'); params.push(f.status); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `${PURCHASE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.date DESC, p.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as RawPurchase[]).map((r) => finish({ ...r }));
}

export function purchaseOpenBalance(db: DatabaseSync, purchaseId: number): number {
  const p = getPurchase(db, purchaseId);
  if (!p || p.status === 'void' || p.method !== 'credit') return 0;
  return p.balance;
}

export type SupplierPaymentInput = { date: string; purchaseId: number; amount: number; method: PayMethod; refNo?: string; note?: string };
export type SupplierPaymentRow = {
  id: number; number: string; date: string; supplierId: number | null; purchaseId: number; purchaseNumber: string; amount: number; method: PayMethod;
  refNo: string; note: string; status: 'posted' | 'void'; voidReason: string | null; voidedAt: string | null; actor: Actor; createdAt: string;
};

export function postSupplierPayment(db: DatabaseSync, input: SupplierPaymentInput, actor: Actor, at = nowIso()): { id: number; number: string } {
  if (!isDay(input.date)) throw new InventoryError('Pick a valid date.');
  if (!isPayMethod(input.method)) throw new InventoryError('Pick how it was paid.');
  const amount = checkMoney(input.amount, 'Amount');
  if (amount <= 0) throw new InventoryError('Amount must be more than 0.');
  return tx(db, () => {
    assertOpen(db, input.date);
    const p = getPurchase(db, input.purchaseId);
    if (!p) throw new InventoryError('Purchase not found.');
    if (p.status === 'void') throw new InventoryError(`${p.number} is void.`);
    if (p.method !== 'credit') throw new InventoryError(`${p.number} is not on account; it was paid when it was received.`);
    if (amount > p.balance + 1e-9) throw new InventoryError(`Only ${formatPeso(p.balance)} is still owed on ${p.number}.`);
    const number = nextNumber(db, 'PV');
    const id = Number(
      db.prepare('INSERT INTO supplier_payments (number, date, supplier_id, purchase_id, amount, method, ref_no, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(number, input.date, p.supplierId, p.id, amount, input.method, (input.refNo ?? '').trim().slice(0, 60), (input.note ?? '').trim().slice(0, 200), actor, at).lastInsertRowid,
    );
    postJournal(db, {
      date: input.date, sourceType: 'supplier_payment', sourceId: id, memo: `${number} ${p.supplierName} for ${p.number}`,
      lines: [{ account: ACC.ap, debit: amount }, { account: cashAccountFor(input.method), credit: amount }],
    }, actor, at);
    return { id, number };
  });
}

export function voidSupplierPayment(db: DatabaseSync, id: number, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  tx(db, () => {
    const p = db.prepare('SELECT number, date, status FROM supplier_payments WHERE id = ?').get(id) as { number: string; date: string; status: string } | undefined;
    if (!p) throw new InventoryError('Payment not found.');
    if (p.status === 'void') throw new InventoryError(`${p.number} is already void.`);
    if (why.length < 3) throw new InventoryError('Give a reason for the void.');
    const today = manilaDay(at);
    assertOpen(db, p.date);
    assertOpen(db, today);
    const entry = journalEntryFor(db, 'supplier_payment', id);
    if (entry === null) throw new InventoryError(`${p.number} has no journal entry to reverse.`);
    reverseJournal(db, entry, { date: today, sourceType: 'supplier_payment_void', sourceId: id, memo: `Void ${p.number}: ${why}` }, actor, at);
    db.prepare("UPDATE supplier_payments SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(why, at, id);
  });
}

export function listSupplierPayments(db: DatabaseSync, f: { supplierId?: number; purchaseId?: number; from?: string; to?: string; limit?: number } = {}): SupplierPaymentRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.supplierId) { where.push('s.supplier_id = ?'); params.push(f.supplierId); }
  if (f.purchaseId) { where.push('s.purchase_id = ?'); params.push(f.purchaseId); }
  if (isDay(f.from)) { where.push('s.date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('s.date <= ?'); params.push(f.to); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `SELECT s.id, s.number, s.date, s.supplier_id AS supplierId, s.purchase_id AS purchaseId, p.number AS purchaseNumber, s.amount, s.method,
      s.ref_no AS refNo, s.note, s.status, s.void_reason AS voidReason, s.voided_at AS voidedAt, s.actor, s.created_at AS createdAt
    FROM supplier_payments s JOIN purchases p ON p.id = s.purchase_id${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY s.date DESC, s.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as SupplierPaymentRow[]).map((r) => ({ ...r }));
}

export type ApAgingRow = { supplierId: number | null; supplier: string; current: number; d31_60: number; d61_90: number; d90plus: number; total: number };

export function apAging(db: DatabaseSync, asOf: string): { rows: ApAgingRow[]; total: number } {
  const rows = db
    .prepare(
      `SELECT p.supplier_id AS supplierId, p.supplier_name AS supplier, p.date,
         p.total - COALESCE((SELECT SUM(s.amount) FROM supplier_payments s WHERE s.purchase_id = p.id AND s.status = 'posted' AND s.date <= ?), 0) AS open
       FROM purchases p WHERE p.status = 'posted' AND p.payment_method = 'credit' AND p.date <= ?
       ORDER BY p.supplier_name, p.date`,
    )
    .all(asOf, asOf) as { supplierId: number | null; supplier: string; date: string; open: number }[];
  const bySupplier = new Map<string, ApAgingRow>();
  for (const r of rows) {
    const open = roundMoney(r.open);
    if (open <= 0) continue;
    const age = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000);
    const key = `${r.supplierId ?? r.supplier}`;
    const row = bySupplier.get(key) ?? { supplierId: r.supplierId, supplier: r.supplier, current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const bucket: 'current' | 'd31_60' | 'd61_90' | 'd90plus' = age <= 30 ? 'current' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90plus';
    row[bucket] = roundMoney(row[bucket] + open);
    row.total = roundMoney(row.total + open);
    bySupplier.set(key, row);
  }
  const out = [...bySupplier.values()];
  return { rows: out, total: roundMoney(out.reduce((s, r) => s + r.total, 0)) };
}
