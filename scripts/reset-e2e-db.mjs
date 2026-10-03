import fs from 'node:fs';

for (const f of ['data/e2e.db', 'data/e2e.db-wal', 'data/e2e.db-shm']) fs.rmSync(f, { force: true });
