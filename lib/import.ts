import type { DatabaseSync } from 'node:sqlite';
import { addNamed, addSupplier, createItem, SKU_MESSAGE, SKU_PATTERN } from './catalog';
import { parseCsv, toCsv } from './csv';
import { type Actor, InventoryError, postReceipt } from './inventory';
import { parseNumberInput, round } from './num';
import { tx } from './sqlite';
import { manilaDay, nowIso } from './time';

export const MAX_IMPORT_ROWS = 2000;
const OPENING_SUPPLIER = 'Opening balance';

type Field = 'sku' | 'name' | 'category' | 'unit' | 'reorderPoint' | 'qty' | 'unitCost';

// Heading spellings people use in their own sheets, compared lower-case with spaces collapsed.
const HEADINGS: Record<Field, string[]> = {
  sku: ['sku', 'item code', 'code', 'item no', 'item number'],
  name: ['name', 'item', 'item name', 'description'],
  category: ['category'],
  unit: ['unit', 'uom', 'unit of measure'],
  reorderPoint: ['reorder point', 'reorder', 'reorder level', 'min', 'minimum'],
  qty: ['qty on hand', 'qty', 'quantity', 'on hand', 'stock', 'opening qty', 'opening stock'],
  unitCost: ['unit cost', 'cost', 'avg cost', 'average cost'],
};
const REQUIRED: { field: Field; label: string }[] = [
  { field: 'sku', label: 'SKU' }, { field: 'name', label: 'Name' }, { field: 'category', label: 'Category' }, { field: 'unit', label: 'Unit' },
];

export type ImportRow = {
  row: number; // spreadsheet row: the heading row is 1
  sku: string; name: string; category: string; unit: string;
  reorderPoint: number; qty: number; unitCost: number | null;
  errors: string[];
};
export type ImportPlan = {
  fileErrors: string[]; rows: ImportRow[]; newCategories: string[]; newUnits: string[];
  okCount: number; errorCount: number; stockedCount: number; stockValue: number;
};

export const IMPORT_TEMPLATE = toCsv(
  ['SKU', 'Name', 'Category', 'Unit', 'Reorder point', 'Qty on hand', 'Unit cost'],
  [
    ['EXAMPLE-1', 'Example item — delete this row', 'Electrical', 'pc', 10, 25, 95.5],
    ['EXAMPLE-2', 'Another example — delete this row', 'Plumbing', 'roll', 5, 0, null],
  ],
);

const norm = (s: string) => s.trim().replace(/\s+/g, ' ');

function emptyPlan(fileErrors: string[]): ImportPlan {
  return { fileErrors, rows: [], newCategories: [], newUnits: [], okCount: 0, errorCount: 0, stockedCount: 0, stockValue: 0 };
}

// Matches names to existing ones case-insensitively; collects new ones with their first spelling.
function resolver(db: DatabaseSync, table: 'categories' | 'units') {
  const known = new Map((db.prepare(`SELECT name FROM ${table}`).all() as { name: string }[]).map((r) => [r.name.toLowerCase(), r.name]));
  const created: string[] = [];
  return {
    resolve(raw: string): string {
      const name = norm(raw);
      const hit = known.get(name.toLowerCase());
      if (hit) return hit;
      known.set(name.toLowerCase(), name);
      created.push(name);
      return name;
    },
    created,
  };
}

function numberCell(raw: string, label: string, errors: string[], opts: { dp: number }): number | null {
  if (raw.trim() === '') return null;
  const n = parseNumberInput(raw);
  if (n === null) { errors.push(`${label} must be a number.`); return null; }
  if (n < 0) { errors.push(`${label} must be 0 or more.`); return null; }
  if (Math.abs(round(n, opts.dp) - n) > 1e-9) { errors.push(`${label} can have at most ${opts.dp} decimal places.`); return null; }
  return n;
}

