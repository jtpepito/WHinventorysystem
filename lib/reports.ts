import type { DatabaseSync } from 'node:sqlite';
import type { CsvCell } from './csv';
import { balanceSheet, cashBook, incomeStatement, type Range, salesByCustomer, salesByDay, salesByItem, trialBalance, vatSummary } from './finance-reports';
import { round } from './num';
import { apAging } from './purchases';
import { arAging } from './receivables';
import { addDays, manilaDay, manilaDaysWindowStart } from './time';

export type StockReportKey = 'stock-value' | 'fast-movers' | 'dead-stock' | 'low-stock';
export type SalesReportKey = 'sales-by-day' | 'sales-by-item' | 'sales-by-customer';
export type FinanceReportKey = 'income-statement' | 'balance-sheet' | 'trial-balance' | 'ar-aging' | 'ap-aging' | 'vat-summary' | 'cash-book' | 'journal';
export type ReportKey = StockReportKey | SalesReportKey | FinanceReportKey;
export const STOCK_REPORT_KEYS: StockReportKey[] = ['stock-value', 'fast-movers', 'dead-stock', 'low-stock'];
export const SALES_REPORT_KEYS: SalesReportKey[] = ['sales-by-day', 'sales-by-item', 'sales-by-customer'];
export const FINANCE_REPORT_KEYS: FinanceReportKey[] = ['income-statement', 'balance-sheet', 'trial-balance', 'ar-aging', 'ap-aging', 'vat-summary', 'cash-book', 'journal'];
export const REPORT_KEYS: ReportKey[] = [...STOCK_REPORT_KEYS, ...SALES_REPORT_KEYS, ...FINANCE_REPORT_KEYS];
export type ReportTable = { key: ReportKey; title: string; description: string; headers: string[]; rows: CsvCell[][]; moneyColumns: number[] };
// from/to: a range (default this month); asOf: a date (default today); month: 'YYYY-MM' (default this month).
export type ReportParams = { from?: string; to?: string; asOf?: string; month?: string };

export function isReportKey(s: unknown): s is ReportKey {
  return typeof s === 'string' && (REPORT_KEYS as string[]).includes(s);
}

const ITEM_JOIN = 'FROM items i JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id';

function stockValue(db: DatabaseSync): ReportTable {
  const rows = db
    .prepare(
      `SELECT c.name AS category, COUNT(i.id) AS items, ROUND(COALESCE(SUM(i.qty * i.avg_cost), 0), 2) AS value
       FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.active = 1
       GROUP BY c.id ORDER BY value DESC, c.name`,
    )
    .all() as { category: string; items: number; value: number }[];
  const total = rows.reduce((t, r) => ({ items: t.items + r.items, value: t.value + r.value }), { items: 0, value: 0 });
  return {
    key: 'stock-value', title: 'Stock value by category', description: 'Qty on hand × average cost, active items only.',
    headers: ['Category', 'Active items', 'Stock value (PHP)'],
    rows: [...rows.map((r) => [r.category, r.items, r.value]), ['TOTAL', total.items, round(total.value, 2)]],
    moneyColumns: [2],
  };
}

function fastMovers(db: DatabaseSync, now: string): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, COUNT(*) AS releases,
         ROUND(-SUM(m.qty_delta), 3) AS qty, ROUND(SUM(-m.qty_delta * COALESCE(m.unit_cost, 0)), 2) AS value
       FROM movements m JOIN items i ON i.id = m.item_id JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id
       WHERE m.type = 'release' AND m.created_at >= ?
       GROUP BY i.id ORDER BY releases DESC, qty DESC, i.sku LIMIT 20`,
    )
    .all(manilaDaysWindowStart(now, 30)) as { sku: string; name: string; category: string; unit: string; releases: number; qty: number; value: number }[];
  return {
    key: 'fast-movers', title: 'Fast movers (last 30 days)', description: 'Most frequently released items.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Releases', 'Qty released', 'Value released (PHP)'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.releases, r.qty, r.value]),
    moneyColumns: [6],
  };
}

function deadStock(db: DatabaseSync, now: string): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, i.qty, ROUND(i.qty * i.avg_cost, 2) AS value,
         (SELECT MAX(created_at) FROM movements WHERE item_id = i.id) AS lastAt
       ${ITEM_JOIN}
       WHERE i.active = 1 AND i.qty > 0 AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.item_id = i.id AND m.created_at >= ?)
       ORDER BY value DESC, i.sku`,
    )
    .all(manilaDaysWindowStart(now, 60)) as { sku: string; name: string; category: string; unit: string; qty: number; value: number; lastAt: string | null }[];
  return {
    key: 'dead-stock', title: 'Dead stock (no movement in 60 days)', description: 'Active items with stock on hand that have not moved.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Qty on hand', 'Stock value (PHP)', 'Last movement'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.qty, r.value, r.lastAt ? manilaDay(r.lastAt) : 'Never']),
    moneyColumns: [5],
  };
}

