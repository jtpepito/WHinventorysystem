import type { DatabaseSync } from 'node:sqlite';
import { manilaDay, nowIso } from './time';

// A database that kept stock before accounting existed has goods on the shelf with no entry behind them.
// On the first open after the upgrade, book that stock once as the owner's capital so the books start true.
// Raw SQL on purpose: this runs inside openDb, before the ledger module is loaded.
export function cutOverOpeningStock(db: DatabaseSync, at = nowIso()): boolean {
  const touched = db
    .prepare("SELECT 1 FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1200' LIMIT 1")
    .get();
  if (touched) return false;
  const { value } = db.prepare('SELECT ROUND(COALESCE(SUM(qty * avg_cost), 0), 2) AS value FROM items').get() as { value: number };
  if (value <= 0) return false;
  const account = (code: string) => (db.prepare('SELECT id FROM accounts WHERE code = ?').get(code) as { id: number }).id;
  db.exec('BEGIN IMMEDIATE');
  try {
    const next = (db.prepare("SELECT next FROM counters WHERE name = 'JE'").get() as { next: number } | undefined)?.next ?? 1;
    db.prepare("INSERT INTO counters (name, next) VALUES ('JE', ?) ON CONFLICT(name) DO UPDATE SET next = excluded.next").run(next + 1);
    const id = Number(
      db.prepare("INSERT INTO journal_entries (entry_no, date, source_type, source_id, memo, actor, created_at) VALUES (?, ?, 'opening', NULL, ?, 'admin', ?)")
        .run(`JE-${String(next).padStart(6, '0')}`, manilaDay(at), 'Cut-over: stock on hand when accounting was switched on', at).lastInsertRowid,
    );
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, 0)').run(id, account('1200'), value);
    db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, 0, ?)').run(id, account('3100'), value);
    db.exec('COMMIT');
    return true;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
