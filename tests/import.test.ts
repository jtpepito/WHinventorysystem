import { describe, expect, it } from 'vitest';
import { commitImport, IMPORT_TEMPLATE, MAX_IMPORT_ROWS, planImport } from '@/lib/import';
import { ledgerCheck } from '@/lib/inventory';
import { makeDb, plain } from './helpers';

const AT = '2026-10-02T04:00:00.000Z'; // Oct 2 noon Manila
const csv = (...lines: string[]) => lines.join('\r\n');

describe('planImport', () => {
  it('maps headers in any order, case and common wording, and trims cells', () => {
    const f = makeDb();
    const plan = planImport(f.db, csv(' item code ,UOM,Description,CATEGORY,Qty,Cost,Reorder level', ' n-1 , pc , Nail 2in ,Tools," 1,000 ",85,5')); // Excel quotes a cell that contains a comma
    expect(plan.fileErrors).toEqual([]);
    expect(plan.rows).toEqual([
      { row: 2, sku: 'N-1', name: 'Nail 2in', category: 'Tools', unit: 'pc', reorderPoint: 5, qty: 1000, unitCost: 85, errors: [] },
    ]);
    expect(plan).toMatchObject({ okCount: 1, errorCount: 0, stockedCount: 1, stockValue: 85000, newCategories: [], newUnits: [] });
  });
  it('reports missing required columns and empty files', () => {
    const f = makeDb();
    expect(planImport(f.db, csv('SKU,Name,Category', 'A,B,C')).fileErrors).toEqual([
      'Missing column: Unit. The first row must have headings for SKU, Name, Category and Unit.',
    ]);
    expect(planImport(f.db, '').fileErrors).toEqual(['The file is empty.']);
    expect(planImport(f.db, csv('SKU,Name,Category,Unit')).fileErrors).toEqual(['The file has headings but no item rows.']);
  });
  it('flags bad rows with the spreadsheet row number', () => {
    const f = makeDb();
    const plan = planImport(f.db, csv(
      'SKU,Name,Category,Unit,Qty on hand,Unit cost,Reorder point',
      'bad sku,X,Tools,pc,,,',
      'OK-1,,Tools,pc,,,',
      't-001,Dup of existing,Tools,pc,,,',
      'OK-2,Thing,Tools,pc,abc,,',
      'OK-3,Thing,Tools,pc,-1,5,',
      'OK-4,Thing,Tools,pc,3,,',
      'OK-5,Thing,Tools,pc,3,-2,',
      'OK-6,Thing,Tools,pc,,,ten',
      'OK-7,Thing,,,,,',
      'OK-8,Fine,Tools,pc,,,',
      'ok-8,Repeat,Tools,pc,,,',
    ));
    expect(plan.rows.map((r) => [r.row, r.errors])).toEqual([
      [2, ['SKU must be 1–32 letters, numbers, dots, dashes or underscores.']],
      [3, ['Name is required.']],
      [4, ['SKU T-001 already exists (Hammer).']],
      [5, ['Qty on hand must be a number.']],
      [6, ['Qty on hand must be 0 or more.']],
      [7, ['Unit cost is required when there is stock.']],
      [8, ['Unit cost must be 0 or more.']],
      [9, ['Reorder point must be a number.']],
      [10, ['Category is required.', 'Unit is required.']],
      [11, []],
      [12, ['SKU OK-8 is also on row 11.']],
    ]);
    expect(plan).toMatchObject({ okCount: 1, errorCount: 10 });
  });
  it('lists categories and units it would create, once each, matching existing ones case-insensitively', () => {
    const f = makeDb();
    const plan = planImport(f.db, csv('SKU,Name,Category,Unit', 'A-1,A,tools,PC', 'A-2,B,Electrical,roll', 'A-3,C,electrical,Roll'));
    expect(plan.newCategories).toEqual(['Electrical']);
    expect(plan.newUnits).toEqual(['roll']);
    expect(plan.rows.map((r) => [r.category, r.unit])).toEqual([['Tools', 'pc'], ['Electrical', 'roll'], ['Electrical', 'roll']]);
  });
  it('caps the number of rows', () => {
    const f = makeDb();
    const lines = ['SKU,Name,Category,Unit', ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `X-${i},X,Tools,pc`)];
    expect(planImport(f.db, csv(...lines)).fileErrors).toEqual([`The file has ${MAX_IMPORT_ROWS + 1} rows; the most one import takes is ${MAX_IMPORT_ROWS}. Split it into smaller files.`]);
  });
  it('accepts its own template', () => {
    const f = makeDb();
    const plan = planImport(f.db, IMPORT_TEMPLATE);
    expect(plan.fileErrors).toEqual([]);
    expect(plan.errorCount).toBe(0);
  });
});

