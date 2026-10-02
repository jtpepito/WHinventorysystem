import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { seedIfEmpty } from './seed';
import { openDb } from './sqlite';

const g = globalThis as unknown as { __inventoryDb?: DatabaseSync };

// One connection per server process (survives dev hot reloads via globalThis).
export function getDb(): DatabaseSync {
  if (!g.__inventoryDb) {
    const file = path.resolve(process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'inventory.db'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = openDb(file);
    seedIfEmpty(db);
    g.__inventoryDb = db;
  }
  return g.__inventoryDb;
}
