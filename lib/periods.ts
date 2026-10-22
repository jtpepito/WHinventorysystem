import type { DatabaseSync } from 'node:sqlite';
import { type Actor, InventoryError } from './inventory';
import { lockedThrough, setSetting } from './settings';
import { tx } from './sqlite';
import { addDays, isDay, manilaDay, nowIso } from './time';

const month = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', year: 'numeric' });

export function monthLabel(date: string): string {
  return month.format(new Date(`${date.slice(0, 7)}-01T00:00:00.000Z`));
}

function isMonthEnd(date: string): boolean {
  return isDay(date) && addDays(date, 1).slice(0, 7) !== date.slice(0, 7);
}

// Every posting (document, journal, stock movement, count) calls this with its document date.
export function assertOpen(db: DatabaseSync, date: string): void {
  const lock = lockedThrough(db);
  if (lock && date <= lock) throw new InventoryError(`${monthLabel(date)} is closed. Ask the admin to reopen it.`);
}

export function closeThrough(db: DatabaseSync, through: string, actor: Actor, at = nowIso()): void {
  if (!isMonthEnd(through)) throw new InventoryError('Close through a month end, e.g. 2026-09-30.');
  tx(db, () => {
    const lock = lockedThrough(db);
    if (lock && through <= lock) throw new InventoryError(`The books are already closed through ${lock}.`);
    setSetting(db, 'locked_through', through);
    db.prepare("INSERT INTO period_log (action, through, reason, actor, created_at) VALUES ('close', ?, '', ?, ?)").run(through, actor, at);
  });
}

// through = null reopens everything. A reason is required: reopening a closed month is an audit event.
export function reopen(db: DatabaseSync, through: string | null, reason: string, actor: Actor, at = nowIso()): void {
  const why = reason.trim();
  if (why.length < 5) throw new InventoryError('Give a reason for reopening (at least 5 characters).');
  if (through !== null && !isMonthEnd(through)) throw new InventoryError('Reopen back to a month end, e.g. 2026-08-31.');
  tx(db, () => {
    setSetting(db, 'locked_through', through ?? '');
    db.prepare("INSERT INTO period_log (action, through, reason, actor, created_at) VALUES ('reopen', ?, ?, ?, ?)").run(through, why, actor, at);
  });
}

export type PeriodRow = { month: string; closed: boolean; sales: number; purchases: number; expenses: number };

// Newest first, from the earliest journal entry (or this month) to now.
export function listPeriods(db: DatabaseSync, now: string): PeriodRow[] {
  const thisMonth = manilaDay(now).slice(0, 7);
  const first = (db.prepare('SELECT MIN(date) AS d FROM journal_entries').get() as { d: string | null }).d?.slice(0, 7) ?? thisMonth;
  const lock = lockedThrough(db);
  const sum = (table: string, m: string) =>
    (db.prepare(`SELECT COALESCE(SUM(total), 0) AS t FROM ${table} WHERE status = 'posted' AND substr(date, 1, 7) = ?`).get(m) as { t: number }).t;
  const expenses = (m: string) =>
    (db.prepare("SELECT COALESCE(SUM(amount), 0) AS t FROM expenses WHERE status = 'posted' AND substr(date, 1, 7) = ?").get(m) as { t: number }).t;
  const rows: PeriodRow[] = [];
  for (let m = thisMonth; m >= first; m = addDays(`${m}-01`, -1).slice(0, 7)) {
    rows.push({ month: m, closed: !!lock && `${m}-01` <= lock, sales: sum('sales', m), purchases: sum('purchases', m), expenses: expenses(m) });
  }
  return rows;
}

export type PeriodLogRow = { id: number; action: 'close' | 'reopen'; through: string | null; reason: string; actor: string; createdAt: string };

export function periodLog(db: DatabaseSync): PeriodLogRow[] {
  return (db.prepare('SELECT id, action, through, reason, actor, created_at AS createdAt FROM period_log ORDER BY id DESC').all() as PeriodLogRow[]).map((r) => ({ ...r }));
}