describe('commitImport', () => {
  it('creates items, new categories and units, and posts opening stock as one receipt', () => {
    const f = makeDb();
    const result = commitImport(f.db, csv(
      'SKU,Name,Category,Unit,Qty on hand,Unit cost,Reorder point',
      'EL-1,Wire,Electrical,roll,10,2450,2',
      'EL-2,Switch,Electrical,pc,0,65,',
      'TL-9,Pliers,Tools,pc,4,185.5,1',
    ), 'admin', AT);
    expect(result).toEqual({ items: 3, stocked: 2, refNo: 'OPENING-2026-10-02' });
    const items = plain(f.db.prepare("SELECT sku, name, qty, avg_cost, reorder_point FROM items WHERE sku IN ('EL-1','EL-2','TL-9') ORDER BY sku").all());
    expect(items).toEqual([
      { sku: 'EL-1', name: 'Wire', qty: 10, avg_cost: 2450, reorder_point: 2 },
      { sku: 'EL-2', name: 'Switch', qty: 0, avg_cost: 0, reorder_point: 0 },
      { sku: 'TL-9', name: 'Pliers', qty: 4, avg_cost: 185.5, reorder_point: 1 },
    ]);
    const moves = plain(f.db.prepare("SELECT type, qty_delta, unit_cost, ref_no, counterparty, note, actor, created_at FROM movements ORDER BY id").all());
    expect(moves).toEqual([
      { type: 'receive', qty_delta: 10, unit_cost: 2450, ref_no: 'OPENING-2026-10-02', counterparty: 'Opening balance', note: 'Opening balance (CSV import)', actor: 'admin', created_at: AT },
      { type: 'receive', qty_delta: 4, unit_cost: 185.5, ref_no: 'OPENING-2026-10-02', counterparty: 'Opening balance', note: 'Opening balance (CSV import)', actor: 'admin', created_at: AT },
    ]);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM categories WHERE name = 'Electrical'").get()).toMatchObject({ n: 1 });
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM units WHERE name = 'roll'").get()).toMatchObject({ n: 1 });
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
  });
  it('reuses an existing "Opening balance" supplier and skips the receipt when nothing has stock', () => {
    const f = makeDb();
    f.db.prepare("INSERT INTO suppliers (name) VALUES ('Opening balance')").run();
    commitImport(f.db, csv('SKU,Name,Category,Unit,Qty on hand,Unit cost', 'A-1,A,Tools,pc,2,5'), 'admin', AT);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM suppliers WHERE name = 'Opening balance'").get()).toMatchObject({ n: 1 });
    expect(commitImport(f.db, csv('SKU,Name,Category,Unit', 'A-2,B,Tools,pc'), 'admin', AT)).toEqual({ items: 1, stocked: 0, refNo: null });
  });
  it('saves nothing when any row has a problem', () => {
    const f = makeDb();
    const before = plain(f.db.prepare('SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM categories) AS cats').all());
    expect(() => commitImport(f.db, csv('SKU,Name,Category,Unit,Qty on hand,Unit cost', 'NEW-1,Fine,Brand New,pc,1,1', 'NEW-2,,Tools,pc,,'), 'admin', AT)).toThrow(
      '1 row has problems. Fix them in the file and upload it again; nothing was imported.',
    );
    expect(plain(f.db.prepare('SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM categories) AS cats').all())).toEqual(before);
  });
});
