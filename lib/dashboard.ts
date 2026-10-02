import type { DatabaseSync } from 'node:sqlite';
import { round } from './num';
import { addDays, formatDayLabel, manilaDay, manilaDayStartUtc } from './time';

export type DayFlow = { day: string; label: string; inValue: number; outValue: number };
export type DashboardStats = { totalSkus: number; stockValue: number; lowStockCount: number; todayMovements: number };

export function dashboardStats(db: DatabaseSync, now: string): DashboardStats {
  const s = db
    .prepare(
      `SELECT COUNT(*) AS totalSkus, ROUND(COALESCE(SUM(qty * avg_cost), 0), 2) AS stockValue,
         SUM(CASE WHEN qty <= reorder_point THEN 1 ELSE 0 END) AS lowStockCount
       FROM items WHERE active = 1`,
    )
    .get() as { totalSkus: number; stockValue: number; lowStockCount: number | null };
  const today = manilaDay(now);
  const t = db
    .prepare('SELECT COUNT(*) AS n FROM movements WHERE created_at >= ? AND created_at < ?')
    .get(manilaDayStartUtc(today), manilaDayStartUtc(addDays(today, 1))) as { n: number };
  return { totalSkus: s.totalSkus, stockValue: s.stockValue, lowStockCount: s.lowStockCount ?? 0, todayMovements: t.n };
}

// Value in/out per Manila day (qty × unit cost), because quantities in mixed units don't add up meaningfully.
export function inOutLast7Days(db: DatabaseSync, now: string): DayFlow[] {
  const today = manilaDay(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const buckets = new Map(days.map((d) => [d, { day: d, label: formatDayLabel(d), inValue: 0, outValue: 0 }]));
  const rows = db
    .prepare(
      `SELECT created_at AS createdAt, type, qty_delta AS qtyDelta, unit_cost AS unitCost FROM movements
       WHERE type IN ('receive', 'release') AND created_at >= ? AND created_at < ?`,
    )
    .all(manilaDayStartUtc(days[0]), manilaDayStartUtc(addDays(today, 1))) as { createdAt: string; type: string; qtyDelta: number; unitCost: number | null }[];
  for (const r of rows) {
    const b = buckets.get(manilaDay(r.createdAt));
    if (!b) continue;
    const value = Math.abs(r.qtyDelta) * (r.unitCost ?? 0);
    if (r.type === 'receive') b.inValue += value;
    else b.outValue += value;
  }
  return days.map((d) => {
    const b = buckets.get(d)!;
    return { ...b, inValue: round(b.inValue, 2), outValue: round(b.outValue, 2) };
  });
}
