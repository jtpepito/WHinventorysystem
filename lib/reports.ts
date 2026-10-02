import type { DatabaseSync } from 'node:sqlite';
import type { CsvCell } from './csv';
import { round } from './num';
import { daysBefore, manilaDay } from './time';

export type ReportKey = 'stock-value' | 'fast-movers' | 'dead-stock' | 'low-stock';
export const REPORT_KEYS: ReportKey[] = ['stock-value', 'fast-movers', 'dead-stock', 'low-stock'];
export type ReportTable = { key: ReportKey; title: string; description: string; headers: string[]; rows: CsvCell[][]; moneyColumns: number[] };

export function isReportKey(s: unknown): s is ReportKey {
  return typeof s === 'string' && (REPORT_KEYS as string[]).includes(s);
}

const ITEM_JOIN = 'FROM items i JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id';

function stockValue(db: DatabaseSync): ReportTable {
  const rows = db
    .prepare(
      `SELECT c.name AS category, COUNT(i.id) AS items, ROUND(COALESCE(SUM(i.qty * i.avg_cost), 0), 2) AS value
       FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.active = 1
       GROUP BY c.id ORDER BY value DESC, c.name`,
    )
    .all() as { category: string; items: number; value: number }[];
  const total = rows.reduce((t, r) => ({ items: t.items + r.items, value: t.value + r.value }), { items: 0, value: 0 });
  return {
    key: 'stock-value', title: 'Stock value by category', description: 'Qty on hand × average cost, active items only.',
    headers: ['Category', 'Active items', 'Stock value (PHP)'],
    rows: [...rows.map((r) => [r.category, r.items, r.value]), ['TOTAL', total.items, round(total.value, 2)]],
    moneyColumns: [2],
  };
}

function fastMovers(db: DatabaseSync, now: string): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, COUNT(*) AS releases,
         ROUND(-SUM(m.qty_delta), 3) AS qty, ROUND(SUM(-m.qty_delta * COALESCE(m.unit_cost, 0)), 2) AS value
       FROM movements m JOIN items i ON i.id = m.item_id JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id
       WHERE m.type = 'release' AND m.created_at >= ?
       GROUP BY i.id ORDER BY releases DESC, qty DESC, i.sku LIMIT 20`,
    )
    .all(daysBefore(now, 30)) as { sku: string; name: string; category: string; unit: string; releases: number; qty: number; value: number }[];
  return {
    key: 'fast-movers', title: 'Fast movers (last 30 days)', description: 'Most frequently released items.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Releases', 'Qty released', 'Value released (PHP)'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.releases, r.qty, r.value]),
    moneyColumns: [6],
  };
}

function deadStock(db: DatabaseSync, now: string): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, i.qty, ROUND(i.qty * i.avg_cost, 2) AS value,
         (SELECT MAX(created_at) FROM movements WHERE item_id = i.id) AS lastAt
       ${ITEM_JOIN}
       WHERE i.active = 1 AND i.qty > 0 AND NOT EXISTS (SELECT 1 FROM movements m WHERE m.item_id = i.id AND m.created_at >= ?)
       ORDER BY value DESC, i.sku`,
    )
    .all(daysBefore(now, 60)) as { sku: string; name: string; category: string; unit: string; qty: number; value: number; lastAt: string | null }[];
  return {
    key: 'dead-stock', title: 'Dead stock (no movement in 60 days)', description: 'Active items with stock on hand that have not moved.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Qty on hand', 'Stock value (PHP)', 'Last movement'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.qty, r.value, r.lastAt ? manilaDay(r.lastAt) : 'Never']),
    moneyColumns: [5],
  };
}

function lowStock(db: DatabaseSync): ReportTable {
  const rows = db
    .prepare(
      `SELECT i.sku, i.name, c.name AS category, u.name AS unit, i.qty, i.reorder_point AS rp, ROUND(i.reorder_point - i.qty, 3) AS shortfall
       ${ITEM_JOIN} WHERE i.active = 1 AND i.qty <= i.reorder_point ORDER BY shortfall DESC, i.sku`,
    )
    .all() as { sku: string; name: string; category: string; unit: string; qty: number; rp: number; shortfall: number }[];
  return {
    key: 'low-stock', title: 'Low stock', description: 'Active items at or below their reorder point.',
    headers: ['SKU', 'Item', 'Category', 'Unit', 'Qty on hand', 'Reorder point', 'Shortfall'],
    rows: rows.map((r) => [r.sku, r.name, r.category, r.unit, r.qty, r.rp, r.shortfall]),
    moneyColumns: [],
  };
}

export function buildReport(db: DatabaseSync, key: ReportKey, now: string): ReportTable {
  switch (key) {
    case 'stock-value': return stockValue(db);
    case 'fast-movers': return fastMovers(db, now);
    case 'dead-stock': return deadStock(db, now);
    case 'low-stock': return lowStock(db);
  }
}
