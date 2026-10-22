import { describe, expect, it } from 'vitest';
import {
  accountLedger, balanceSheet, cashBook, financeCheck, incomeStatement, salesByCustomer, salesByDay, salesByItem, trialBalance, vatSummary,
} from '@/lib/finance-reports';
import { accountBalance } from '@/lib/ledger';
import { buildReport, isReportKey, REPORT_KEYS } from '@/lib/reports';
import { financeFixture, MONTH, NOW } from './finance-fixture';

describe('income statement', () => {
  it('adds up October', () => {
    const f = financeFixture();
    const is = incomeStatement(f.db, MONTH);
    expect(is).toEqual({
      sales: 450, returns: 0, netSales: 450, cogs: 300, grossProfit: 150,
      expenses: [{ code: '5200', name: 'Inventory shrinkage / adjustments', amount: 100 }, { code: '6100', name: 'Rent', amount: 10000 }],
      totalExpenses: 10100, netIncome: -9950,
    });
    expect(incomeStatement(f.db, { from: '2026-10-01', to: '2026-10-04' })).toMatchObject({ sales: 300, cogs: 200, netIncome: 100 });
  });
});

describe('balance sheet', () => {
  it('balances, with retained earnings carrying the period result', () => {
    const f = financeFixture();
    const bs = balanceSheet(f.db, '2026-10-31');
    expect(bs.balanced).toBe(true);
    expect(bs.assets).toEqual([
      { code: '1010', name: 'Cash on hand', amount: 49316 }, // 50000 − 1120 + 336 + 100
      { code: '1030', name: 'Bank', amount: -11200 },
      { code: '1100', name: 'Accounts receivable', amount: 68 },
      { code: '1200', name: 'Inventory', amount: 600 }, // 1000 − 200 − 100 − 100
      { code: '1300', name: 'Input VAT', amount: 1320 },
    ]);
    expect(bs.liabilities).toEqual([{ code: '2200', name: 'Output VAT payable', amount: 54 }]);
    expect(bs.equity).toEqual([{ code: '3100', name: "Owner's capital", amount: 50000 }, { code: '3900', name: 'Retained earnings', amount: -9950 }]);
    expect(bs.totalAssets).toBe(40104);
    expect(bs.totalLiabilities + bs.totalEquity).toBe(40104);
    // Before the rent and the count, inventory and cash tell a different story.
    expect(balanceSheet(f.db, '2026-10-04').assets.find((a) => a.code === '1200')?.amount).toBe(800);
  });
});

describe('trial balance and ledgers', () => {
  it('trial balance totals agree', () => {
    const f = financeFixture();
    const tb = trialBalance(f.db, '2026-10-31');
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.rows.find((r) => r.code === '1010')).toEqual({ code: '1010', name: 'Cash on hand', debit: 49316, credit: 0 });
    expect(tb.rows.find((r) => r.code === '1030')).toEqual({ code: '1030', name: 'Bank', debit: 0, credit: 11200 });
    expect(tb.rows.some((r) => r.code === '2100')).toBe(false);
  });
  it('an account ledger runs from opening to closing', () => {
    const f = financeFixture();
    const l = accountLedger(f.db, '1010', { from: '2026-10-02', to: '2026-10-31' });
    expect(l.opening).toBe(50000);
    expect(l.rows.map((r) => [r.date, r.debit, r.credit, r.balance])).toEqual([
      ['2026-10-02', 0, 1120, 48880], ['2026-10-03', 336, 0, 49216], ['2026-10-08', 100, 0, 49316],
    ]);
    expect(l.rows[0]).toMatchObject({ entryNo: 'JE-000002', memo: 'PUR-000001 Acme Supply inv INV-1' });
    expect(l.closing).toBe(accountBalance(f.db, '1010'));
  });
  it('the cash book merges the three cash accounts', () => {
    const f = financeFixture();
    const cb = cashBook(f.db, MONTH);
    expect(cb.rows.map((r) => r.account)).toEqual(['Cash on hand', 'Cash on hand', 'Cash on hand', 'Cash on hand', 'Bank']);
    expect(cb.closing).toBe(49316 - 11200);
  });
});

describe('VAT and sales analyses', () => {
  it('summarises the month of VAT', () => {
    const f = financeFixture();
    expect(vatSummary(f.db, '2026-10')).toEqual({ outputVat: 54, inputVat: 1320, netPayable: 0, carryOver: 1266 });
    expect(vatSummary(f.db, '2026-09')).toEqual({ outputVat: 0, inputVat: 0, netPayable: 0, carryOver: 0 });
  });
  it('breaks sales down by day, item and customer', () => {
    const f = financeFixture();
    expect(salesByDay(f.db, MONTH)).toEqual([
      { key: '2026-10-03', count: 1, total: 336, cogs: 200, grossProfit: 100 },
      { key: '2026-10-05', count: 1, total: 168, cogs: 100, grossProfit: 50 },
    ]);
    expect(salesByItem(f.db, MONTH)).toEqual([{ key: 'T-001 Hammer', count: 2, qty: 3, total: 504, cogs: 300, grossProfit: 150 }]);
    expect(salesByCustomer(f.db, MONTH)).toEqual([
      { key: 'JDC Construction', count: 1, total: 168, cogs: 100, grossProfit: 50 },
      { key: 'Walk-in', count: 1, total: 336, cogs: 200, grossProfit: 100 },
    ]);
  });
});

describe('financeCheck', () => {
  it('matches stock value to the Inventory account and finds nothing unbalanced', () => {
    const f = financeFixture();
    expect(financeCheck(f.db)).toEqual({ stockValue: 600, inventoryGl: 600, match: true, unbalancedEntries: [] });
    f.db.prepare('UPDATE items SET qty = 999 WHERE id = ?').run(f.item);
    expect(financeCheck(f.db).match).toBe(false);
  });
});

describe('buildReport finance keys', () => {
  it('exposes every finance report as a CSV table', () => {
    const f = financeFixture();
    expect(REPORT_KEYS.slice(0, 4)).toEqual(['stock-value', 'fast-movers', 'dead-stock', 'low-stock']);
    const keys = ['sales-by-day', 'sales-by-item', 'sales-by-customer', 'income-statement', 'balance-sheet', 'trial-balance', 'ar-aging', 'ap-aging', 'vat-summary', 'cash-book', 'journal'] as const;
    for (const k of keys) {
      expect(isReportKey(k)).toBe(true);
      const t = buildReport(f.db, k, NOW, { from: MONTH.from, to: MONTH.to, asOf: '2026-10-31', month: '2026-10' });
      expect(t.headers.length).toBeGreaterThan(0);
      expect(t.rows.every((r) => r.length === t.headers.length)).toBe(true);
    }
    const is = buildReport(f.db, 'income-statement', NOW, MONTH);
    expect(is.headers).toEqual(['Line', 'Amount (PHP)']);
    expect(is.rows.find((r) => r[0] === 'Net income')).toEqual(['Net income', -9950]);
    expect(buildReport(f.db, 'journal', NOW, MONTH).rows.length).toBeGreaterThan(10);
  });
});
