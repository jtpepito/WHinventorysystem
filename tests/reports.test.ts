import { describe, expect, it } from 'vitest';
import { postReceipt, postRelease } from '@/lib/inventory';
import { buildReport, isReportKey, REPORT_KEYS } from '@/lib/reports';
import { makeDb } from './helpers';

const NOW = '2026-10-02T04:00:00.000Z';

function scenario() {
  const f = makeDb();
  const rcv = (itemId: number, qty: number, cost: number, at: string) =>
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId, qty, unitCost: cost }] }, 'admin', at);
  const rel = (itemId: number, qty: number, at: string) =>
    postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId, qty }] }, 'admin', at);
  rcv(f.item, 50, 10, '2026-09-25T00:00:00.000Z');
  rcv(f.item2, 20, 5, '2026-09-25T00:00:00.000Z');
  rcv(f.paint, 4, 600, '2026-07-01T00:00:00.000Z'); // last movement 93 days ago → dead
  rel(f.item, 5, '2026-09-30T00:00:00.000Z');
  rel(f.item, 5, '2026-10-01T00:00:00.000Z');
  rel(f.item2, 12, '2026-10-01T00:00:00.000Z');
  rel(f.item2, 1, '2026-10-01T01:00:00.000Z');
  f.db.prepare('UPDATE items SET reorder_point = 10 WHERE id = ?').run(f.item2);
  return f;
}

describe('reports', () => {
  it('knows its keys', () => {
    expect(REPORT_KEYS).toEqual(['stock-value', 'fast-movers', 'dead-stock', 'low-stock']);
    expect(isReportKey('low-stock')).toBe(true);
    expect(isReportKey('../etc')).toBe(false);
  });
  it('stock value by category with a total row', () => {
    const t = buildReport(scenario().db, 'stock-value', NOW);
    expect(t.headers).toEqual(['Category', 'Active items', 'Stock value (PHP)']);
    expect(t.rows).toEqual([['Paint', 1, 2400], ['Tools', 2, 435], ['TOTAL', 3, 2835]]);
    expect(t.moneyColumns).toEqual([2]);
  });
  it('fast movers ranks by number of releases in 30 days, then qty', () => {
    const t = buildReport(scenario().db, 'fast-movers', NOW);
    expect(t.rows.map((r) => [r[0], r[4], r[5]])).toEqual([['T-002', 2, 13], ['T-001', 2, 10]]);
  });
  it('dead stock lists active items with stock and no movement in 60 days', () => {
    const t = buildReport(scenario().db, 'dead-stock', NOW);
    expect(t.rows).toEqual([['P-001', 'Latex White', 'Paint', 'pc', 4, 2400, '2026-07-01']]);
  });
  it('fast movers counts 30 Manila calendar days, not a rolling 30×24h', () => {
    const f = makeDb();
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 50, unitCost: 1 }] }, 'admin', '2026-08-01T00:00:00.000Z');
    const rel = (at: string) => postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId: f.item, qty: 1 }] }, 'admin', at);
    rel('2026-09-02T10:00:00.000Z'); // Sep 2, 6 PM Manila: day 31 back — inside a rolling window, outside the calendar one
    rel('2026-09-02T17:00:00.000Z'); // Sep 3, 1 AM Manila: day 30 back — counts
    const t = buildReport(f.db, 'fast-movers', NOW); // NOW = Oct 2 noon Manila
    expect(t.rows.map((r) => [r[0], r[4]])).toEqual([['T-001', 1]]);
  });
  it('dead stock uses 60 Manila calendar days', () => {
    const f = makeDb();
    // Aug 3, 6 PM Manila: day 61 back from Oct 2 — so the item counts as not moved in 60 days
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 5, unitCost: 1 }] }, 'admin', '2026-08-03T10:00:00.000Z');
    expect(buildReport(f.db, 'dead-stock', NOW).rows.map((r) => r[0])).toEqual(['T-001']);
  });
  it('low stock lists shortfall', () => {
    const t = buildReport(scenario().db, 'low-stock', NOW);
    expect(t.rows).toEqual([['T-002', 'Saw', 'Tools', 'pc', 7, 10, 3]]);
  });
});
