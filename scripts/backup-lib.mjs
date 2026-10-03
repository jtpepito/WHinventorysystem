// Plain JS (not TS) so `node scripts/backup.mjs` runs without a build step.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** @param {Date} now */
export function backupFileName(now) {
  const t = new Date(now.getTime() + MANILA_OFFSET_MS).toISOString(); // 2026-10-03T15:30:05.000Z in Manila wall time
  return `inventory-${t.slice(0, 10)}_${t.slice(11, 19).replace(/:/g, '')}.db`;
}

/**
 * Copies the database with VACUUM INTO: a consistent snapshot that includes WAL contents,
 * safe while the app is running (unlike copying the .db file).
 * @param {string} dbPath
 * @param {string} outDir
 * @param {Date} now
 * @returns {{ file: string; bytes: number; items: number; movements: number }}
 */
export function backupDatabase(dbPath, outDir, now) {
  if (!fs.existsSync(dbPath)) throw new Error(`No database at ${dbPath}. Start the app once, or set DB_PATH.`);
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, backupFileName(now));
  if (fs.existsSync(file)) throw new Error(`${file} already exists; wait a second and run the backup again.`);

  const src = new DatabaseSync(dbPath, { readOnly: true });
  try {
    src.prepare('VACUUM INTO ?').run(file);
  } finally {
    src.close();
  }

  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const check = /** @type {{ integrity_check: string }} */ (copy.prepare('PRAGMA integrity_check').get());
    if (check.integrity_check !== 'ok') throw new Error(`Backup failed its integrity check: ${check.integrity_check}`);
    const count = (/** @type {string} */ table) => /** @type {{ n: number }} */ (copy.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).n;
    return { file, bytes: fs.statSync(file).size, items: count('items'), movements: count('movements') };
  } finally {
    copy.close();
  }
}
