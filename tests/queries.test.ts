import { describe, expect, it } from 'vitest';
import { dashboardStats, inOutLast7Days } from '@/lib/dashboard';
import { postReceipt, postRelease } from '@/lib/inventory';
import { getItem, listItems, listMovements, listMovementsPage } from '@/lib/queries';
import { makeDb } from './helpers';

describe('listItems', () => {
  it('searches SKU and name, treating % and _ literally', () => {
    const f = makeDb();
    f.db.prepare("UPDATE items SET name = '100% Latex' WHERE id = ?").run(f.paint);
    expect(listItems(f.db, { q: 'ham' }).map((i) => i.sku)).toEqual(['T-001']);
    expect(listItems(f.db, { q: 'p-0' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { q: '%' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { q: '_' })).toEqual([]);
  });
  it('filters by category and status; low = active and qty <= reorder point', () => {
    const f = makeDb();
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 10, unitCost: 1 }, { itemId: f.item2, qty: 3, unitCost: 1 }] }, 'admin');
    f.db.prepare('UPDATE items SET reorder_point = 5').run();
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.paint);
    expect(listItems(f.db, { status: 'low' }).map((i) => i.sku)).toEqual(['T-002']);
    expect(listItems(f.db, { status: 'inactive' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { categoryId: f.cat2 }).map((i) => i.sku)).toEqual(['P-001']);
    expect(getItem(f.db, f.item2)).toMatchObject({ sku: 'T-002', category: 'Tools', unit: 'pc', qty: 3, low: true, active: true });
    expect(getItem(f.db, 999)).toBeNull();
  });
});

describe('listMovements', () => {
  it('filters by Manila day, including the whole "to" day', () => {
    const f = makeDb();
    const rcv = (refNo: string, at: string) =>
      postReceipt(f.db, { supplierId: f.supplier, refNo, lines: [{ itemId: f.item, qty: 1, unitCost: 1 }] }, 'admin', at);
    rcv('LATE-OCT1', '2026-10-01T15:30:00.000Z'); // 23:30 Oct 1 Manila
    rcv('EARLY-OCT2', '2026-10-01T16:00:00.000Z'); // 00:00 Oct 2 Manila
    rcv('NOON-OCT2', '2026-10-02T04:00:00.000Z');
    const refs = (from?: string, to?: string) => listMovements(f.db, { from, to }).map((m) => m.refNo);
    expect(refs('2026-10-01', '2026-10-01')).toEqual(['LATE-OCT1']);
    expect(refs('2026-10-02', '2026-10-02')).toEqual(['NOON-OCT2', 'EARLY-OCT2']);
    expect(refs(undefined, '2026-10-01')).toEqual(['LATE-OCT1']);
    expect(refs('not-a-day', undefined)).toHaveLength(3);
  });
  it('filters by item and type and returns the movement shape', () => {
    const f = makeDb();
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 5, unitCost: 2 }, { itemId: f.item2, qty: 1, unitCost: 2 }] }, 'admin', '2026-10-02T00:00:00.000Z');
    postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D', lines: [{ itemId: f.item, qty: 2 }] }, 'encoder', '2026-10-02T01:00:00.000Z');
    expect(listMovements(f.db, { itemId: f.item, type: 'release' })).toEqual([
      expect.objectContaining({ type: 'release', sku: 'T-001', itemName: 'Hammer', unit: 'pc', qtyDelta: -2, unitCost: 2, refNo: 'D', counterparty: 'Walk-in', actor: 'encoder' }),
    ]);
    expect(listMovements(f.db, { limit: 1 })).toHaveLength(1);
  });
});

describe('listMovementsPage', () => {
  function withMovements(n: number) {
    const f = makeDb();
    for (let i = 0; i < n; i++) {
      postReceipt(f.db, { supplierId: f.supplier, refNo: `R-${i}`, lines: [{ itemId: f.item, qty: 1, unitCost: 1 }] }, 'admin', `2026-10-01T00:00:${String(i).padStart(2, '0')}.000Z`);
    }
    return f;
  }
  it('reports truncation only when more rows exist than the limit', () => {
    const exact = withMovements(3);
    expect(listMovementsPage(exact.db, { itemId: exact.item }, 3)).toMatchObject({ truncated: false });
    expect(listMovementsPage(exact.db, { itemId: exact.item }, 3).rows).toHaveLength(3);
    const more = withMovements(4);
    const page = listMovementsPage(more.db, { itemId: more.item }, 3);
    expect(page.truncated).toBe(true);
    expect(page.rows.map((r) => r.refNo)).toEqual(['R-3', 'R-2', 'R-1']);
  });
});

describe('dashboard', () => {
  it('counts today in Manila time and builds 7 chart days', () => {
    const f = makeDb();
    const now = '2026-10-02T04:00:00.000Z'; // noon Oct 2 Manila
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'A', lines: [{ itemId: f.item, qty: 10, unitCost: 50 }] }, 'admin', '2026-10-01T15:30:00.000Z');
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'B', lines: [{ itemId: f.item, qty: 10, unitCost: 100 }] }, 'admin', '2026-10-01T16:30:00.000Z');
    postRelease(f.db, { counterparty: 'X', refNo: 'C', lines: [{ itemId: f.item, qty: 4 }] }, 'admin', '2026-10-02T02:00:00.000Z');
    f.db.prepare('UPDATE items SET reorder_point = 100 WHERE id = ?').run(f.item);
    // T-001 is 16 <= 100; T-002 and P-001 sit at 0 <= 0, which the spec also counts as low.
    expect(dashboardStats(f.db, now)).toEqual({ totalSkus: 3, stockValue: 1200, lowStockCount: 3, todayMovements: 2 });
    const days = inOutLast7Days(f.db, now);
    expect(days.map((d) => d.day)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(days[5]).toMatchObject({ inValue: 500, outValue: 0, label: 'Oct 1' });
    expect(days[6]).toMatchObject({ inValue: 1000, outValue: 300 });
  });
});
