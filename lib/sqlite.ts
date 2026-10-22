import { DatabaseSync } from 'node:sqlite';
import { DOCUMENT_TRIGGERS, SCHEMA } from './schema';

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  db.exec(DOCUMENT_TRIGGERS);
  migrate(db);
  return db;
}

// Columns added after a database may already exist (CREATE TABLE IF NOT EXISTS won't add them).
function migrate(db: DatabaseSync): void {
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  };
  // 0 marks every line of an existing open count as moved, so it must be refreshed before posting.
  addColumn('count_sessions', 'as_of_movement_id', 'INTEGER NOT NULL DEFAULT 0');
  addColumn('items', 'sell_price', 'REAL NOT NULL DEFAULT 0 CHECK (sell_price >= 0)');
  addColumn('movements', 'purchase_id', 'INTEGER');
  addColumn('movements', 'sale_id', 'INTEGER');
}

// BEGIN IMMEDIATE takes the write lock up front, so a stock check and its update
// can't interleave with another writer. Nested calls join the outer transaction.
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
