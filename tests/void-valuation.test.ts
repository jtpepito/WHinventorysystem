import { describe, expect, it } from 'vitest';
import { financeCheck } from '@/lib/finance-reports';
import { accountBalance } from '@/lib/ledger';
import { postPurchase, voidPurchase } from '@/lib/purchases';
import { postSale, voidSale } from '@/lib/sales';
import { avgOf, type Fixture, makeDb, qtyOf } from './helpers';

// Review focus 5: after voids, stock on the shelves must still equal the Inventory account,
// even when the average cost moved between the document and its void.
const buy = (f: Fixture, qty: number, unitCost: number, at: string, method: 'cash' | 'credit' = 'cash') =>
  postPurchase(f.db, { date: at.slice(0, 10), supplierId: f.supplier, refNo: `INV-${at}`, method, vatInvoice: false, lines: [{ itemId: f.item, qty, unitCost }] }, 'admin', at);
const sell = (f: Fixture, qty: number, at: string) =>
  postSale(f.db, { date: at.slice(0, 10), customerId: null, method: 'cash', lines: [{ itemId: f.item, qty, unitPrice: 300 }] }, 'admin', at);

describe('void valuation', () => {
  it('a sale void after a dearer purchase returns stock at its original cost and re-averages', () => {
    const f = makeDb();
    buy(f, 10, 100, '2026-10-01T01:00:00.000Z');
    const s = sell(f, 10, '2026-10-02T01:00:00.000Z');
    buy(f, 10, 200, '2026-10-03T01:00:00.000Z');
    voidSale(f.db, s.id, 'returned', 'admin', '2026-10-04T01:00:00.000Z');
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(avgOf(f.db, f.item)).toBe(150); // (10 × 200 + 10 × 100) / 20
    expect(accountBalance(f.db, '1200')).toBe(3000);
    expect(financeCheck(f.db)).toMatchObject({ stockValue: 3000, inventoryGl: 3000, match: true });
  });
  it('a sale void with stock still on hand keeps stock and books equal', () => {
    const f = makeDb();
    buy(f, 10, 100, '2026-10-01T01:00:00.000Z');
    const s = sell(f, 5, '2026-10-02T01:00:00.000Z');
    buy(f, 10, 200, '2026-10-03T01:00:00.000Z');
    voidSale(f.db, s.id, 'returned', 'admin', '2026-10-04T01:00:00.000Z');
    expect(financeCheck(f.db)).toMatchObject({ match: true });
    expect(accountBalance(f.db, '1200')).toBe(3000);
    expect(qtyOf(f.db, f.item) * avgOf(f.db, f.item)).toBeCloseTo(3000, 2);
  });
  it('a purchase void takes its lot out of the average', () => {
    const f = makeDb();
    buy(f, 10, 100, '2026-10-01T01:00:00.000Z');
    const p = buy(f, 10, 200, '2026-10-02T01:00:00.000Z', 'credit');
    voidPurchase(f.db, p.id, 'wrong supplier', 'admin', '2026-10-03T01:00:00.000Z');
    expect(qtyOf(f.db, f.item)).toBe(10);
    expect(avgOf(f.db, f.item)).toBe(100);
    expect(financeCheck(f.db)).toMatchObject({ stockValue: 1000, inventoryGl: 1000, match: true });
  });
  it('a residual that cannot be carried in the average goes to shrinkage', () => {
    const f = makeDb();
    buy(f, 10, 100, '2026-10-01T01:00:00.000Z');
    const p = buy(f, 10, 200, '2026-10-02T01:00:00.000Z', 'credit');
    sell(f, 12, '2026-10-03T01:00:00.000Z'); // 8 left at avg 150 = 1,200
    // Voiding the 200-lot wants to remove 2,000 of value from 1,200 of stock.
    expect(() => voidPurchase(f.db, p.id, 'mistake', 'admin', '2026-10-04T01:00:00.000Z')).toThrow(/only 8 on hand/);
    const g = makeDb();
    buy(g, 10, 100, '2026-10-01T01:00:00.000Z');
    const q = buy(g, 10, 200, '2026-10-02T01:00:00.000Z', 'credit');
    sell(g, 10, '2026-10-03T01:00:00.000Z'); // 10 left at avg 150 = 1,500
    voidPurchase(g.db, q.id, 'mistake', 'admin', '2026-10-04T01:00:00.000Z'); // removes 10 @ 200 = 2,000 from 1,500 of stock
    expect(qtyOf(g.db, g.item)).toBe(0);
    expect(financeCheck(g.db)).toMatchObject({ match: true });
    expect(accountBalance(g.db, '1200')).toBe(0);
    expect(accountBalance(g.db, '5200')).toBe(-500); // the 500 the books had over-valued comes back as a gain
  });
});
