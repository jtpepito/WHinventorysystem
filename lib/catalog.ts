import type { DatabaseSync } from 'node:sqlite';
import { InventoryError } from './inventory';
import { round } from './num';
import { tx } from './sqlite';

export type NamedTable = 'categories' | 'units';
export type Named = { id: number; name: string; inUse: number };
export type Supplier = { id: number; name: string; contact: string };
export type ItemInput = { sku: string; name: string; categoryId: number; unitId: number; reorderPoint: number; active: boolean };

const LABEL: Record<NamedTable, string> = { categories: 'Category', units: 'Unit' };
const ITEM_COL: Record<NamedTable, string> = { categories: 'category_id', units: 'unit_id' };

function cleanName(raw: string, what: string, max = 60): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new InventoryError(`${what} name is required.`);
  if (s.length > max) throw new InventoryError(`${what} name is too long (max ${max} characters).`);
  return s;
}

export function listNamed(db: DatabaseSync, table: NamedTable): Named[] {
  const rows = db
    .prepare(`SELECT t.id, t.name, (SELECT COUNT(*) FROM items i WHERE i.${ITEM_COL[table]} = t.id) AS inUse FROM ${table} t ORDER BY t.name`)
    .all() as Named[];
  return rows.map((r) => ({ ...r }));
}

function assertUniqueName(db: DatabaseSync, table: NamedTable, name: string, exceptId = 0) {
  if (db.prepare(`SELECT 1 FROM ${table} WHERE name = ? AND id <> ?`).get(name, exceptId)) {
    throw new InventoryError(`${LABEL[table]} "${name}" already exists.`);
  }
}

export function addNamed(db: DatabaseSync, table: NamedTable, rawName: string): number {
  const name = cleanName(rawName, LABEL[table]);
  assertUniqueName(db, table, name);
  return Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid);
}

export function renameNamed(db: DatabaseSync, table: NamedTable, id: number, rawName: string): void {
  const name = cleanName(rawName, LABEL[table]);
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw new InventoryError(`${LABEL[table]} not found.`);
  assertUniqueName(db, table, name, id);
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
}

export function deleteNamed(db: DatabaseSync, table: NamedTable, id: number): void {
  const row = listNamed(db, table).find((r) => r.id === id);
  if (!row) throw new InventoryError(`${LABEL[table]} not found.`);
  if (row.inUse > 0) throw new InventoryError(`Can't delete "${row.name}" — ${row.inUse} item(s) use it.`);
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function listSuppliers(db: DatabaseSync): Supplier[] {
  return (db.prepare('SELECT id, name, contact FROM suppliers ORDER BY name').all() as Supplier[]).map((r) => ({ ...r }));
}

function cleanSupplier(db: DatabaseSync, rawName: string, rawContact: string, exceptId = 0) {
  const name = cleanName(rawName, 'Supplier', 120);
  const contact = (rawContact ?? '').trim().slice(0, 200);
  if (db.prepare('SELECT 1 FROM suppliers WHERE name = ? AND id <> ?').get(name, exceptId)) {
    throw new InventoryError(`Supplier "${name}" already exists.`);
  }
  return { name, contact };
}

export function addSupplier(db: DatabaseSync, rawName: string, rawContact: string): number {
  const { name, contact } = cleanSupplier(db, rawName, rawContact);
  return Number(db.prepare('INSERT INTO suppliers (name, contact) VALUES (?, ?)').run(name, contact).lastInsertRowid);
}

export function updateSupplier(db: DatabaseSync, id: number, rawName: string, rawContact: string): void {
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(id)) throw new InventoryError('Supplier not found.');
  const { name, contact } = cleanSupplier(db, rawName, rawContact, id);
  db.prepare('UPDATE suppliers SET name = ?, contact = ? WHERE id = ?').run(name, contact, id);
}

// Movements keep the supplier name as text, so deleting a supplier never breaks history.
export function deleteSupplier(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
}

function checkReorderPoint(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new InventoryError(`${label}: reorder point must be 0 or more.`);
  return round(n, 3);
}

function cleanItem(db: DatabaseSync, input: ItemInput, exceptId = 0): ItemInput {
  const sku = (input.sku ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(sku)) throw new InventoryError('SKU must be 1–32 letters, numbers, dots, dashes or underscores.');
  const name = cleanName(input.name, 'Item', 120);
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(input.categoryId)) throw new InventoryError('Pick a category.');
  if (!db.prepare('SELECT 1 FROM units WHERE id = ?').get(input.unitId)) throw new InventoryError('Pick a unit.');
  const dup = db.prepare('SELECT name FROM items WHERE sku = ? AND id <> ?').get(sku, exceptId) as { name: string } | undefined;
  if (dup) throw new InventoryError(`SKU ${sku} is already used by ${dup.name}.`);
  return { sku, name, categoryId: input.categoryId, unitId: input.unitId, reorderPoint: checkReorderPoint(input.reorderPoint, 'Reorder point'), active: !!input.active };
}

export function createItem(db: DatabaseSync, input: ItemInput): number {
  const i = cleanItem(db, input);
  return Number(
    db.prepare('INSERT INTO items (sku, name, category_id, unit_id, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.sku, i.name, i.categoryId, i.unitId, i.reorderPoint, i.active ? 1 : 0).lastInsertRowid,
  );
}

// Movements and count lines hold quantities in the item's unit, so once either exists the unit is fixed.
export function itemHasHistory(db: DatabaseSync, id: number): boolean {
  return !!db
    .prepare('SELECT EXISTS (SELECT 1 FROM movements WHERE item_id = ?) OR EXISTS (SELECT 1 FROM count_lines WHERE item_id = ?) AS h')
    .get(id, id)?.h;
}

export function updateItem(db: DatabaseSync, id: number, input: ItemInput): void {
  const current = db
    .prepare('SELECT i.sku, i.name, i.unit_id AS unitId, u.name AS unit FROM items i JOIN units u ON u.id = i.unit_id WHERE i.id = ?')
    .get(id) as { sku: string; name: string; unitId: number; unit: string } | undefined;
  if (!current) throw new InventoryError('Item not found.');
  const i = cleanItem(db, input, id);
  if (i.unitId !== current.unitId && itemHasHistory(db, id)) {
    throw new InventoryError(
      `Can't change the unit of ${current.sku} ${current.name} from ${current.unit}: its stock history is recorded in ${current.unit}. Create a new item for the new unit instead.`,
    );
  }
  db.prepare('UPDATE items SET sku = ?, name = ?, category_id = ?, unit_id = ?, reorder_point = ?, active = ? WHERE id = ?')
    .run(i.sku, i.name, i.categoryId, i.unitId, i.reorderPoint, i.active ? 1 : 0, id);
}

export function setReorderPoints(db: DatabaseSync, updates: { itemId: number; reorderPoint: number }[]): number {
  return tx(db, () => {
    for (const u of updates) {
      const item = db.prepare('SELECT sku FROM items WHERE id = ?').get(u.itemId) as { sku: string } | undefined;
      if (!item) throw new InventoryError('Item not found.');
      const rp = checkReorderPoint(u.reorderPoint, item.sku);
      db.prepare('UPDATE items SET reorder_point = ? WHERE id = ?').run(rp, u.itemId);
    }
    return updates.length;
  });
}
