import type { DatabaseSync } from 'node:sqlite';
import { ACC, accountBalance, type AccountRow, type AccountType, listAccounts } from './ledger';
import { roundMoney } from './money';
import { addDays } from './time';

export type Range = { from: string; to: string }; // inclusive Manila days
export type Line = { code: string; name: string; amount: number };

const DEBIT_SIDE: AccountType[] = ['asset', 'expense'];
const natural = (type: AccountType, dr: number, cr: number) => roundMoney(DEBIT_SIDE.includes(type) ? dr - cr : cr - dr);

// Σdebit / Σcredit per account over a date window, in one query.
function sums(db: DatabaseSync, opts: { from?: string; through?: string; documentsOnly?: boolean }): Map<string, { dr: number; cr: number }> {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.from) { where.push('e.date >= ?'); params.push(opts.from); }
  if (opts.through) { where.push('e.date <= ?'); params.push(opts.through); }
  if (opts.documentsOnly) where.push("e.source_type <> 'manual'");
  const rows = db
    .prepare(`SELECT a.code, COALESCE(SUM(l.debit), 0) AS dr, COALESCE(SUM(l.credit), 0) AS cr FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id${where.length ? ` WHERE ${where.join(' AND ')}` : ''} GROUP BY a.code`)
    .all(...params) as { code: string; dr: number; cr: number }[];
  return new Map(rows.map((r) => [r.code, { dr: r.dr, cr: r.cr }]));
}

const balanceOf = (acc: AccountRow, s: Map<string, { dr: number; cr: number }>) => natural(acc.type, s.get(acc.code)?.dr ?? 0, s.get(acc.code)?.cr ?? 0);

export type IncomeStatement = { sales: number; returns: number; netSales: number; cogs: number; grossProfit: number; expenses: Line[]; totalExpenses: number; netIncome: number };

export function incomeStatement(db: DatabaseSync, r: Range): IncomeStatement {
  const s = sums(db, { from: r.from, through: r.to });
  const accounts = listAccounts(db);
  const get = (code: string) => balanceOf(accounts.find((a) => a.code === code)!, s);
  const sales = get(ACC.sales);
  const returns = roundMoney(-get(ACC.returns)); // contra-income: debits reduce sales
  const netSales = roundMoney(sales - returns);
  const cogs = get(ACC.cogs);
  const expenses = accounts
    .filter((a) => a.type === 'expense' && a.code !== ACC.cogs)
    .map((a) => ({ code: a.code, name: a.name, amount: balanceOf(a, s) }))
    .filter((l) => l.amount !== 0);
  const totalExpenses = roundMoney(expenses.reduce((t, l) => t + l.amount, 0));
  const grossProfit = roundMoney(netSales - cogs);
  return { sales, returns, netSales, cogs, grossProfit, expenses, totalExpenses, netIncome: roundMoney(grossProfit - totalExpenses) };
}

export type BalanceSheet = { assets: Line[]; liabilities: Line[]; equity: Line[]; totalAssets: number; totalLiabilities: number; totalEquity: number; balanced: boolean };

export function balanceSheet(db: DatabaseSync, asOf: string): BalanceSheet {
  const s = sums(db, { through: asOf });
  const accounts = listAccounts(db);
  const lines = (type: AccountType) => accounts.filter((a) => a.type === type).map((a) => ({ code: a.code, name: a.name, amount: balanceOf(a, s) })).filter((l) => l.amount !== 0);
  // Retained earnings is never posted: it is all income less all expenses to date.
  const result = roundMoney(
    accounts.filter((a) => a.type === 'income').reduce((t, a) => t + balanceOf(a, s), 0) - accounts.filter((a) => a.type === 'expense').reduce((t, a) => t + balanceOf(a, s), 0),
  );
  const equity = lines('equity').filter((l) => l.code !== ACC.retained);
  const retainedAcc = accounts.find((a) => a.code === ACC.retained)!;
  const retained = roundMoney(result + balanceOf(retainedAcc, s));
  if (retained !== 0) equity.push({ code: ACC.retained, name: retainedAcc.name, amount: retained });
  const total = (ls: Line[]) => roundMoney(ls.reduce((t, l) => t + l.amount, 0));
  const assets = lines('asset');
  const liabilities = lines('liability');
  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquity = total(equity);
  return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, balanced: Math.abs(totalAssets - totalLiabilities - totalEquity) < 0.005 };
}

