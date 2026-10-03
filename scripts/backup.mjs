// Usage: npm run backup [-- <folder>]
// Safe while the app is running. Default folder: ./backups (or BACKUP_DIR).
import path from 'node:path';
import { backupDatabase } from './backup-lib.mjs';

const dbPath = path.resolve(process.env.DB_PATH ?? path.join('data', 'inventory.db'));
const outDir = path.resolve(process.argv[2] ?? process.env.BACKUP_DIR ?? 'backups');

try {
  const r = backupDatabase(dbPath, outDir, new Date());
  // ASCII only: the scheduled task appends this to a log that Windows tools may read as ANSI.
  console.log(`${new Date().toISOString()} Backup saved: ${r.file}`);
  console.log(`  ${(r.bytes / 1024).toFixed(0)} KB, ${r.items} items, ${r.movements} movements, integrity ok`);
} catch (e) {
  console.error(`${new Date().toISOString()} Backup failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
