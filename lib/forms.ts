import type { ItemInput } from './catalog';
import { InventoryError, type ReceiptLine, type ReleaseLine } from './inventory';
import { parseNumberInput } from './num';

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

function readArray(raw: string): Record<string, unknown>[] {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    v = null;
  }
  if (!Array.isArray(v)) throw new InventoryError('Could not read the line items. Reload the page and try again.');
  return v.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
}

// Row numbers in messages match what the user sees, even when blank rows are skipped.
function rows(raw: string, fields: string[]): { label: string; row: Record<string, unknown> }[] {
  return readArray(raw)
    .map((row, i) => ({ label: `Line ${i + 1}`, row }))
    .filter(({ row }) => !fields.every((f) => isBlank(row[f])));
}

function itemIdOf(v: unknown, label: string): number {
  const n = Number(v);
  if (isBlank(v) || !Number.isInteger(n) || n <= 0) throw new InventoryError(`${label}: pick an item.`);
  return n;
}

function num(v: unknown, message: string): number {
  const n = parseNumberInput(v);
  if (n === null) throw new InventoryError(message);
  return n;
}

export function parseReceiptLines(raw: string): ReceiptLine[] {
  return rows(raw, ['itemId', 'qty', 'unitCost']).map(({ label, row }) => ({
    itemId: itemIdOf(row.itemId, label),
    qty: num(row.qty, `${label}: enter a valid quantity.`),
    unitCost: num(row.unitCost, `${label}: enter a valid unit cost.`),
    label,
  }));
}

export function parseReleaseLines(raw: string): ReleaseLine[] {
  return rows(raw, ['itemId', 'qty']).map(({ label, row }) => ({
    itemId: itemIdOf(row.itemId, label),
    qty: num(row.qty, `${label}: enter a valid quantity.`),
    label,
  }));
}

export function parseCountEntries(raw: string): { lineId: number; actual: number | null }[] {
  return readArray(raw).map((row) => ({
    lineId: Number(row.lineId),
    actual: isBlank(row.actual) ? null : num(row.actual, `${String(row.label ?? 'Line')}: enter a valid count.`),
  }));
}

export function parseReorderUpdates(raw: string): { itemId: number; reorderPoint: number }[] {
  return readArray(raw).map((row) => {
    const label = String(row.sku ?? 'Item');
    if (isBlank(row.reorderPoint)) throw new InventoryError(`${label}: enter a reorder point.`);
    return { itemId: Number(row.itemId), reorderPoint: num(row.reorderPoint, `${label}: enter a valid reorder point.`) };
  });
}

export function readItemForm(fd: FormData): ItemInput {
  const rp = String(fd.get('reorderPoint') ?? '');
  return {
    sku: String(fd.get('sku') ?? ''),
    name: String(fd.get('name') ?? ''),
    categoryId: Number(fd.get('categoryId')),
    unitId: Number(fd.get('unitId')),
    reorderPoint: isBlank(rp) ? 0 : num(rp, 'Reorder point must be a number.'),
    active: fd.get('active') === 'on',
  };
}