function lowStock(db: DatabaseSync): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, i.qty, i.reorder_point AS rp, ROUND(i.reorder_point - i.qty, 3) AS shortfall
       ${ITEM_JOIN} WHERE i.active = 1 AND i.qty <= i.reorder_point ORDER BY shortfall DESC, i.sku`,
    )
    .all() as { sku: string; name: string; category: string; unit: string; qty: number; rp: number; shortfall: number }[];
  return {
    key: 'low-stock', title: 'Low stock', description: 'Active items at or below their reorder point.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Qty on hand', 'Reorder point', 'Shortfall'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.qty, r.rp, r.shortfall]),
    moneyColumns: [],
  };
}

export function defaultParams(now: string, p: ReportParams = {}): Required<ReportParams> {
  const today = manilaDay(now);
  const month = p.month ?? today.slice(0, 7);
  const monthEnd = addDays(`${addDays(`${month}-01`, 31).slice(0, 7)}-01`, -1);
  return { from: p.from ?? `${month}-01`, to: p.to ?? monthEnd, asOf: p.asOf ?? today, month };
}

const SALES_HEADERS = ['Count', 'Sales (PHP)', 'Cost of goods (PHP)', 'Gross profit (PHP)'];
const breakdownTable = (key: SalesReportKey, title: string, first: string, r: Range, rows: { key: string; count: number; qty?: number; total: number; cogs: number; grossProfit: number }[]): ReportTable => ({
  key, title, description: `Posted sales ${r.from} to ${r.to}. Gross profit is net (ex-VAT) sales less cost of goods.`,
  headers: [first, ...(key === 'sales-by-item' ? ['Qty'] : []), ...SALES_HEADERS],
  rows: rows.map((x) => [x.key, ...(key === 'sales-by-item' ? [x.qty ?? 0] : []), x.count, x.total, x.cogs, x.grossProfit]),
  moneyColumns: key === 'sales-by-item' ? [3, 4, 5] : [2, 3, 4],
});

function financeTable(db: DatabaseSync, key: FinanceReportKey, p: Required<ReportParams>): ReportTable {
  const r: Range = { from: p.from, to: p.to };
  switch (key) {
    case 'income-statement': {
      const is = incomeStatement(db, r);
      return {
        key, title: 'Income statement', description: `${r.from} to ${r.to}`, headers: ['Line', 'Amount (PHP)'], moneyColumns: [1],
        rows: [
          ['Sales', is.sales], ['Less: sales returns', is.returns], ['Net sales', is.netSales], ['Cost of goods sold', is.cogs], ['Gross profit', is.grossProfit],
          ...is.expenses.map((e) => [`${e.code} ${e.name}`, e.amount]), ['Total expenses', is.totalExpenses], ['Net income', is.netIncome],
        ],
      };
    }
    case 'balance-sheet': {
      const bs = balanceSheet(db, p.asOf);
      const section = (name: string, lines: { code: string; name: string; amount: number }[], total: number) => [
        ...lines.map((l) => [name, `${l.code} ${l.name}`, l.amount]), [name, `Total ${name.toLowerCase()}`, total],
      ];
      return {
        key, title: 'Balance sheet', description: `As of ${p.asOf}${bs.balanced ? '' : ' — DOES NOT BALANCE'}`, headers: ['Section', 'Account', 'Amount (PHP)'], moneyColumns: [2],
        rows: [...section('Assets', bs.assets, bs.totalAssets), ...section('Liabilities', bs.liabilities, bs.totalLiabilities), ...section('Equity', bs.equity, bs.totalEquity)],
      };
    }
    case 'trial-balance': {
      const tb = trialBalance(db, p.asOf);
      return {
        key, title: 'Trial balance', description: `As of ${p.asOf}`, headers: ['Code', 'Account', 'Debit (PHP)', 'Credit (PHP)'], moneyColumns: [2, 3],
        rows: [...tb.rows.map((x) => [x.code, x.name, x.debit, x.credit]), ['', 'TOTAL', tb.totalDebit, tb.totalCredit]],
      };
    }
    case 'ar-aging': {
      const a = arAging(db, p.asOf);
      return {
        key, title: 'Receivables aging', description: `Open customer balances as of ${p.asOf}`, headers: ['Customer', 'Current', '31–60 days', '61–90 days', 'Over 90', 'Total (PHP)'], moneyColumns: [1, 2, 3, 4, 5],
        rows: [...a.rows.map((x) => [x.customer, x.current, x.d31_60, x.d61_90, x.d90plus, x.total]), ['TOTAL', null, null, null, null, a.total]],
      };
    }
    case 'ap-aging': {
      const a = apAging(db, p.asOf);
      return {
        key, title: 'Payables aging', description: `Open supplier balances as of ${p.asOf}`, headers: ['Supplier', 'Current', '31–60 days', '61–90 days', 'Over 90', 'Total (PHP)'], moneyColumns: [1, 2, 3, 4, 5],
        rows: [...a.rows.map((x) => [x.supplier, x.current, x.d31_60, x.d61_90, x.d90plus, x.total]), ['TOTAL', null, null, null, null, a.total]],
      };
    }
    case 'vat-summary': {
      const v = vatSummary(db, p.month);
      return {
        key, title: 'VAT summary', description: `Month ${p.month}`, headers: ['Line', 'Amount (PHP)'], moneyColumns: [1],
        rows: [['Output VAT on sales', v.outputVat], ['Input VAT on purchases and expenses', v.inputVat], ['Net VAT payable', v.netPayable], ['Excess input VAT to carry over', v.carryOver]],
      };
    }
    case 'cash-book': {
      const cb = cashBook(db, r);
      return {
        key, title: 'Cash book', description: `Cash, GCash and Bank ${r.from} to ${r.to}. Opening ${cb.opening}, closing ${cb.closing}.`,
        headers: ['Date', 'Entry', 'Account', 'Memo', 'In (PHP)', 'Out (PHP)', 'Balance (PHP)'], moneyColumns: [4, 5, 6],
        rows: cb.rows.map((x) => [x.date, x.entryNo, x.account, x.memo, x.debit, x.credit, x.balance]),
      };
    }
    case 'journal': {
      const rows = db
        .prepare(`SELECT e.date, e.entry_no AS entryNo, e.source_type AS source, e.memo, a.code || ' ' || a.name AS account, l.debit, l.credit
          FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts a ON a.id = l.account_id
          WHERE e.date >= ? AND e.date <= ? ORDER BY e.date, e.id, l.id`)
        .all(r.from, r.to) as { date: string; entryNo: string; source: string; memo: string; account: string; debit: number; credit: number }[];
      return {
        key, title: 'General journal', description: `${r.from} to ${r.to}`, headers: ['Date', 'Entry', 'Source', 'Memo', 'Account', 'Debit (PHP)', 'Credit (PHP)'], moneyColumns: [5, 6],
        rows: rows.map((x) => [x.date, x.entryNo, x.source, x.memo, x.account, x.debit, x.credit]),
      };
    }
  }
}

export function buildReport(db: DatabaseSync, key: ReportKey, now: string, params: ReportParams = {}): ReportTable {
  const p = defaultParams(now, params);
  const r: Range = { from: p.from, to: p.to };
  switch (key) {
    case 'stock-value': return stockValue(db);
    case 'fast-movers': return fastMovers(db, now);
    case 'dead-stock': return deadStock(db, now);
    case 'low-stock': return lowStock(db);
    case 'sales-by-day': return breakdownTable(key, 'Sales by day', 'Date', r, salesByDay(db, r));
    case 'sales-by-item': return breakdownTable(key, 'Sales by item', 'Item', r, salesByItem(db, r));
    case 'sales-by-customer': return breakdownTable(key, 'Sales by customer', 'Customer', r, salesByCustomer(db, r));
    default: return financeTable(db, key, p);
  }
}
