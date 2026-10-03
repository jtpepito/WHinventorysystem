import type { DatabaseSync } from 'node:sqlite';
import { formatQty, round } from './num';
import { tx } from './sqlite';
import { nowIso } from './time';

export type Actor = 'admin' | 'encoder';
export type MovementType = 'receive' | 'release' | 'adjust';
export const MOVEMENT_TYPES: MovementType[] = ['receive', 'release', 'adjust'];

export function isMovementType(s: unknown): s is MovementType {
  return typeof s === 'string' && (MOVEMENT_TYPES as string[]).includes(s);
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

const MAX = 1_000_000_000;

export function checkQty(n: number, label: string): number {
  if (!Number.isFinite(n) || n <= 0) throw new InventoryError(`${label}: quantity must be more than 0.`);
  if (n > MAX) throw new InventoryError(`${label}: quantity is too large.`);
  if (Math.abs(round(n, 3) - n) > 1e-9) throw new InventoryError(`${label}: quantity can have at most 3 decimal places.`);
  return round(n, 3);
}

export function checkCost(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0) throw new InventoryError(`${label}: unit cost must be 0 or more.`);
  if (n > MAX) throw new InventoryError(`${label}: unit cost is too large.`);
  return round(n, 4);
}

export function weightedAverage(oldQty: number, oldAvg: number, rcvQty: number, rcvCost: number): number {
  const base = Math.max(oldQty, 0);
  if (base + rcvQty <= 0) return rcvCost;
  return round((base * oldAvg + rcvQty * rcvCost) / (base + rcvQty), 4);
}

type ItemRow = { id: number; sku: string; name: string; qty: number; avg_cost: number; active: number; unit: string };

function loadItem(db: DatabaseSync, itemId: number, label: string, allowInactive = false): ItemRow {
  const row = db
    .prepare('SELECT i.id, i.sku, i.name, i.qty, i.avg_cost, i.active, u.name AS unit FROM items i JOIN units u ON u.id = i.unit_id WHERE i.id = ?')
    .get(itemId) as ItemRow | undefined;
  if (!row) throw new InventoryError(`${label}: item not found.`);
  if (!row.active && !allowInactive) throw new InventoryError(`${label}: ${row.sku} ${row.name} is inactive.`);
  return row;
}

type NewMovement = {
  itemId: number; type: MovementType; qtyDelta: number; unitCost: number | null;
  refNo: string; counterparty: string; note: string; actor: Actor; at: string;
};