export type TrialBalance = { rows: { code: string; name: string; debit: number; credit: number }[]; totalDebit: number; totalCredit: number };

export function trialBalance(db: DatabaseSync, asOf: string): TrialBalance {
  const s = sums(db, { through: asOf });
  const rows = listAccounts(db)
    .map((a) => {
      const net = roundMoney((s.get(a.code)?.dr ?? 0) - (s.get(a.code)?.cr ?? 0));
      return { code: a.code, name: a.name, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0);
  return { rows, totalDebit: roundMoney(rows.reduce((t, r) => t + r.debit, 0)), totalCredit: roundMoney(rows.reduce((t, r) => t + r.credit, 0)) };
}

export type LedgerLine = { date: string; entryNo: string; entryId: number; memo: string; debit: number; credit: number; balance: number };
export type Ledger = { account: AccountRow; opening: number; rows: LedgerLine[]; closing: number };

export function accountLedger(db: DatabaseSync, code: string, r: Range): Ledger {
  const account = listAccounts(db).find((a) => a.code === code);
  if (!account) throw new Error(`Account ${code} does not exist.`);
  const sign = DEBIT_SIDE.includes(account.type) ? 1 : -1;
  const opening = accountBalance(db, code, { through: addDays(r.from, -1) });
  let balance = opening;
  const rows = (db
    .prepare(`SELECT e.date, e.entry_no AS entryNo, e.id AS entryId, e.memo, l.debit, l.credit FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account_id = ? AND e.date >= ? AND e.date <= ? ORDER BY e.date, e.id, l.id`)
    .all(account.id, r.from, r.to) as Omit<LedgerLine, 'balance'>[]).map((l) => {
    balance = roundMoney(balance + sign * (l.debit - l.credit));
    return { ...l, balance };
  });
  return { account, opening, rows, closing: balance };
}

export type CashBookLine = LedgerLine & { account: string };

// The three cash accounts as one running book, in posting order.
export function cashBook(db: DatabaseSync, r: Range): { opening: number; rows: CashBookLine[]; closing: number } {
  const codes = [ACC.cash, ACC.gcash, ACC.bank];
  const opening = roundMoney(codes.reduce((t, c) => t + accountBalance(db, c, { through: addDays(r.from, -1) }), 0));
  let balance = opening;
  const rows = (db
    .prepare(`SELECT e.date, e.entry_no AS entryNo, e.id AS entryId, e.memo, a.name AS account, l.debit, l.credit FROM journal_lines l
      JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
      WHERE a.code IN (?, ?, ?) AND e.date >= ? AND e.date <= ? ORDER BY e.date, e.id, l.id`)
    .all(...codes, r.from, r.to) as Omit<CashBookLine, 'balance'>[]).map((l) => {
    balance = roundMoney(balance + l.debit - l.credit);
    return { ...l, balance };
  });
  return { opening, rows, closing: balance };
}

export type VatSummary = { outputVat: number; inputVat: number; netPayable: number; carryOver: number };

export function vatSummary(db: DatabaseSync, month: string): VatSummary {
  const from = `${month}-01`;
  const to = addDays(addDays(from, 31).slice(0, 7) + '-01', -1);
  // Documents only: the owner's own VAT remittance (a manual entry) is a payment of the liability, not the month's VAT.
  const s = sums(db, { from, through: to, documentsOnly: true });
  const outputVat = roundMoney((s.get(ACC.outputVat)?.cr ?? 0) - (s.get(ACC.outputVat)?.dr ?? 0));
  const inputVat = roundMoney((s.get(ACC.inputVat)?.dr ?? 0) - (s.get(ACC.inputVat)?.cr ?? 0));
  return { outputVat, inputVat, netPayable: Math.max(0, roundMoney(outputVat - inputVat)), carryOver: Math.max(0, roundMoney(inputVat - outputVat)) };
}

export type SalesBreakdownRow = { key: string; count: number; qty?: number; total: number; cogs: number; grossProfit: number };

function breakdown(db: DatabaseSync, r: Range, keyExpr: string, orderBy: string): SalesBreakdownRow[] {
  return (db
    .prepare(`SELECT ${keyExpr} AS key, COUNT(*) AS count, ROUND(SUM(total), 2) AS total, ROUND(SUM(cogs), 2) AS cogs, ROUND(SUM(subtotal) - SUM(cogs), 2) AS grossProfit
      FROM sales WHERE status = 'posted' AND date >= ? AND date <= ? GROUP BY key ORDER BY ${orderBy}`)
    .all(r.from, r.to) as SalesBreakdownRow[]).map((x) => ({ ...x }));
}

export const salesByDay = (db: DatabaseSync, r: Range) => breakdown(db, r, 'date', 'key');
export const salesByCustomer = (db: DatabaseSync, r: Range) => breakdown(db, r, 'customer_name', 'key');

// Gross profit per item on net (ex-VAT) sales: each line's net share of its sale.
export function salesByItem(db: DatabaseSync, r: Range): SalesBreakdownRow[] {
  return (db
    .prepare(`SELECT i.sku || ' ' || i.name AS key, COUNT(DISTINCT s.id) AS count, ROUND(SUM(l.qty), 3) AS qty, ROUND(SUM(l.line_total), 2) AS total,
        ROUND(SUM(l.qty * l.unit_cost), 2) AS cogs,
        ROUND(SUM(l.line_total * (CASE WHEN s.total = 0 THEN 1 ELSE s.subtotal / s.total END)) - SUM(l.qty * l.unit_cost), 2) AS grossProfit
      FROM sale_lines l JOIN sales s ON s.id = l.sale_id JOIN items i ON i.id = l.item_id
      WHERE s.status = 'posted' AND s.date >= ? AND s.date <= ? GROUP BY i.id ORDER BY total DESC, key`)
    .all(r.from, r.to) as SalesBreakdownRow[]).map((x) => ({ ...x }));
}

export type FinanceCheck = { stockValue: number; inventoryGl: number; match: boolean; unbalancedEntries: number[] };

// Stock on the shelves (Σ qty × avg cost) must equal the Inventory account, and every entry must balance.
export function financeCheck(db: DatabaseSync): FinanceCheck {
  const { value } = db.prepare('SELECT ROUND(COALESCE(SUM(qty * avg_cost), 0), 2) AS value FROM items').get() as { value: number };
  const inventoryGl = accountBalance(db, ACC.inventory);
  const unbalancedEntries = (db
    .prepare('SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING ABS(ROUND(SUM(debit) - SUM(credit), 2)) > 0')
    .all() as { entry_id: number }[]).map((r) => r.entry_id);
  // Purchases are exact. Each sale or count rounds its cost to the centavo against a 4-dp average,
  // so allow half a centavo per such posting on top of a small floor.
  const { docs } = db.prepare("SELECT (SELECT COUNT(*) FROM sales) + (SELECT COUNT(*) FROM count_sessions WHERE posted_at IS NOT NULL) AS docs").get() as { docs: number };
  const tolerance = 0.05 + 0.005 * docs;
  return { stockValue: value, inventoryGl, match: Math.abs(value - inventoryGl) <= tolerance && unbalancedEntries.length === 0, unbalancedEntries };
}
