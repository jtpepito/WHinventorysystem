import type { DatabaseSync } from 'node:sqlite';
import { type Actor, InventoryError } from './inventory';
import { roundMoney } from './money';
import { formatPeso } from './num';
import { assertOpen } from './periods';
import { tx } from './sqlite';
import { nowIso } from './time';

export const ACC = {
  cash: '1010', gcash: '1020', bank: '1030', ar: '1100', inventory: '1200', inputVat: '1300',
  ap: '2100', outputVat: '2200',
  capital: '3100', drawings: '3200', retained: '3900',
  sales: '4100', returns: '4200',
  cogs: '5100', shrink: '5200',
} as const;

// Posted only by documents (sales, purchases, payments, counts); manual entries may not touch them.
export const CONTROLLED: string[] = [ACC.ar, ACC.inventory, ACC.ap];

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];
export type AccountRow = { id: number; code: string; name: string; type: AccountType; system: boolean; active: boolean };
export type PayMethod = 'cash' | 'gcash' | 'bank';
export const PAY_METHODS: PayMethod[] = ['cash', 'gcash', 'bank'];
export type JournalLineInput = { account: string; debit?: number; credit?: number };
export type NumberPrefix = 'SI' | 'CR' | 'PUR' | 'PV' | 'EXP' | 'JE';

const CHART: [string, string, AccountType][] = [
  ['1010', 'Cash on hand', 'asset'], ['1020', 'GCash', 'asset'], ['1030', 'Bank', 'asset'],
  ['1100', 'Accounts receivable', 'asset'], ['1200', 'Inventory', 'asset'], ['1300', 'Input VAT', 'asset'],
  ['2100', 'Accounts payable', 'liability'], ['2200', 'Output VAT payable', 'liability'],
  ['3100', "Owner's capital", 'equity'], ['3200', "Owner's drawings", 'equity'], ['3900', 'Retained earnings', 'equity'],
  ['4100', 'Sales', 'income'], ['4200', 'Sales returns', 'income'],
  ['5100', 'Cost of goods sold', 'expense'], ['5200', 'Inventory shrinkage / adjustments', 'expense'],
  ['6100', 'Rent', 'expense'], ['6200', 'Salaries & wages', 'expense'], ['6300', 'Utilities', 'expense'],
  ['6400', 'Transport & delivery', 'expense'], ['6500', 'Supplies', 'expense'], ['6600', 'Repairs & maintenance', 'expense'],
  ['6900', 'Other expenses', 'expense'],
];

export function cashAccountFor(m: PayMethod): string {
  return m === 'cash' ? ACC.cash : m === 'gcash' ? ACC.gcash : ACC.bank;
}

export function isPayMethod(s: unknown): s is PayMethod {
  return s === 'cash' || s === 'gcash' || s === 'bank';
}

// Idempotent: codes below 6000 are system accounts, the 6xxx expense accounts are editable.
export function seedChart(db: DatabaseSync): void {
  const insert = db.prepare('INSERT OR IGNORE INTO accounts (code, name, type, system) VALUES (?, ?, ?, ?)');
  for (const [code, name, type] of CHART) insert.run(code, name, type, code < '6000' ? 1 : 0);
}

type RawAccount = Omit<AccountRow, 'system' | 'active'> & { system: number; active: number };
const toAccount = (r: RawAccount): AccountRow => ({ ...r, system: r.system === 1, active: r.active === 1 });

export function listAccounts(db: DatabaseSync, opts: { type?: AccountType; activeOnly?: boolean } = {}): AccountRow[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.type) { where.push('type = ?'); params.push(opts.type); }
  if (opts.activeOnly) where.push('active = 1');
  const sql = `SELECT id, code, name, type, system, active FROM accounts${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY code`;
  return (db.prepare(sql).all(...params) as RawAccount[]).map(toAccount);
}

export function accountByCode(db: DatabaseSync, code: string): AccountRow {
  const r = db.prepare('SELECT id, code, name, type, system, active FROM accounts WHERE code = ?').get(code) as RawAccount | undefined;
  if (!r) throw new InventoryError(`Account ${code} does not exist.`);
  return toAccount(r);
}

export function addAccount(db: DatabaseSync, a: { code: string; name: string; type: AccountType }): number {
  const code = a.code.trim();
  if (!/^\d{4}$/.test(code)) throw new InventoryError('Account code must be 4 digits.');
  const name = a.name.trim();
  if (!name) throw new InventoryError('Account name is required.');
  if (!ACCOUNT_TYPES.includes(a.type)) throw new InventoryError('Pick an account type.');
  if (db.prepare('SELECT 1 FROM accounts WHERE code = ?').get(code)) throw new InventoryError(`Account ${code} already exists.`);
  return Number(db.prepare('INSERT INTO accounts (code, name, type, system) VALUES (?, ?, ?, 0)').run(code, name, a.type).lastInsertRowid);
}

