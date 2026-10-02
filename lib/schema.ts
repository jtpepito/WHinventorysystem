export const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  qty REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  avg_cost REAL NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  reorder_point REAL NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN ('receive', 'release', 'adjust')),
  qty_delta REAL NOT NULL CHECK (qty_delta <> 0),
  unit_cost REAL,
  ref_no TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL CHECK (actor IN ('admin', 'encoder')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_item_created ON movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS movements_created ON movements(created_at);
CREATE TRIGGER IF NOT EXISTS movements_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS movements_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are immutable'); END;
CREATE TABLE IF NOT EXISTS count_sessions (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS count_lines (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES count_sessions(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  expected REAL NOT NULL,
  actual REAL CHECK (actual IS NULL OR actual >= 0),
  variance REAL,
  UNIQUE (session_id, item_id)
);
`;
