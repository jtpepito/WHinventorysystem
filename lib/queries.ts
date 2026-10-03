import type { DatabaseSync } from 'node:sqlite';
import type { Actor, MovementType } from './inventory';
import { addDays, isDay, manilaDayStartUtc } from './time';

export type ItemListRow = {
  id: number; sku: string; name: string; categoryId: number; category: string; unitId: number; unit: string;
  qty: number; avgCost: number; reorderPoint: number; active: boolean; low: boolean;
};
export type ItemStatus = 'all' | 'low' | 'active' | 'inactive';
export type ItemFilter = { q?: string; categoryId?: number; status?: ItemStatus };

export function isItemStatus(s: unknown): s is ItemStatus {
  return s === 'all' || s === 'low' || s === 'active' || s === 'inactive';
}

const ITEM_SELECT = `SELECT i.id, i.sku, i.name, i.category_id AS categoryId, c.name AS category, i.unit_id AS unitId, u.name AS unit,
  i.qty, i.avg_cost AS avgCost, i.reorder_point AS reorderPoint, i.active, (i.active = 1 AND i.qty <= i.reorder_point) AS low
  FROM items i JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id`;

type RawItem = Omit<ItemListRow, 'active' | 'low'> & { active: number; low: number };
const toItem = (r: RawItem): ItemListRow => ({ ...r, active: r.active === 1, low: r.low === 1 });

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export function listItems(db: DatabaseSync, f: ItemFilter = {}): ItemListRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(i.sku LIKE ? ESCAPE '\\' OR i.name LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  if (f.categoryId) {
    where.push('i.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.status === 'low') where.push('i.active = 1 AND i.qty <= i.reorder_point');
  if (f.status === 'active') where.push('i.active = 1');
  if (f.status === 'inactive') where.push('i.active = 0');
  const sql = `${ITEM_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.sku`;
  return (db.prepare(sql).all(...params) as RawItem[]).map(toItem);
}

export function getItem(db: DatabaseSync, id: number): ItemListRow | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as RawItem | undefined;
  return r ? toItem(r) : null;
}

export type MovementRow = {
  id: number; createdAt: string; type: MovementType; itemId: number; sku: string; itemName: string; unit: string;
  qtyDelta: number; unitCost: number | null; refNo: string; counterparty: string; note: string; actor: Actor;
};
export type MovementFilter = { itemId?: number; type?: MovementType; from?: string; to?: string; limit?: number };

// The newest `limit` movements, and whether older ones exist (fetches one extra row to know).
export function listMovementsPage(db: DatabaseSync, f: Omit<MovementFilter, 'limit'>, limit: number): { rows: MovementRow[]; truncated: boolean } {
  const rows = listMovements(db, { ...f, limit: limit + 1 });
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export function listMovements(db: DatabaseSync, f: MovementFilter = {}): MovementRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.itemId) { where.push('m.item_id = ?'); params.push(f.itemId); }
  if (f.type) { where.push('m.type = ?'); params.push(f.type); }
  if (isDay(f.from)) { where.push('m.created_at >= ?'); params.push(manilaDayStartUtc(f.from)); }
  if (isDay(f.to)) { where.push('m.created_at < ?'); params.push(manilaDayStartUtc(addDays(f.to, 1))); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `SELECT m.id, m.created_at AS createdAt, m.type, m.item_id AS itemId, i.sku, i.name AS itemName, u.name AS unit,
      m.qty_delta AS qtyDelta, m.unit_cost AS unitCost, m.ref_no AS refNo, m.counterparty, m.note, m.actor
    FROM movements m JOIN items i ON i.id = m.item_id JOIN units u ON u.id = i.unit_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as MovementRow[]).map((r) => ({ ...r }));
}
