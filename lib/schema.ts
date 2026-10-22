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
  posted_at TEXT,
  as_of_movement_id INTEGER NOT NULL DEFAULT 0
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

-- Accounting --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  system INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  next INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY,
  entry_no TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id INTEGER,
  memo TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL CHECK (actor IN ('admin', 'encoder')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_entries_date ON journal_entries(date);
CREATE INDEX IF NOT EXISTS journal_entries_source ON journal_entries(source_type, source_id);
CREATE TABLE IF NOT EXISTS journal_lines (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  debit REAL NOT NULL DEFAULT 0,
  credit REAL NOT NULL DEFAULT 0,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND debit + credit > 0)
);
CREATE INDEX IF NOT EXISTS journal_lines_account ON journal_lines(account_id);
CREATE TRIGGER IF NOT EXISTS journal_entries_no_update BEFORE UPDATE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_entries_no_delete BEFORE DELETE ON journal_entries
BEGIN SELECT RAISE(ABORT, 'journal entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_update BEFORE UPDATE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS journal_lines_no_delete BEFORE DELETE ON journal_lines
BEGIN SELECT RAISE(ABORT, 'journal lines are immutable'); END;
CREATE TABLE IF NOT EXISTS period_log (
  id INTEGER PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('close', 'reopen')),
  through TEXT,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact TEXT NOT NULL DEFAULT '',
  terms_days INTEGER NOT NULL DEFAULT 30 CHECK (terms_days >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  customer_name TEXT NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash', 'bank', 'credit')),
  subtotal REAL NOT NULL,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  cogs REAL NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason TEXT,
  voided_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_date ON sales(date);
CREATE TABLE IF NOT EXISTS sale_lines (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty REAL NOT NULL CHECK (qty > 0),
  unit_price REAL NOT NULL CHECK (unit_price >= 0),
  line_total REAL NOT NULL,
  unit_cost REAL NOT NULL DEFAULT 0
);
CREATE TRIGGER IF NOT EXISTS sale_lines_no_update BEFORE UPDATE ON sale_lines
BEGIN SELECT RAISE(ABORT, 'sale lines are immutable'); END;
CREATE TRIGGER IF NOT EXISTS sale_lines_no_delete BEFORE DELETE ON sale_lines
BEGIN SELECT RAISE(ABORT, 'sale lines are immutable'); END;
CREATE TABLE IF NOT EXISTS customer_payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'bank')),
  ref_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason TEXT,
  voided_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name TEXT NOT NULL,
  ref_no TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash', 'bank', 'credit')),
  subtotal REAL NOT NULL,
  vat REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  vat_invoice INTEGER NOT NULL DEFAULT 0 CHECK (vat_invoice IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason TEXT,
  voided_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_date ON purchases(date);
CREATE TABLE IF NOT EXISTS supplier_payments (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'bank')),
  ref_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason TEXT,
  voided_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  payee TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL CHECK (amount > 0),
  vat_input REAL NOT NULL DEFAULT 0,
  vat_invoice INTEGER NOT NULL DEFAULT 0 CHECK (vat_invoice IN (0, 1)),
  method TEXT NOT NULL CHECK (method IN ('cash', 'gcash', 'bank')),
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ref_no TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'void')),
  void_reason TEXT,
  voided_at TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS expenses_date ON expenses(date);
`;

// Documents can only ever change posted → void, and only their void columns: every other column must stay put.
const DOCUMENT_TABLES: { table: string; columns: string[] }[] = [
  { table: 'sales', columns: ['number', 'date', 'customer_id', 'customer_name', 'payment_method', 'subtotal', 'vat', 'total', 'cogs', 'note', 'actor', 'created_at'] },
  { table: 'purchases', columns: ['number', 'date', 'supplier_id', 'supplier_name', 'ref_no', 'payment_method', 'subtotal', 'vat', 'total', 'vat_invoice', 'note', 'actor', 'created_at'] },
  { table: 'customer_payments', columns: ['number', 'date', 'customer_id', 'sale_id', 'amount', 'method', 'ref_no', 'note', 'actor', 'created_at'] },
  { table: 'supplier_payments', columns: ['number', 'date', 'supplier_id', 'purchase_id', 'amount', 'method', 'ref_no', 'note', 'actor', 'created_at'] },
  { table: 'expenses', columns: ['number', 'date', 'account_id', 'payee', 'amount', 'vat_input', 'vat_invoice', 'method', 'supplier_id', 'ref_no', 'note', 'actor', 'created_at'] },
];

// The void trigger is dropped and recreated on every open so an older database picks up the full column list.
export const DOCUMENT_TRIGGERS = DOCUMENT_TABLES.map(
  ({ table, columns }) => `
CREATE TRIGGER IF NOT EXISTS ${table}_no_delete BEFORE DELETE ON ${table}
BEGIN SELECT RAISE(ABORT, '${table} are immutable'); END;
DROP TRIGGER IF EXISTS ${table}_void_only;
CREATE TRIGGER ${table}_void_only BEFORE UPDATE ON ${table}
WHEN NOT (OLD.status = 'posted' AND NEW.status = 'void'
  AND ${columns.map((c) => `NEW.${c} IS OLD.${c}`).join(' AND ')})
BEGIN SELECT RAISE(ABORT, '${table} are immutable'); END;`,
).join('\n');