function insertMovement(db: DatabaseSync, m: NewMovement): number {
  return Number(
    db
      .prepare('INSERT INTO movements (item_id, type, qty_delta, unit_cost, ref_no, counterparty, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.itemId, m.type, m.qtyDelta, m.unitCost, m.refNo, m.counterparty, m.note, m.actor, m.at).lastInsertRowid,
  );
}

function requireText(raw: string | undefined, message: string, max: number): string {
  const s = (raw ?? '').trim();
  if (!s) throw new InventoryError(message);
  if (s.length > max) throw new InventoryError(`${message.replace(/ is required\.$/, '')} is too long (max ${max} characters).`);
  return s;
}

function optionalText(raw: string | undefined, max: number): string {
  return (raw ?? '').trim().slice(0, max);
}

// label: the row name the user saw (e.g. "Line 3"), so errors point at the right row even after blank rows are dropped.
export type ReceiptLine = { itemId: number; qty: number; unitCost: number; label?: string };
export type ReceiptInput = { supplierId: number; refNo: string; note?: string; lines: ReceiptLine[] };

export function postReceipt(db: DatabaseSync, input: ReceiptInput, actor: Actor, at = nowIso()): number[] {
  const refNo = requireText(input.refNo, 'Reference no. is required.', 60);
  const note = optionalText(input.note, 200);
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  return tx(db, () => {
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(input.supplierId) as { name: string } | undefined;
    if (!supplier) throw new InventoryError('Pick a supplier.');
    return input.lines.map((line, i) => {
      const label = line.label ?? `Line ${i + 1}`;
      const qty = checkQty(line.qty, label);
      const cost = checkCost(line.unitCost, label);
      const item = loadItem(db, line.itemId, label);
      const newAvg = weightedAverage(item.qty, item.avg_cost, qty, cost);
      db.prepare('UPDATE items SET qty = ROUND(qty + ?, 3), avg_cost = ? WHERE id = ?').run(qty, newAvg, item.id);
      return insertMovement(db, { itemId: item.id, type: 'receive', qtyDelta: qty, unitCost: cost, refNo, counterparty: supplier.name, note, actor, at });
    });
  });
}

export type ReleaseLine = { itemId: number; qty: number; label?: string };
export type ReleaseInput = { counterparty: string; refNo: string; note?: string; lines: ReleaseLine[] };

export function postRelease(db: DatabaseSync, input: ReleaseInput, actor: Actor, at = nowIso()): number[] {
  const counterparty = requireText(input.counterparty, 'Destination / customer is required.', 120);
  const refNo = requireText(input.refNo, 'Reference no. is required.', 60);
  const note = optionalText(input.note, 200);
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  return tx(db, () => {
    // Check stock against the total per item, so two lines of the same item can't sneak past.
    const wanted = new Map<number, number>();
    const checked = input.lines.map((line, i) => {
      const label = line.label ?? `Line ${i + 1}`;
      const qty = checkQty(line.qty, label);
      loadItem(db, line.itemId, label);
      wanted.set(line.itemId, round((wanted.get(line.itemId) ?? 0) + qty, 3));
      return { itemId: line.itemId, qty };
    });
    const problems: string[] = [];
    for (const [itemId, want] of wanted) {
      const item = loadItem(db, itemId, 'Release');
      if (want > item.qty + 1e-9) {
        problems.push(`Cannot release ${formatQty(want)} ${item.unit} of ${item.name} (${item.sku}) — only ${formatQty(item.qty)} on hand.`);
      }
    }
    if (problems.length) throw new InventoryError(problems.join(' '));
    return checked.map(({ itemId, qty }) => {
      const item = loadItem(db, itemId, 'Release');
      db.prepare('UPDATE items SET qty = ROUND(qty - ?, 3) WHERE id = ?').run(qty, itemId);
      return insertMovement(db, { itemId, type: 'release', qtyDelta: -qty, unitCost: item.avg_cost, refNo, counterparty, note, actor, at });
    });
  });
}

export function postAdjustment(
  db: DatabaseSync,
  input: { itemId: number; qtyDelta: number; refNo: string; note: string },
  actor: Actor,
  at = nowIso(),
): number {
  const delta = round(input.qtyDelta, 3);
  if (!Number.isFinite(delta) || delta === 0) throw new InventoryError('Adjustment must change the quantity.');
  return tx(db, () => {
    // Inactive items can still hold stock, so a count may correct them.
    const item = loadItem(db, input.itemId, 'Adjustment', true);
    if (item.qty + delta < -1e-9) {
      throw new InventoryError(`Adjustment would take ${item.sku} below zero (on hand ${formatQty(item.qty)}).`);
    }
    db.prepare('UPDATE items SET qty = ROUND(qty + ?, 3) WHERE id = ?').run(delta, item.id);
    return insertMovement(db, { itemId: item.id, type: 'adjust', qtyDelta: delta, unitCost: item.avg_cost, refNo: input.refNo, counterparty: '', note: input.note, actor, at });
  });
}

export type LedgerRow = { itemId: number; sku: string; name: string; cached: number; ledger: number; match: boolean };

export function ledgerCheck(db: DatabaseSync): LedgerRow[] {
  const rows = db
    .prepare(
      `SELECT i.id AS itemId, i.sku, i.name, i.qty AS cached, ROUND(COALESCE(SUM(m.qty_delta), 0), 3) AS ledger
       FROM items i LEFT JOIN movements m ON m.item_id = i.id GROUP BY i.id ORDER BY i.sku`,
    )
    .all() as Omit<LedgerRow, 'match'>[];
  return rows.map((r) => ({ ...r, match: Math.abs(r.cached - r.ledger) < 0.0005 }));
}

export function rebuildCachedQty(db: DatabaseSync): number {
  return tx(db, () => {
    const bad = ledgerCheck(db).filter((r) => !r.match);
    for (const r of bad) db.prepare('UPDATE items SET qty = ? WHERE id = ?').run(r.ledger, r.itemId);
    return bad.length;
  });
}
