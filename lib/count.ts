import type { DatabaseSync } from 'node:sqlite';
import { type Actor, InventoryError, postAdjustment } from './inventory';
import { round } from './num';
import { tx } from './sqlite';
import { nowIso } from './time';

export type CountLineView = {
  lineId: number; itemId: number; sku: string; name: string; unit: string;
  expected: number; actual: number | null; variance: number | null; currentQty: number;
};
export type CountSessionView = { id: number; scope: string; startedAt: string; postedAt: string | null; lines: CountLineView[] };
export type CountSessionSummary = {
  id: number; scope: string; startedAt: string; postedAt: string | null; lineCount: number; countedCount: number; varianceCount: number;
};

export function startCountSession(db: DatabaseSync, scope: { categoryId: number | null }, at = nowIso()): number {
  return tx(db, () => {
    let label = 'All categories';
    if (scope.categoryId !== null) {
      const c = db.prepare('SELECT name FROM categories WHERE id = ?').get(scope.categoryId) as { name: string } | undefined;
      if (!c) throw new InventoryError('Category not found.');
      label = c.name;
    }
    const items = (
      scope.categoryId === null
        ? db.prepare('SELECT id, qty FROM items WHERE active = 1 ORDER BY sku').all()
        : db.prepare('SELECT id, qty FROM items WHERE active = 1 AND category_id = ? ORDER BY sku').all(scope.categoryId)
    ) as { id: number; qty: number }[];
    if (items.length === 0) throw new InventoryError('There are no active items to count in that category.');
    const id = Number(
      db.prepare('INSERT INTO count_sessions (scope, category_id, started_at) VALUES (?, ?, ?)').run(label, scope.categoryId, at).lastInsertRowid,
    );
    const insert = db.prepare('INSERT INTO count_lines (session_id, item_id, expected) VALUES (?, ?, ?)');
    for (const it of items) insert.run(id, it.id, it.qty);
    return id;
  });
}

export function getCountSession(db: DatabaseSync, id: number): CountSessionView | null {
  const s = db.prepare('SELECT id, scope, started_at AS startedAt, posted_at AS postedAt FROM count_sessions WHERE id = ?').get(id) as
    | Omit<CountSessionView, 'lines'>
    | undefined;
  if (!s) return null;
  const lines = db
    .prepare(
      `SELECT l.id AS lineId, i.id AS itemId, i.sku, i.name, u.name AS unit, l.expected, l.actual, l.variance, i.qty AS currentQty
       FROM count_lines l JOIN items i ON i.id = l.item_id JOIN units u ON u.id = i.unit_id
       WHERE l.session_id = ? ORDER BY i.sku`,
    )
    .all(id) as CountLineView[];
  return { ...s, lines: lines.map((l) => ({ ...l })) };
}

export function listCountSessions(db: DatabaseSync): CountSessionSummary[] {
  const rows = db
    .prepare(
      `SELECT s.id, s.scope, s.started_at AS startedAt, s.posted_at AS postedAt,
         COUNT(l.id) AS lineCount,
         COUNT(l.actual) AS countedCount,
         SUM(CASE WHEN l.variance IS NOT NULL AND l.variance <> 0 THEN 1 ELSE 0 END) AS varianceCount
       FROM count_sessions s LEFT JOIN count_lines l ON l.session_id = s.id
       GROUP BY s.id ORDER BY s.started_at DESC, s.id DESC`,
    )
    .all() as CountSessionSummary[];
  return rows.map((r) => ({ ...r, varianceCount: r.varianceCount ?? 0 }));
}

function openSession(db: DatabaseSync, sessionId: number): void {
  const s = db.prepare('SELECT posted_at FROM count_sessions WHERE id = ?').get(sessionId) as { posted_at: string | null } | undefined;
  if (!s) throw new InventoryError('Count session not found.');
  if (s.posted_at) throw new InventoryError('This count was already posted.');
}

export function saveCountActuals(db: DatabaseSync, sessionId: number, entries: { lineId: number; actual: number | null }[]): void {
  tx(db, () => {
    openSession(db, sessionId);
    for (const e of entries) {
      const line = db.prepare('SELECT expected, session_id FROM count_lines WHERE id = ?').get(e.lineId) as
        | { expected: number; session_id: number }
        | undefined;
      if (!line || line.session_id !== sessionId) throw new InventoryError('That line is not part of this count.');
      if (e.actual === null) {
        db.prepare('UPDATE count_lines SET actual = NULL, variance = NULL WHERE id = ?').run(e.lineId);
        continue;
      }
      if (!Number.isFinite(e.actual) || e.actual < 0) throw new InventoryError('Counted quantity must be 0 or more.');
      if (Math.abs(round(e.actual, 3) - e.actual) > 1e-9) throw new InventoryError('Counted quantity can have at most 3 decimal places.');
      const actual = round(e.actual, 3);
      db.prepare('UPDATE count_lines SET actual = ?, variance = ? WHERE id = ?').run(actual, round(actual - line.expected, 3), e.lineId);
    }
  });
}

export function refreshExpected(db: DatabaseSync, sessionId: number): number {
  return tx(db, () => {
    openSession(db, sessionId);
    const stale = getCountSession(db, sessionId)!.lines.filter((l) => Math.abs(l.currentQty - l.expected) > 1e-9);
    for (const l of stale) {
      const variance = l.actual === null ? null : round(l.actual - l.currentQty, 3);
      db.prepare('UPDATE count_lines SET expected = ?, variance = ? WHERE id = ?').run(l.currentQty, variance, l.lineId);
    }
    return stale.length;
  });
}

export function postCountSession(db: DatabaseSync, sessionId: number, actor: Actor, at = nowIso()): { adjustments: number } {
  return tx(db, () => {
    openSession(db, sessionId);
    const counted = getCountSession(db, sessionId)!.lines.filter((l) => l.actual !== null);
    if (counted.length === 0) throw new InventoryError('Enter at least one actual count before posting.');
    const stale = counted.filter((l) => Math.abs(l.currentQty - l.expected) > 1e-9);
    if (stale.length) {
      throw new InventoryError(
        `Stock moved since this count started for: ${stale.map((l) => l.sku).join(', ')}. Click "Refresh expected", re-check those items, then post.`,
      );
    }
    let adjustments = 0;
    for (const l of counted) {
      if (!l.variance) continue;
      postAdjustment(db, { itemId: l.itemId, qtyDelta: l.variance, refNo: `COUNT-${sessionId}`, note: 'count variance' }, actor, at);
      adjustments++;
    }
    db.prepare('UPDATE count_sessions SET posted_at = ? WHERE id = ?').run(at, sessionId);
    return { adjustments };
  });
}
