import { describe, expect, it } from 'vitest';
import {
  discardCountSession, getCountSession, listCountSessions, postCountSession, refreshExpected, saveCountActuals, startCountSession,
} from '@/lib/count';
import { ledgerCheck, postReceipt, postRelease } from '@/lib/inventory';
import { type Fixture, makeDb, plain, qtyOf } from './helpers';

function stocked() {
  const f = makeDb();
  postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 20, unitCost: 50 }, { itemId: f.item2, qty: 5, unitCost: 10 }, { itemId: f.paint, qty: 4, unitCost: 600 }] }, 'admin');
  return f;
}

function lineFor(f: Fixture, sessionId: number, itemId: number) {
  return getCountSession(f.db, sessionId)!.lines.find((l) => l.itemId === itemId)!;
}

const adjustCount = (f: Fixture) => ({ ...(f.db.prepare("SELECT COUNT(*) AS n FROM movements WHERE type = 'adjust'").get() as object) });

describe('count sessions', () => {
  it('starts with only the chosen category, expected = current qty', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const s = getCountSession(f.db, id)!;
    expect(s.scope).toBe('Tools');
    expect(s.lines.map((l) => [l.sku, l.expected, l.actual])).toEqual([['T-001', 20, null], ['T-002', 5, null]]);
  });
  it('scope "all" covers every active item', () => {
    const f = stocked();
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.item2);
    const s = getCountSession(f.db, startCountSession(f.db, { categoryId: null }))!;
    expect(s.scope).toBe('All categories');
    expect(s.lines.map((l) => l.sku)).toEqual(['P-001', 'T-001']);
  });
  it('ACCEPTANCE: a variance of −3 posts an adjust movement of −3 and the ledger still matches', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 17 }, { lineId: lineFor(f, id, f.item2).lineId, actual: 5 }]);
    expect(lineFor(f, id, f.item).variance).toBe(-3);
    expect(postCountSession(f.db, id, 'encoder')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(17);
    expect(plain(f.db.prepare("SELECT qty_delta, ref_no, note, actor FROM movements WHERE type = 'adjust'").all())).toEqual([
      { qty_delta: -3, ref_no: `COUNT-${id}`, note: 'count variance', actor: 'encoder' },
    ]);
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
    expect(getCountSession(f.db, id)!.postedAt).not.toBeNull();
  });
  it('skips uncounted lines and requires at least one count', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/at least one actual/);
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 22 }]);
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(22);
    expect(qtyOf(f.db, f.item2)).toBe(5);
  });
  it('cannot be posted or edited twice', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const lineId = lineFor(f, id, f.item).lineId;
    saveCountActuals(f.db, id, [{ lineId, actual: 20 }]);
    postCountSession(f.db, id, 'admin');
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/already posted/);
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: 1 }])).toThrow(/already posted/);
  });
  it('rejects negative or over-precise actuals and foreign lines', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const other = startCountSession(f.db, { categoryId: f.cat2 });
    const lineId = lineFor(f, id, f.item).lineId;
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: -1 }])).toThrow(/0 or more/);
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: 1.0001 }])).toThrow(/3 decimal/);
    expect(() => saveCountActuals(f.db, other, [{ lineId, actual: 1 }])).toThrow(/not part of this count/);
  });
  it('refuses to post when stock moved since the count started', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D', lines: [{ itemId: f.item, qty: 5 }] }, 'encoder');
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 14 }]);
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/Stock moved since this count started for: T-001/);
    expect(adjustCount(f)).toEqual({ n: 0 });
    expect(refreshExpected(f.db, id)).toBe(1);
    expect(lineFor(f, id, f.item)).toMatchObject({ expected: 15, actual: 14, variance: -1 });
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(14);
  });
  it('refuses to post when stock moved and came back to the same qty', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R2', lines: [{ itemId: f.item, qty: 5, unitCost: 50 }] }, 'admin');
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 25 }]);
    postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D', lines: [{ itemId: f.item, qty: 5 }] }, 'encoder');
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(lineFor(f, id, f.item).moved).toBe(true);
    expect(lineFor(f, id, f.item2).moved).toBe(false);
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/Stock moved since this count started for: T-001/);
    expect(adjustCount(f)).toEqual({ n: 0 });
    refreshExpected(f.db, id);
    expect(lineFor(f, id, f.item).moved).toBe(false);
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 20 }]);
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 0 });
    expect(qtyOf(f.db, f.item)).toBe(20);
  });
  it('posts a count adjustment for an item deactivated mid-count', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 18 }]);
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.item);
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(18);
  });
  it('discards an open count without touching stock or the ledger', () => {
    const f = stocked();
    const keep = startCountSession(f.db, { categoryId: f.cat2 });
    const id = startCountSession(f.db, { categoryId: f.cat });
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 3 }]);
    const movementsBefore = { ...(f.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as object) };
    discardCountSession(f.db, id);
    expect(getCountSession(f.db, id)).toBeNull();
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM count_lines WHERE session_id = ?').get(id)).toMatchObject({ n: 0 });
    expect(listCountSessions(f.db).map((s) => s.id)).toEqual([keep]);
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect({ ...(f.db.prepare('SELECT COUNT(*) AS n FROM movements').get() as object) }).toEqual(movementsBefore);
  });
  it('refuses to discard a posted or unknown count', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 20 }]);
    postCountSession(f.db, id, 'admin');
    expect(() => discardCountSession(f.db, id)).toThrow('This count was already posted.');
    expect(getCountSession(f.db, id)).not.toBeNull();
    expect(() => discardCountSession(f.db, 999)).toThrow('Count session not found.');
  });
  it('lists sessions newest first with progress counts', () => {
    const f = stocked();
    const a = startCountSession(f.db, { categoryId: f.cat }, '2026-10-01T00:00:00.000Z');
    const b = startCountSession(f.db, { categoryId: null }, '2026-10-02T00:00:00.000Z');
    saveCountActuals(f.db, a, [{ lineId: lineFor(f, a, f.item).lineId, actual: 19 }]);
    expect(listCountSessions(f.db).map((s) => [s.id, s.lineCount, s.countedCount, s.varianceCount])).toEqual([[b, 3, 0, 0], [a, 2, 1, 1]]);
  });
});
