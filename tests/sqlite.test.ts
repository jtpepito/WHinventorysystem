import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { openDb, tx } from '@/lib/sqlite';
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

describe('accounting schema', () => {
  function withSale(db: Fixture['db']) {
    db.prepare("INSERT INTO sales (number, date, customer_name, payment_method, subtotal, vat, total, cogs, actor, created_at) VALUES ('SI-000001', '2026-10-01', 'Walk-in', 'cash', 100, 12, 112, 50, 'admin', 'x')").run();
    return (db.prepare('SELECT id FROM sales').get() as { id: number }).id;
  }
  it('lets a sale go posted → void once, then freezes it', () => {
    const { db } = makeDb();
    const id = withSale(db);
    db.prepare("UPDATE sales SET status = 'void', void_reason = 'typo', voided_at = 'y' WHERE id = ?").run(id);
    expect(() => db.prepare("UPDATE sales SET status = 'posted' WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare('UPDATE sales SET total = 1 WHERE id = ?').run(id)).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM sales WHERE id = ?').run(id)).toThrow(/immutable/);
  });
  it('refuses a void that also changes any other column', () => {
    const { db } = makeDb();
    const id = withSale(db);
    expect(() => db.prepare("UPDATE sales SET status = 'void', total = 1 WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE sales SET status = 'void', subtotal = 1 WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE sales SET status = 'void', customer_name = 'X' WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE sales SET status = 'void', payment_method = 'credit' WHERE id = ?").run(id)).toThrow(/immutable/);
    expect(() => db.prepare("UPDATE sales SET status = 'void', cogs = 0 WHERE id = ?").run(id)).toThrow(/immutable/);
  });
  it('books stock that existed before accounting as opening capital, once', () => {
    const file = path.join(os.tmpdir(), `inv-cutover-${process.pid}-${Date.now()}.db`);
    const v1 = openDb(file);
    v1.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
    v1.prepare("INSERT INTO units (name) VALUES ('pc')").run();
    v1.prepare("INSERT INTO items (sku, name, category_id, unit_id, qty, avg_cost) VALUES ('T-1', 'Hammer', 1, 1, 10, 50)").run();
    v1.prepare("INSERT INTO items (sku, name, category_id, unit_id, qty, avg_cost) VALUES ('T-2', 'Saw', 1, 1, 4, 12.5)").run();
    v1.close();
    const db = openDb(file);
    const entries = () => (db.prepare("SELECT COUNT(*) AS n FROM journal_entries WHERE source_type = 'opening'").get() as { n: number }).n;
    expect(entries()).toBe(1);
    const lines = db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id ORDER BY l.id').all().map((r) => ({ ...(r as object) }));
    expect(lines).toEqual([{ code: '1200', debit: 550, credit: 0 }, { code: '3100', debit: 0, credit: 550 }]);
    db.close();
    const again = openDb(file);
    expect((again.prepare("SELECT COUNT(*) AS n FROM journal_entries").get() as { n: number }).n).toBe(1);
    again.close();
    fs.rmSync(file, { force: true });
  });
  it('journal lines carry a debit or a credit, never both or neither', () => {
    const { db } = makeDb();
    const cash = (db.prepare("SELECT id FROM accounts WHERE code = '1010'").get() as { id: number }).id; // openDb seeds the chart
    db.prepare("INSERT INTO journal_entries (entry_no, date, source_type, memo, actor, created_at) VALUES ('JE-000001', '2026-10-01', 'manual', 'm', 'admin', 'x')").run();
    const ok = db.prepare(`INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (1, ${cash}, ?, ?)`);
    ok.run(5, 0);
    expect(() => ok.run(5, 5)).toThrow();
    expect(() => ok.run(0, 0)).toThrow();
    expect(() => db.prepare('UPDATE journal_lines SET debit = 9').run()).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM journal_entries').run()).toThrow(/immutable/);
  });
});

describe('migrate', () => {
  it('adds count_sessions.as_of_movement_id to a database created before it existed', () => {
    const file = path.join(os.tmpdir(), `inv-migrate-${process.pid}-${Date.now()}.db`);
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE count_sessions (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, category_id INTEGER, started_at TEXT NOT NULL, posted_at TEXT)');
    old.close();
    const db = openDb(file);
    const colsOf = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    const cols = colsOf('count_sessions');
    const itemCols = colsOf('items');
    const moveCols = colsOf('movements');
    db.close();
    fs.rmSync(file, { force: true });
    expect(cols).toContain('as_of_movement_id');
    expect(itemCols).toContain('sell_price');
    expect(moveCols).toEqual(expect.arrayContaining(['purchase_id', 'sale_id']));
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
