import type { DatabaseSync } from 'node:sqlite';
import { type Actor, InventoryError } from './inventory';
import { ACC, accountByCode, cashAccountFor, isPayMethod, journalEntryFor, type JournalLineInput, nextNumber, type PayMethod, postJournal, reverseJournal } from './ledger';
import { checkMoney, vatSplit } from './money';
import { assertOpen } from './periods';
import { vatRegistered } from './settings';
import { tx } from './sqlite';
import { isDay, manilaDay, nowIso } from './time';

export type ExpenseInput = { date: string; accountCode: string; payee: string; amount: number; vatInvoice: boolean; method: PayMethod; refNo?: string; note?: string };
export type ExpenseRow = {
  id: number; number: string; date: string; accountCode: string; accountName: string; payee: string; amount: number; vatInput: number; vatInvoice: boolean;
  method: PayMethod; refNo: string; note: string; status: 'posted' | 'void'; voidReason: string | null; voidedAt: string | null; actor: Actor; createdAt: string;
};
export type ExpenseFilter = { from?: string; to?: string; accountCode?: string; status?: 'posted' | 'void'; limit?: number };

// COGS and shrinkage are posted by documents; everything else of type expense is a spendable account.
function expenseAccount(db: DatabaseSync, code: string) {
  let acc;
  try {
    acc = accountByCode(db, code);
  } catch {
    throw new InventoryError('Pick an expense account.');
  }
  if (acc.type !== 'expense' || code === ACC.cogs || code === ACC.shrink) throw new InventoryError('Pick an expense account.');
  if (!acc.active) throw new InventoryError(`Account ${code} ${acc.name} is inactive.`);
  return acc;
}

export function postExpense(db: DatabaseSync, input: ExpenseInput, actor: Actor, at = nowIso()): { id: number; number: string } {
  if (!isDay(input.date)) throw new InventoryError('Pick a valid date.');
  if (!isPayMethod(input.method)) throw new InventoryError('Pick how it was paid.');
  const amount = checkMoney(input.amount, 'Amount');
  if (amount <= 0) throw new InventoryError('Amount must be more than 0.');
  const payee = (input.payee ?? '').trim().slice(0, 120);
  return tx(db, () => {
    assertOpen(db, input.date);
    const acc = expenseAccount(db, input.accountCode);
    const withVat = vatRegistered(db) && input.vatInvoice;
    const { net, vat } = vatSplit(amount, withVat);
    const number = nextNumber(db, 'EXP');
    const id = Number(
      db.prepare(`INSERT INTO expenses (number, date, account_id, payee, amount, vat_input, vat_invoice, method, ref_no, note, actor, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(number, input.date, acc.id, payee, amount, vat, withVat ? 1 : 0, input.method, (input.refNo ?? '').trim().slice(0, 60), (input.note ?? '').trim().slice(0, 200), actor, at).lastInsertRowid,
    );
    const lines: JournalLineInput[] = [
      { account: acc.code, debit: net },
      { account: ACC.inputVat, debit: vat },
      { account: cashAccountFor(input.method), credit: amount },
    ];
    postJournal(db, { date: input.date, sourceType: 'expense', sourceId: id, memo: `${number} ${acc.name}${payee ? ` — ${payee}` : ''}`, lines }, actor, at);
    return { id, number };
  });
}

export function voidExpense(db: DatabaseSync, id: number, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  tx(db, () => {
    const e = db.prepare('SELECT number, date, status FROM expenses WHERE id = ?').get(id) as { number: string; date: string; status: string } | undefined;
    if (!e) throw new InventoryError('Expense not found.');
    if (e.status === 'void') throw new InventoryError(`${e.number} is already void.`);
    if (why.length < 3) throw new InventoryError('Give a reason for the void.');
    const today = manilaDay(at);
    assertOpen(db, e.date);
    assertOpen(db, today);
    const entry = journalEntryFor(db, 'expense', id);
    if (entry === null) throw new InventoryError(`${e.number} has no journal entry to reverse.`);
    reverseJournal(db, entry, { date: today, sourceType: 'expense_void', sourceId: id, memo: `Void ${e.number}: ${why}` }, actor, at);
    db.prepare("UPDATE expenses SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ?").run(why, at, id);
  });
}

const EXPENSE_SELECT = `SELECT e.id, e.number, e.date, a.code AS accountCode, a.name AS accountName, e.payee, e.amount, e.vat_input AS vatInput, e.vat_invoice AS vatInvoice,
    e.method, e.ref_no AS refNo, e.note, e.status, e.void_reason AS voidReason, e.voided_at AS voidedAt, e.actor, e.created_at AS createdAt
  FROM expenses e JOIN accounts a ON a.id = e.account_id`;

export function listExpenses(db: DatabaseSync, f: ExpenseFilter = {}): ExpenseRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (isDay(f.from)) { where.push('e.date >= ?'); params.push(f.from); }
  if (isDay(f.to)) { where.push('e.date <= ?'); params.push(f.to); }
  if (f.accountCode) { where.push('a.code = ?'); params.push(f.accountCode); }
  if (f.status) { where.push('e.status = ?'); params.push(f.status); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `${EXPENSE_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY e.date DESC, e.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as (Omit<ExpenseRow, 'vatInvoice'> & { vatInvoice: number })[]).map((r) => ({ ...r, vatInvoice: r.vatInvoice === 1 }));
}

// Net (ex-VAT) spend per expense account for posted expenses in a date range.
export function expenseTotalsByAccount(db: DatabaseSync, from: string, to: string): { code: string; name: string; amount: number }[] {
  return (db
    .prepare(
      `SELECT a.code, a.name, ROUND(SUM(e.amount - e.vat_input), 2) AS amount FROM expenses e JOIN accounts a ON a.id = e.account_id
       WHERE e.status = 'posted' AND e.date >= ? AND e.date <= ? GROUP BY a.id ORDER BY a.code`,
    )
    .all(from, to) as { code: string; name: string; amount: number }[]).map((r) => ({ ...r }));
}
