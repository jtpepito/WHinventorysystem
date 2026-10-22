import type { DatabaseSync } from 'node:sqlite';
import { type Actor, InventoryError } from './inventory';
import { ACC, cashAccountFor, isPayMethod, journalEntryFor, nextNumber, type PayMethod, postJournal, reverseJournal } from './ledger';
import { checkMoney, roundMoney } from './money';
import { formatPeso } from './num';
import { assertOpen } from './periods';
import { getSale, listSales, type SaleRow } from './sales';
import { tx } from './sqlite';
import { addDays, isDay, manilaDay, nowIso } from './time';

export type CustomerPaymentInput = { date: string; saleId: number; amount: number; method: PayMethod; refNo?: string; note?: string };
export type CustomerPaymentRow = {
  id: number; number: string; date: string; customerId: number; saleId: number; saleNumber: string; amount: number; method: PayMethod;
  refNo: string; note: string; status: 'posted' | 'void'; voidReason: string | null; voidedAt: string | null; actor: Actor; createdAt: string;
};

// What is still owed on an on-account sale. Cash-type and void sales owe nothing.
export function saleOpenBalance(db: DatabaseSync, saleId: number): number {
  const s = getSale(db, saleId);
  if (!s || s.status === 'void' || s.method !== 'credit') return 0;
  return s.balance;
}

export function postCustomerPayment(db: DatabaseSync, input: CustomerPaymentInput, actor: Actor, at = nowIso()): { id: number; number: string } {
  if (!isDay(input.date)) throw new InventoryError('Pick a valid date.');
  if (!isPayMethod(input.method)) throw new InventoryError('Pick how the customer paid.');
  const amount = checkMoney(input.amount, 'Amount');
  if (amount <= 0) throw new InventoryError('Amount must be more than 0.');
  return tx(db, () => {
    assertOpen(db, input.date);
    const s = getSale(db, input.saleId);
    if (!s) throw new InventoryError('Sale not found.');
    if (s.status === 'void') throw new InventoryError(`${s.number} is void.`);
    if (s.method !== 'credit' || s.customerId === null) throw new InventoryError(`${s.number} is not on account; it was paid when it was made.`);
    if (amount > s.balance + 1e-9) throw new InventoryError(`Only ${formatPeso(s.balance)} is still owed on ${s.number}.`);
    const number = nextNumber(db, 'CR');
    const id = Number(
      db.prepare('INSERT INTO customer_payments (number, date, customer_id, sale_id, amount, method, ref_no, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(number, input.date, s.customerId, s.id, amount, input.method, (input.refNo ?? '').trim().slice(0, 60), (input.note ?? '').trim().slice(0, 200), actor, at).lastInsertRowid,
    );
    postJournal(db, {
      date: input.date, sourceType: 'customer_payment', sourceId: id, memo: `${number} ${s.customerName} for ${s.number}`,
      lines: [{ account: cashAccountFor(input.method), debit: amount }, { account: ACC.ar, credit: amount }],
    }, actor, at);
    return { id, number };
  });
}

export function voidCustomerPayment(db: DatabaseSync, id: number, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  tx(db, () => {
    const p = db.prepare('SELECT number, date, status FROM customer_payments WHERE id = ?').get(id) as { number: string; date: string; status: string } | undefined;
    if (!p) throw new InventoryError('Payment not found.');
    if (p.status === 'void') throw new InventoryError(`${p.number} is already void.`);
    if (why.length < 3) throw new InventoryError('Give a reason for the void.');
    const today = manilaDay(at);
    assertOpen(db, p.date);
    assertOpen(db, today);
    const entry = journalEntryFor(db, 'customer_payment', id);
    if (entry === null) throw new InventoryError(`${p.number} has no journal entry to reverse.`);
    reverseJournal(db, entry, { date: today, sourceType: 'customer_payment_void', sourceId: id, memo: `Void ${p.number}: ${why}` }, actor, at);
    db.prepare("UPDATE customer_payments SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(why, at, id);
  });
}

const PAYMENT_SELECT = `SELECT p.id, p.number, p.date, p.customer_id AS customerId, p.sale_id AS saleId, s.number AS saleNumber, p.amount, p.method,
  p.ref_no AS refNo, p.note, p.status, p.void_reason AS voidReason, p.voided_at AS voidedAt, p.actor, p.created_at AS createdAt
  FROM customer_payments p JOIN sales s ON s.id = p.sale_id`;

export function listCustomerPayments(db: DatabaseSync, f: { customerId?: number; saleId?: number; from?: string; to?: string; limit?: number } = {}): CustomerPaymentRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.customerId) { where.push('p.customer_id = ?'); params.push(f.customerId); }
  if (f.saleId) { where.push('p.sale_id = ?'); params.push(f.saleId); }
  if (isDay(f.from)) { where.push('p.date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('p.date <= ?'); params.push(f.to); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `${PAYMENT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.date DESC, p.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as CustomerPaymentRow[]).map((r) => ({ ...r }));
}

export type AgingRow = { customerId: number; customer: string; current: number; d31_60: number; d61_90: number; d90plus: number; total: number };

// Open balances as of a date, bucketed by the sale's age. Payments dated after asOf don't count yet.
export function arAging(db: DatabaseSync, asOf: string): { rows: AgingRow[]; total: number } {
  const rows = db
    .prepare(
      `SELECT s.customer_id AS customerId, s.customer_name AS customer, s.date,
         s.total - COALESCE((SELECT SUM(p.amount) FROM customer_payments p WHERE p.sale_id = s.id AND p.status = 'posted' AND p.date <= ?), 0) AS open
       FROM sales s WHERE s.status = 'posted' AND s.payment_method = 'credit' AND s.customer_id IS NOT NULL AND s.date <= ?
       ORDER BY s.customer_name, s.date`,
    )
    .all(asOf, asOf) as { customerId: number; customer: string; date: string; open: number }[];
  const byCustomer = new Map<number, AgingRow>();
  for (const r of rows) {
    const open = roundMoney(r.open);
    if (open <= 0) continue;
    const age = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${r.date}T00:00:00Z`)) / 86_400_000);
    const row = byCustomer.get(r.customerId) ?? { customerId: r.customerId, customer: r.customer, current: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
    const bucket: keyof AgingRow = age <= 30 ? 'current' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90plus';
    row[bucket] = roundMoney(row[bucket] + open);
    row.total = roundMoney(row.total + open);
    byCustomer.set(r.customerId, row);
  }
  const out = [...byCustomer.values()];
  return { rows: out, total: roundMoney(out.reduce((s, r) => s + r.total, 0)) };
}

export function customerStatement(db: DatabaseSync, customerId: number, asOf: string): { sales: SaleRow[]; payments: CustomerPaymentRow[]; balance: number } {
  const sales = listSales(db, { customerId, to: asOf, limit: 5000 });
  const payments = listCustomerPayments(db, { customerId, to: asOf, limit: 5000 });
  const balance = roundMoney(sales.filter((s) => s.status === 'posted' && s.method === 'credit').reduce((b, s) => b + s.balance, 0));
  return { sales, payments, balance };
}

export function dueDate(saleDate: string, termsDays: number): string {
  return addDays(saleDate, termsDays);
}
