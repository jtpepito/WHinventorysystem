import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { backupDatabase, backupFileName } from '../scripts/backup-lib.mjs';
import { postReceipt } from '@/lib/inventory';
import { openDb } from '@/lib/sqlite';

const dirs: string[] = [];
function tmpDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-backup-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function liveDb(dir: string) {
  const file = path.join(dir, 'inventory.db');
  const db = openDb(file);
  db.prepare("INSERT INTO categories (name) VALUES ('Tools')").run();
  db.prepare("INSERT INTO units (name) VALUES ('pc')").run();
  db.prepare("INSERT INTO suppliers (name) VALUES ('Acme')").run();
  db.prepare("INSERT INTO items (sku, name, category_id, unit_id) VALUES ('T-1', 'Hammer', 1, 1)").run();
  postReceipt(db, { supplierId: 1, refNo: 'R-1', lines: [{ itemId: 1, qty: 7, unitCost: 10 }] }, 'admin');
  return { file, db };
}

describe('backupFileName', () => {
  it('stamps the file with Manila date and time', () => {
    expect(backupFileName(new Date('2026-10-03T07:30:05.000Z'))).toBe('inventory-2026-10-03_153005.db');
  });
});

describe('backupDatabase', () => {
  it('copies committed data while the app still has the database open', () => {
    const dir = tmpDir();
    const { file, db } = liveDb(dir); // stays open, WAL not checkpointed — like the running app
    const out = path.join(dir, 'backups');
    const result = backupDatabase(file, out, new Date('2026-10-03T07:30:05.000Z'));
    db.close();
    expect(result.file).toBe(path.join(out, 'inventory-2026-10-03_153005.db'));
    expect(result).toMatchObject({ items: 1, movements: 1 });
    const copy = new DatabaseSync(result.file, { readOnly: true });
    expect({ ...(copy.prepare('SELECT qty FROM items').get() as object) }).toEqual({ qty: 7 });
    expect({ ...(copy.prepare('PRAGMA integrity_check').get() as object) }).toEqual({ integrity_check: 'ok' });
    copy.close();
  });
  it('refuses a missing database instead of backing up an empty one', () => {
    const dir = tmpDir();
    expect(() => backupDatabase(path.join(dir, 'nope.db'), dir, new Date())).toThrow(/No database at/);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
  it('never overwrites an existing backup', () => {
    const dir = tmpDir();
    const { file, db } = liveDb(dir);
    const when = new Date('2026-10-03T07:30:05.000Z');
    backupDatabase(file, dir, when);
    expect(() => backupDatabase(file, dir, when)).toThrow(/already exists/);
    db.close();
  });
});
