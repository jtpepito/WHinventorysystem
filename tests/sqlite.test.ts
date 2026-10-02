import { describe, expect, it } from 'vitest';
import { tx } from '@/lib/sqlite';
import { type Fixture, makeDb, qtyOf } from './helpers';

function addMovement(db: Fixture['db'], itemId: number) {
  db.prepare(
    "INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'receive', 1, 'admin', '2026-10-01T00:00:00.000Z')",
  ).run(itemId);
}

describe('schema', () => {
  it('makes movements immutable', () => {
    const { db, item } = makeDb();
    addMovement(db, item);
    expect(() => db.prepare('UPDATE movements SET qty_delta = 5').run()).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM movements').run()).toThrow(/immutable/);
  });
  it('rejects negative on-hand qty, zero deltas and unknown types', () => {
    const { db, item } = makeDb();
    expect(() => db.prepare('UPDATE items SET qty = -1 WHERE id = ?').run(item)).toThrow();
    expect(() =>
      db.prepare("INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'receive', 0, 'admin', 'x')").run(item),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'gift', 1, 'admin', 'x')").run(item),
    ).toThrow();
  });
  it('treats SKUs as case-insensitively unique', () => {
    const { db, cat, unit } = makeDb();
    expect(() =>
      db.prepare('INSERT INTO items (sku, name, category_id, unit_id) VALUES (?, ?, ?, ?)').run('t-001', 'Dup', cat, unit),
    ).toThrow();
  });
});

describe('tx', () => {
  it('commits on success', () => {
    const { db, item } = makeDb();
    tx(db, () => db.prepare('UPDATE items SET qty = 5 WHERE id = ?').run(item));
    expect(qtyOf(db, item)).toBe(5);
  });
  it('rolls back on throw', () => {
    const { db, item } = makeDb();
    expect(() =>
      tx(db, () => {
        db.prepare('UPDATE items SET qty = 5 WHERE id = ?').run(item);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(qtyOf(db, item)).toBe(0);
  });
  it('nests without starting a second transaction', () => {
    const { db, item } = makeDb();
    tx(db, () => tx(db, () => db.prepare('UPDATE items SET qty = 2 WHERE id = ?').run(item)));
    expect(qtyOf(db, item)).toBe(2);
    expect(db.isTransaction).toBe(false);
  });
});
