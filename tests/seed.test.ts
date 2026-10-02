import { describe, expect, it } from 'vitest';
import { ledgerCheck } from '@/lib/inventory';
import { buildReport } from '@/lib/reports';
import { DEAD_STOCK_SKUS, LOW_STOCK_SKUS, seed, seedIfEmpty } from '@/lib/seed';
import { openDb } from '@/lib/sqlite';
import { plain } from './helpers';

const NOW = '2026-10-03T04:00:00.000Z';

function seeded() {
  const db = openDb(':memory:');
  seed(db, NOW);
  return db;
}

const count = (db: ReturnType<typeof seeded>, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('seed', () => {
  it('creates 40 items in 5 categories and 3 suppliers', () => {
    const db = seeded();
    expect(count(db, 'SELECT COUNT(*) AS n FROM items')).toBe(40);
    expect((db.prepare('SELECT name FROM categories ORDER BY name').all() as { name: string }[]).map((c) => c.name)).toEqual([
      'Electrical', 'Fasteners', 'Paint', 'Plumbing', 'Tools',
    ]);
    expect(count(db, 'SELECT COUNT(*) AS n FROM categories c WHERE (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) = 8')).toBe(5);
    expect(count(db, 'SELECT COUNT(*) AS n FROM suppliers')).toBe(3);
  });
  it('spans about 60 days with receives, releases and one posted count with variances', () => {
    const db = seeded();
    const span = db.prepare('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM movements').get() as { first: string; last: string };
    expect((Date.parse(NOW) - Date.parse(span.first)) / 86_400_000).toBeGreaterThanOrEqual(60);
    expect(Date.parse(span.last)).toBeLessThan(Date.parse(NOW));
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'receive'")).toBeGreaterThan(40);
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'release'")).toBeGreaterThan(100);
    expect(count(db, 'SELECT COUNT(*) AS n FROM count_sessions WHERE posted_at IS NOT NULL')).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'adjust' AND note = 'count variance'")).toBe(3);
  });
  it('leaves exactly the 6 intended items low on stock', () => {
    const db = seeded();
    expect(buildReport(db, 'low-stock', NOW).rows.map((r) => r[0]).sort()).toEqual([...LOW_STOCK_SKUS].sort());
  });
  it('produces dead stock and fast movers', () => {
    const db = seeded();
    expect(buildReport(db, 'dead-stock', NOW).rows.map((r) => r[0]).sort()).toEqual([...DEAD_STOCK_SKUS].sort());
    expect(buildReport(db, 'fast-movers', NOW).rows.length).toBeGreaterThan(5);
  });
  it('keeps the cache equal to the ledger', () => {
    expect(ledgerCheck(seeded()).every((r) => r.match)).toBe(true);
  });
  it('is deterministic and seeds only an empty DB', () => {
    const a = seeded();
    const b = seeded();
    const snap = (db: typeof a) => plain(db.prepare('SELECT sku, qty, avg_cost, reorder_point FROM items ORDER BY sku').all());
    expect(snap(a)).toEqual(snap(b));
    expect(seedIfEmpty(a, NOW)).toBe(false);
    expect(seedIfEmpty(openDb(':memory:'), NOW)).toBe(true);
  });
});