export function planImport(db: DatabaseSync, text: string): ImportPlan {
  const table = parseCsv(text);
  if (table.length === 0) return emptyPlan(['The file is empty.']);
  const [header, ...data] = table;

  const col = new Map<Field, number>();
  header.forEach((h, i) => {
    const key = norm(h).toLowerCase().replace(/[.:]/g, '');
    for (const [field, names] of Object.entries(HEADINGS) as [Field, string[]][]) {
      if (!col.has(field) && names.includes(key)) col.set(field, i);
    }
  });
  const missing = REQUIRED.filter((r) => !col.has(r.field)).map((r) => r.label);
  if (missing.length) {
    return emptyPlan([`Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The first row must have headings for SKU, Name, Category and Unit.`]);
  }
  if (data.length === 0) return emptyPlan(['The file has headings but no item rows.']);
  if (data.length > MAX_IMPORT_ROWS) {
    return emptyPlan([`The file has ${data.length} rows; the most one import takes is ${MAX_IMPORT_ROWS}. Split it into smaller files.`]);
  }

  const categories = resolver(db, 'categories');
  const units = resolver(db, 'units');
  const existingSku = db.prepare('SELECT name FROM items WHERE sku = ?');
  const firstRowOfSku = new Map<string, number>();
  const cell = (r: string[], f: Field) => (col.has(f) ? (r[col.get(f)!] ?? '') : '');

  const rows: ImportRow[] = data.map((r, i) => {
    const row = i + 2;
    const errors: string[] = [];
    const sku = norm(cell(r, 'sku')).toUpperCase();
    const name = norm(cell(r, 'name'));
    const rawCategory = cell(r, 'category');
    const rawUnit = cell(r, 'unit');

    if (!SKU_PATTERN.test(sku)) errors.push(SKU_MESSAGE);
    else {
      const dup = existingSku.get(sku) as { name: string } | undefined;
      if (dup) errors.push(`SKU ${sku} already exists (${dup.name}).`);
      else if (firstRowOfSku.has(sku)) errors.push(`SKU ${sku} is also on row ${firstRowOfSku.get(sku)}.`);
      else firstRowOfSku.set(sku, row);
    }
    if (!name) errors.push('Name is required.');
    else if (name.length > 120) errors.push('Name is too long (max 120 characters).');
    if (!norm(rawCategory)) errors.push('Category is required.');
    if (!norm(rawUnit)) errors.push('Unit is required.');

    const qty = numberCell(cell(r, 'qty'), 'Qty on hand', errors, { dp: 3 }) ?? 0;
    const unitCost = numberCell(cell(r, 'unitCost'), 'Unit cost', errors, { dp: 4 });
    const reorderPoint = numberCell(cell(r, 'reorderPoint'), 'Reorder point', errors, { dp: 3 }) ?? 0;
    const costMissing = cell(r, 'unitCost').trim() === '';
    if (qty > 0 && costMissing) errors.push('Unit cost is required when there is stock.');

    return {
      row, sku, name,
      category: norm(rawCategory) ? categories.resolve(rawCategory) : '',
      unit: norm(rawUnit) ? units.resolve(rawUnit) : '',
      reorderPoint, qty, unitCost, errors,
    };
  });

  const ok = rows.filter((r) => r.errors.length === 0);
  const stocked = ok.filter((r) => r.qty > 0);
  return {
    fileErrors: [],
    rows,
    newCategories: categories.created,
    newUnits: units.created,
    okCount: ok.length,
    errorCount: rows.length - ok.length,
    stockedCount: stocked.length,
    stockValue: round(stocked.reduce((s, r) => s + r.qty * (r.unitCost ?? 0), 0), 2),
  };
}

// All or nothing: re-plans the same text, refuses on any problem, then writes in one transaction.
export function commitImport(db: DatabaseSync, text: string, actor: Actor, at = nowIso()): { items: number; stocked: number; refNo: string | null } {
  return tx(db, () => {
    const plan = planImport(db, text);
    if (plan.fileErrors.length) throw new InventoryError(plan.fileErrors.join(' '));
    if (plan.errorCount) {
      const n = plan.errorCount;
      throw new InventoryError(`${n} row${n === 1 ? ' has' : 's have'} problems. Fix them in the file and upload it again; nothing was imported.`);
    }
    for (const name of plan.newCategories) addNamed(db, 'categories', name);
    for (const name of plan.newUnits) addNamed(db, 'units', name);
    const idOf = (table: 'categories' | 'units', name: string) =>
      (db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(name) as { id: number }).id;

    const created = plan.rows.map((r) => ({
      r,
      id: createItem(db, { sku: r.sku, name: r.name, categoryId: idOf('categories', r.category), unitId: idOf('units', r.unit), reorderPoint: r.reorderPoint, active: true }),
    }));

    const lines = created.filter(({ r }) => r.qty > 0).map(({ r, id }) => ({ itemId: id, qty: r.qty, unitCost: r.unitCost ?? 0, label: `Row ${r.row}` }));
    if (lines.length === 0) return { items: created.length, stocked: 0, refNo: null };
    const existing = db.prepare('SELECT id FROM suppliers WHERE name = ?').get(OPENING_SUPPLIER) as { id: number } | undefined;
    const supplierId = existing?.id ?? addSupplier(db, OPENING_SUPPLIER, '');
    const refNo = `OPENING-${manilaDay(at)}`;
    postReceipt(db, { supplierId, refNo, note: 'Opening balance (CSV import)', lines }, actor, at);
    return { items: created.length, stocked: lines.length, refNo };
  });
}
