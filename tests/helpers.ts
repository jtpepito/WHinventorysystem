import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/sqlite';

function insert(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

export function makeDb() {
  const db = openDb(':memory:');
  const cat = insert(db, 'INSERT INTO categories (name) VALUES (?)', 'Tools');
  const cat2 = insert(db, 'INSERT INTO categories (name) VALUES (?)', 'Paint');
  const unit = insert(db, 'INSERT INTO units (name) VALUES (?)', 'pc');
  const supplier = insert(db, 'INSERT INTO suppliers (name, contact) VALUES (?, ?)', 'Acme Supply', '0917 000 0000');
  const itemSql = 'INSERT INTO items (sku, name, category_id, unit_id) VALUES (?, ?, ?, ?)';
  const item = insert(db, itemSql, 'T-001', 'Hammer', cat, unit);
  const item2 = insert(db, itemSql, 'T-002', 'Saw', cat, unit);
  const paint = insert(db, itemSql, 'P-001', 'Latex White', cat2, unit);
  return { db, cat, cat2, unit, supplier, item, item2, paint };
}

export type Fixture = ReturnType<typeof makeDb>;

export function qtyOf(db: DatabaseSync, id: number): number {
  return (db.prepare('SELECT qty FROM items WHERE id = ?').get(id) as { qty: number }).qty;
}

export function avgOf(db: DatabaseSync, id: number): number {
  return (db.prepare('SELECT avg_cost FROM items WHERE id = ?').get(id) as { avg_cost: number }).avg_cost;
}

// node:sqlite rows have a null prototype; spread them into plain objects for deep equality.
export function plain<T extends object>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r }));
}
