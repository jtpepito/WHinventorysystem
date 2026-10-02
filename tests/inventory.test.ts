import { describe, expect, it } from 'vitest';
import {
  InventoryError, ledgerCheck, postAdjustment, postReceipt, postRelease, rebuildCachedQty, weightedAverage,
} from '@/lib/inventory';
import { avgOf, type Fixture, makeDb, qtyOf } from './helpers';

const AT = '2026-10-02T02:00:00.000Z';

function receive(f: Fixture, itemId: number, qty: number, unitCost: number, refNo = 'R-1') {
  return postReceipt(f.db, { supplierId: f.supplier, refNo, lines: [{ itemId, qty, unitCost }] }, 'admin', AT);
}

const row = (f: Fixture, sql: string, ...p: number[]) => ({ ...(f.db.prepare(sql).get(...p) as object) });

describe('weightedAverage', () => {
  it('uses the receipt cost when nothing is on hand', () => {
    expect(weightedAverage(0, 0, 10, 50)).toBe(50);
  });
  it('blends by quantity and rounds to 4 dp', () => {
    expect(weightedAverage(10, 50, 10, 100)).toBe(75);
    expect(weightedAverage(1, 10, 2, 10.01)).toBe(10.0067);
  });
});

describe('postReceipt', () => {
  it('ACCEPTANCE: 10 @ 50 then 10 @ 100 gives qty 20 at avg 75', () => {
    const f = makeDb();
    receive(f, f.item, 10, 50, 'R-1');
    receive(f, f.item, 10, 100, 'R-2');
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(avgOf(f.db, f.item)).toBe(75);
  });
  it('writes a receive movement with the supplier as counterparty', () => {
    const f = makeDb();
    const [id] = postReceipt(f.db, { supplierId: f.supplier, refNo: ' INV-9 ', note: 'first', lines: [{ itemId: f.item, qty: 10, unitCost: 50 }] }, 'encoder', AT);
    expect(row(f, 'SELECT * FROM movements WHERE id = ?', id)).toMatchObject({
      type: 'receive', qty_delta: 10, unit_cost: 50, ref_no: 'INV-9', counterparty: 'Acme Supply', note: 'first', actor: 'encoder', created_at: AT,
    });
  });
  it('requires a reference, a supplier and at least one line', () => {
    const f = makeDb();
    const line = [{ itemId: f.item, qty: 1, unitCost: 1 }];
    expect(() => postReceipt(f.db, { supplierId: f.supplier, refNo: '  ', lines: line }, 'admin')).toThrow(/Reference no/);
    expect(() => postReceipt(f.db, { supplierId: 999, refNo: 'R', lines: line }, 'admin')).toThrow(/supplier/);
    expect(() => postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [] }, 'admin')).toThrow(/at least one line/);
  });
  it.each([0, -1, NaN, Infinity, 1.0005, 2e9])('rejects qty %s', (qty) => {
    const f = makeDb();
    expect(() => receive(f, f.item, qty, 10)).toThrow(InventoryError);
  });
  it('rejects a negative cost but allows free goods at 0', () => {
    const f = makeDb();
    expect(() => receive(f, f.item, 1, -1)).toThrow(/unit cost/);
    receive(f, f.item, 1, 0);
    expect(qtyOf(f.db, f.item)).toBe(1);
  });
  it('rolls back the whole receipt when a later line is invalid', () => {
    const f = makeDb();
    expect(() =>
      postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 5, unitCost: 10 }, { itemId: f.item2, qty: -2, unitCost: 10 }] }, 'admin'),
    ).toThrow(/Line 2/);
    expect(qtyOf(f.db, f.item)).toBe(0);
    expect(row(f, 'SELECT COUNT(*) AS n FROM movements')).toEqual({ n: 0 });
  });
  it('rejects unknown and inactive items', () => {
    const f = makeDb();
    expect(() => receive(f, 999, 1, 1)).toThrow(/Line 1: item not found/);
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.item);
    expect(() => receive(f, f.item, 1, 1)).toThrow(/inactive/);
  });
});

describe('postRelease', () => {
  function stocked() {
    const f = makeDb();
    receive(f, f.item, 10, 50, 'R-1');
    receive(f, f.item, 10, 100, 'R-2');
    return f;
  }
  it('ACCEPTANCE: releasing 25 of 20 is blocked with a readable error', () => {
    const f = stocked();
    expect(() => postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D-1', lines: [{ itemId: f.item, qty: 25 }] }, 'encoder')).toThrow(
      'Cannot release 25 pc of Hammer (T-001) — only 20 on hand.',
    );
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(row(f, "SELECT COUNT(*) AS n FROM movements WHERE type = 'release'")).toEqual({ n: 0 });
  });
  it('blocks a release whose lines for one item add up past stock', () => {
    const f = stocked();
    expect(() =>
      postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D-1', lines: [{ itemId: f.item, qty: 15 }, { itemId: f.item, qty: 10 }] }, 'encoder'),
    ).toThrow(/Cannot release 25 pc of Hammer/);
    expect(qtyOf(f.db, f.item)).toBe(20);
  });
  it('decrements qty, keeps avg cost, and snapshots avg cost on the movement', () => {
    const f = stocked();
    const [id] = postRelease(f.db, { counterparty: 'JDC Construction', refNo: 'D-2', lines: [{ itemId: f.item, qty: 20 }] }, 'encoder', AT);
    expect(qtyOf(f.db, f.item)).toBe(0);
    expect(avgOf(f.db, f.item)).toBe(75);
    expect(row(f, 'SELECT type, qty_delta, unit_cost, counterparty FROM movements WHERE id = ?', id)).toEqual({
      type: 'release', qty_delta: -20, unit_cost: 75, counterparty: 'JDC Construction',
    });
  });
  it('requires a destination and a reference', () => {
    const f = stocked();
    const lines = [{ itemId: f.item, qty: 1 }];
    expect(() => postRelease(f.db, { counterparty: ' ', refNo: 'D', lines }, 'admin')).toThrow(/Destination/);
    expect(() => postRelease(f.db, { counterparty: 'X', refNo: '', lines }, 'admin')).toThrow(/Reference no/);
  });
});

describe('postAdjustment', () => {
  it('applies a signed delta and refuses to go below zero', () => {
    const f = makeDb();
    receive(f, f.item, 5, 10);
    postAdjustment(f.db, { itemId: f.item, qtyDelta: -3, refNo: 'COUNT-1', note: 'count variance' }, 'admin', AT);
    expect(qtyOf(f.db, f.item)).toBe(2);
    expect(() => postAdjustment(f.db, { itemId: f.item, qtyDelta: -3, refNo: 'X', note: 'x' }, 'admin')).toThrow(/below zero/);
    expect(() => postAdjustment(f.db, { itemId: f.item, qtyDelta: 0, refNo: 'X', note: 'x' }, 'admin')).toThrow(InventoryError);
  });
});

describe('ledger check', () => {
  it('matches after normal posting, detects drift, and rebuilds', () => {
    const f = makeDb();
    receive(f, f.item, 10, 50);
    postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId: f.item, qty: 4 }] }, 'admin');
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
    f.db.prepare('UPDATE items SET qty = 999 WHERE id = ?').run(f.item);
    const bad = ledgerCheck(f.db).filter((r) => !r.match);
    expect(bad).toEqual([{ itemId: f.item, sku: 'T-001', name: 'Hammer', cached: 999, ledger: 6, match: false }]);
    expect(rebuildCachedQty(f.db)).toBe(1);
    expect(qtyOf(f.db, f.item)).toBe(6);
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
  });
});
