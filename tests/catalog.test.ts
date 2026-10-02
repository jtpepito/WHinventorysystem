import { describe, expect, it } from 'vitest';
import {
  addNamed, addSupplier, createItem, deleteNamed, deleteSupplier, listNamed, listSuppliers, renameNamed, setReorderPoints, updateItem,
} from '@/lib/catalog';
import { makeDb } from './helpers';

const get = (db: ReturnType<typeof makeDb>['db'], sql: string, id: number) => ({ ...(db.prepare(sql).get(id) as object) });

describe('categories and units', () => {
  it('adds, renames, and blocks duplicates case-insensitively', () => {
    const { db } = makeDb();
    const id = addNamed(db, 'categories', '  Electrical  ');
    expect(listNamed(db, 'categories').find((c) => c.id === id)?.name).toBe('Electrical');
    expect(() => addNamed(db, 'categories', 'electrical')).toThrow('Category "electrical" already exists.');
    expect(() => addNamed(db, 'units', ' ')).toThrow('Unit name is required.');
    renameNamed(db, 'categories', id, 'Electricals');
    expect(() => renameNamed(db, 'categories', id, 'tools')).toThrow(/already exists/);
  });
  it('refuses to delete a category that items use', () => {
    const { db, cat } = makeDb();
    expect(() => deleteNamed(db, 'categories', cat)).toThrow('Can\'t delete "Tools" — 2 item(s) use it.');
    const id = addNamed(db, 'categories', 'Empty');
    deleteNamed(db, 'categories', id);
    expect(listNamed(db, 'categories').map((c) => c.name)).toEqual(['Paint', 'Tools']);
  });
});

describe('suppliers', () => {
  it('adds, lists and deletes', () => {
    const { db } = makeDb();
    const id = addSupplier(db, 'Metro Electrical', '02 8123 4567');
    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Acme Supply', 'Metro Electrical']);
    expect(() => addSupplier(db, 'acme supply', '')).toThrow(/already exists/);
    deleteSupplier(db, id);
    expect(listSuppliers(db)).toHaveLength(1);
  });
});

describe('items', () => {
  it('creates with an upper-cased SKU and rejects duplicates', () => {
    const { db, cat, unit } = makeDb();
    const id = createItem(db, { sku: ' el-100 ', name: 'Wire', categoryId: cat, unitId: unit, reorderPoint: 5, active: true });
    expect(get(db, 'SELECT sku, qty, avg_cost, reorder_point FROM items WHERE id = ?', id)).toEqual({ sku: 'EL-100', qty: 0, avg_cost: 0, reorder_point: 5 });
    expect(() => createItem(db, { sku: 't-001', name: 'Dup', categoryId: cat, unitId: unit, reorderPoint: 0, active: true })).toThrow(
      'SKU T-001 is already used by Hammer.',
    );
  });
  it('validates SKU, name, category, unit and reorder point', () => {
    const { db, cat, unit } = makeDb();
    const ok = { sku: 'X-1', name: 'X', categoryId: cat, unitId: unit, reorderPoint: 0, active: true };
    expect(() => createItem(db, { ...ok, sku: 'bad sku' })).toThrow(/SKU must be/);
    expect(() => createItem(db, { ...ok, name: '' })).toThrow(/Item name is required/);
    expect(() => createItem(db, { ...ok, categoryId: 999 })).toThrow(/Pick a category/);
    expect(() => createItem(db, { ...ok, unitId: 999 })).toThrow(/Pick a unit/);
    expect(() => createItem(db, { ...ok, reorderPoint: -1 })).toThrow(/Reorder point/);
  });
  it('updates details but never qty or cost', () => {
    const { db, item, cat2, unit } = makeDb();
    updateItem(db, item, { sku: 'T-001', name: 'Claw Hammer', categoryId: cat2, unitId: unit, reorderPoint: 3, active: false });
    expect(get(db, 'SELECT name, category_id, active, qty FROM items WHERE id = ?', item)).toEqual({ name: 'Claw Hammer', category_id: cat2, active: 0, qty: 0 });
    expect(() => updateItem(db, 999, { sku: 'Z', name: 'Z', categoryId: cat2, unitId: unit, reorderPoint: 0, active: true })).toThrow(/Item not found/);
  });
  it('bulk-sets reorder points atomically', () => {
    const { db, item, item2 } = makeDb();
    expect(setReorderPoints(db, [{ itemId: item, reorderPoint: 10 }, { itemId: item2, reorderPoint: 2.5 }])).toBe(2);
    expect(() => setReorderPoints(db, [{ itemId: item, reorderPoint: 1 }, { itemId: item2, reorderPoint: -1 }])).toThrow(/T-002/);
    expect(get(db, 'SELECT reorder_point AS rp FROM items WHERE id = ?', item)).toEqual({ rp: 10 });
  });
});