// System accounts can be renamed but never deactivated: the postings depend on them.
export function updateAccount(db: DatabaseSync, id: number, u: { name: string; active: boolean }): void {
  const row = db.prepare('SELECT system FROM accounts WHERE id = ?').get(id) as { system: number } | undefined;
  if (!row) throw new InventoryError('Account not found.');
  const name = u.name.trim();
  if (!name) throw new InventoryError('Account name is required.');
  const active = row.system === 1 ? 1 : u.active ? 1 : 0;
  db.prepare('UPDATE accounts SET name = ?, active = ? WHERE id = ?').run(name, active, id);
}

export function nextNumber(db: DatabaseSync, prefix: NumberPrefix): string {
  return tx(db, () => {
    const row = db.prepare('SELECT next FROM counters WHERE name = ?').get(prefix) as { next: number } | undefined;
    const n = row?.next ?? 1;
    db.prepare('INSERT INTO counters (name, next) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next = excluded.next').run(prefix, n + 1);
    return `${prefix}-${String(n).padStart(6, '0')}`;
  });
}

type CleanLine = { accountId: number; debit: number; credit: number };

function cleanLines(db: DatabaseSync, lines: JournalLineInput[]): CleanLine[] {
  const out: CleanLine[] = [];
  for (const l of lines) {
    const debit = roundMoney(l.debit ?? 0);
    const credit = roundMoney(l.credit ?? 0);
    if (debit < 0 || credit < 0 || (debit > 0 && credit > 0)) throw new InventoryError(`Account ${l.account}: a line is either a debit or a credit.`);
    if (debit === 0 && credit === 0) continue;
    const acc = db.prepare('SELECT id, active FROM accounts WHERE code = ?').get(l.account) as { id: number; active: number } | undefined;
    if (!acc) throw new InventoryError(`Account ${l.account} does not exist.`);
    if (!acc.active) throw new InventoryError(`Account ${l.account} is inactive.`);
    out.push({ accountId: acc.id, debit, credit });
  }
  if (out.length < 2) throw new InventoryError('A journal entry needs at least two lines.');
  const dr = roundMoney(out.reduce((s, l) => s + l.debit, 0));
  const cr = roundMoney(out.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(dr - cr) > 0.005) throw new InventoryError(`Journal entry does not balance: debits ${formatPeso(dr)}, credits ${formatPeso(cr)}.`);
  return out;
}

export type JournalInput = { date: string; sourceType: string; sourceId: number | null; memo: string; lines: JournalLineInput[] };

export function postJournal(db: DatabaseSync, e: JournalInput, actor: Actor, at = nowIso()): number {
  return tx(db, () => {
    assertOpen(db, e.date);
    const lines = cleanLines(db, e.lines);
    const id = Number(
      db.prepare('INSERT INTO journal_entries (entry_no, date, source_type, source_id, memo, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(nextNumber(db, 'JE'), e.date, e.sourceType, e.sourceId, e.memo.slice(0, 200), actor, at).lastInsertRowid,
    );
    const insert = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)');
    for (const l of lines) insert.run(id, l.accountId, l.debit, l.credit);
    return id;
  });
}

export function reverseJournal(db: DatabaseSync, entryId: number, r: { date: string; sourceType: string; sourceId: number | null; memo: string }, actor: Actor, at = nowIso()): number {
  const lines = db
    .prepare('SELECT a.code AS account, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id')
    .all(entryId) as { account: string; debit: number; credit: number }[];
  if (lines.length === 0) throw new InventoryError('Journal entry not found.');
  return postJournal(db, { ...r, lines: lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit })) }, actor, at);
}

// Signed by the account's natural side: assets/expenses grow with debits, the rest with credits.
export function accountBalance(db: DatabaseSync, code: string, opts: { through?: string; from?: string } = {}): number {
  const acc = accountByCode(db, code);
  const where: string[] = ['l.account_id = ?'];
  const params: (string | number)[] = [acc.id];
  if (opts.from) { where.push('e.date >= ?'); params.push(opts.from); }
  if (opts.through) { where.push('e.date <= ?'); params.push(opts.through); }
  const r = db
    .prepare(`SELECT COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id WHERE ${where.join(' AND ')}`)
    .get(...params) as { dr: number; cr: number };
  return roundMoney(acc.type === 'asset' || acc.type === 'expense' ? r.dr - r.cr : r.cr - r.dr);
}

export function assertNotControlled(lines: JournalLineInput[]): void {
  if (lines.some((l) => CONTROLLED.includes(l.account))) {
    throw new InventoryError('Accounts receivable, Inventory and Accounts payable are posted by sales, purchases and payments; use those screens.');
  }
}

export function journalEntryFor(db: DatabaseSync, sourceType: string, sourceId: number): number | null {
  const r = db.prepare('SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ? ORDER BY id LIMIT 1').get(sourceType, sourceId) as { id: number } | undefined;
  return r?.id ?? null;
}
