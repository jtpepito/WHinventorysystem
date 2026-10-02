# Inventory System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local, single-shop inventory app for a Philippine hardware trader: receive and release stock, live quantities with weighted-average cost, low-stock alerts, physical counts, an immutable ledger, and CSV reports.

**Architecture:** Next.js 15 App Router with server components that read straight from a `node:sqlite` database through small, framework-free domain modules in `lib/` (inventory, count, catalog, queries, reports). Every write is a server action that checks the caller's role, then calls a domain function that runs inside one SQLite transaction. Auth is a role-bearing HMAC cookie, checked in middleware for pages and again inside every server action and route handler.

**Tech Stack:** Next.js 15.5 (webpack), React 19, TypeScript, Tailwind v4, shadcn/ui (+ recharts via shadcn chart), `node:sqlite` on Node 24, Vitest for domain tests, Playwright for end-to-end acceptance.

**Spec:** `docs/SPEC.md`

## Global Constraints

- Next.js **15** (pin `next@15`), App Router, TypeScript, Tailwind, shadcn/ui. No Docker, no cloud services.
- Database: `node:sqlite` (`DatabaseSync`). Singleton in `lib/db.ts`, seeded on first boot when `items` is empty. File path from `DB_PATH`, default `data/inventory.db`.
- Node **24+** (`engines.node: ">=24"`), because `DatabaseSync#isTransaction` is used.
- Auth: two passwords, `ADMIN_PASSWORD` and `ENCODER_PASSWORD`; the role comes from whichever one matches. Cookie signed with HMAC-SHA256 using `SESSION_SECRET` (32+ chars). The cookie is `Secure` only when `COOKIE_SECURE=1`, because shop PCs may reach the app over plain LAN HTTP.
- Roles: **admin** gets everything. **encoder** gets `/receive`, `/release`, `/count`, `/items` (read-only), and `/movements`. Encoders get no dashboard, reports, settings, debug, `/items/new`, or `/items/*/edit`.
- Every server action and route handler calls `requireRole(...)` / `currentRole()` itself. Middleware alone is not enough, because server actions can be invoked from any page path.
- Currency is ₱ (`Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' })`). Dates are shown in Asia/Manila (UTC+8, no DST) and stored as UTC ISO strings (`toISOString()`).
- Quantities are stored with at most 3 decimal places, and avg cost with at most 4. Every cached-qty update is `ROUND(qty ± ?, 3)`.
- Movements are immutable, enforced by SQLite triggers. Corrections are new adjustments only.
- Weighted average on receive: `new_avg = (old_qty*old_avg + rcv_qty*rcv_cost) / (old_qty+rcv_qty)`. Releases never change avg cost.
- Low stock = `active = 1 AND qty <= reorder_point`, shown as a red badge.
- Domain errors are `InventoryError` with a sentence a shop clerk can act on. Anything else is logged, and the user sees "Something went wrong. Nothing was saved."
- Form inputs that must survive a failed submit are **controlled** React state, because React 19 resets uncontrolled fields after a form action.
- Non-goals: barcode scanning, multi-warehouse, purchase orders, POS, customer accounts.

## Review Focus

1. **The same item on two lines of one release** (15 + 10 against 20 on hand) must be blocked as a total of 25, not checked line by line. Test: Task 4, `blocks a release whose lines for one item add up past stock`.
2. **Stock moves while a count is open.** If a receive or release happens between "start count" and "post", posting must refuse with a readable message and offer "Refresh expected". It must never post adjustments computed against a stale expected qty. Test: Task 5, `refuses to post when stock moved since the count started`.
3. **Messy number input** (`"1,000"`, `" 5 "`, `""`, `"abc"`, `"-5"`, `"0"`, `"1e400"`, `"1.0005"`): commas are accepted, everything else gets a line-numbered error, and nothing is posted. Tests: Task 2 `parseNumberInput`, Task 4 `rolls back the whole receipt when a later line is invalid`, Task 9 `parseReceiptLines`.
4. **Manila day boundaries.** A movement at 23:30 Manila (15:30Z) belongs to that Manila day in the ledger date filter, in "today's movements", and in the 7-day chart, and the "to" date includes the whole day. Tests: Task 2 time tests, Task 6 `listMovements` date-window test.
5. **CSV cells with commas, quotes, newlines, ₱, or a leading `=`/`+`/`-`/`@`** must open clean in Excel: UTF-8 BOM, CRLF, RFC-4180 quoting, and a `'` prefix on formula-like text (numbers untouched). Tests: Task 2 `toCsv`, Task 15 e2e CSV download check.

## File Map

```
Inventory/
  app/
    layout.tsx                      root html/body, fonts, title
    page.tsx                        "/" → role home
    login/page.tsx, login/login-form.tsx, login/actions.ts
    (app)/layout.tsx                authed shell + nav, force-dynamic
    (app)/dashboard/page.tsx
    (app)/items/page.tsx, items/[id]/page.tsx, items/new/page.tsx, items/[id]/edit/page.tsx
    (app)/items/item-form.tsx, items/actions.ts
    (app)/receive/page.tsx, receive/receive-form.tsx, receive/actions.ts
    (app)/release/page.tsx, release/release-form.tsx, release/actions.ts
    (app)/movements/page.tsx
    (app)/count/page.tsx, count/start-count-form.tsx, count/[id]/page.tsx, count/[id]/count-sheet.tsx, count/actions.ts
    (app)/reports/page.tsx, reports/csv/[report]/route.ts
    (app)/settings/page.tsx, settings/named-list-editor.tsx, settings/supplier-editor.tsx, settings/reorder-editor.tsx, settings/actions.ts
    (app)/debug/page.tsx, debug/actions.ts
  components/
    ui/*                            shadcn generated
    nav.tsx, page-header.tsx, form-message.tsx, native-select.tsx, stock-badge.tsx, movement-table.tsx, in-out-chart.tsx
  lib/
    num.ts          rounding, number parsing, ₱/qty formatting
    time.ts         Manila day math + formatting
    csv.ts          toCsv
    schema.ts       SCHEMA SQL
    sqlite.ts       openDb, tx
    db.ts           getDb singleton (+ seed on first boot)
    inventory.ts    InventoryError, postReceipt, postRelease, postAdjustment, ledgerCheck, rebuildCachedQty
    count.ts        count sessions
    catalog.ts      categories/units/suppliers/items CRUD, reorder bulk edit
    queries.ts      listItems, getItem, listMovements
    dashboard.ts    dashboardStats, inOutLast7Days
    reports.ts      buildReport + 4 reports
    seed.ts         deterministic seed
    session.ts      Role, sign/verify cookie, canAccess, homeFor (edge-safe)
    passwords.ts    roleForPassword (node crypto)
    auth.ts         currentRole, requireRole (server-only)
    forms.ts        FormData/JSON → typed inputs
    action-result.ts ActionResult, toActionError
    utils.ts        shadcn cn()
  middleware.ts
  tests/*.test.ts, tests/helpers.ts
  e2e/*.spec.ts, e2e/helpers.ts
  scripts/reset-e2e-db.mjs
  next.config.ts, vitest.config.ts, playwright.config.ts, .env.example, README.md
```

---

### Task 1: Scaffold the project, tooling, and GitHub repo

**Files:**
- Create: whole scaffold in `C:\WWJ\Claude Coding\Inventory` (keeping the existing `docs/`)
- Create: `next.config.ts`, `vitest.config.ts`, `tests/smoke.test.ts`, `.env.example`, `.env.local`
- Modify: `package.json`, `.gitignore`

**Interfaces:**
- Produces: `npm test` (vitest), `npm run typecheck`, `npm run build`, `npm run dev`; the `@/` import alias maps to the project root; shadcn components live in `components/ui/*`; `cn` lives in `lib/utils.ts`.

- [ ] **Step 1: Scaffold Next.js 15 into a temp folder, then move it in**

`create-next-app` refuses a non-empty folder, and `Inventory/` already holds `docs/`. Run from `C:\WWJ\Claude Coding` (PowerShell):

```powershell
npx create-next-app@15 inventory-scaffold --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-npm --yes
robocopy inventory-scaffold Inventory /E /XD node_modules .git
Remove-Item -Recurse -Force inventory-scaffold
```

(robocopy exit codes 1–3 mean success.) If the CLI asks about Turbopack, answer **No**.

- [ ] **Step 2: Install dependencies**

From `C:\WWJ\Claude Coding\Inventory`:

```powershell
npm install
npm install -D vitest @types/node@24 @playwright/test
npx playwright install chromium
npx shadcn@latest init -d
npx shadcn@latest add button input label card table badge alert separator chart
```

- [ ] **Step 3: Set scripts and engines in `package.json`**

Replace the `scripts` block and add `engines`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:e2e": "playwright test"
},
"engines": { "node": ">=24" },
```

- [ ] **Step 4: Keep `node:sqlite` out of the webpack bundle**

Webpack in Next 15 does not know `node:sqlite` as a builtin. Overwrite `next.config.ts`:

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals) ? config.externals : [config.externals].filter(Boolean);
      config.externals = [...existing, { 'node:sqlite': 'commonjs node:sqlite' }];
    }
    return config;
  },
};

export default nextConfig;
```

- [ ] **Step 5: Vitest config and a smoke test that proves `node:sqlite` loads under Vitest**

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
```

`tests/smoke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';

describe('node:sqlite', () => {
  it('opens an in-memory database', () => {
    const db = new DatabaseSync(':memory:');
    expect(db.prepare('SELECT 1 + 1 AS two').get()).toEqual({ two: 2 });
  });
});
```

The scaffold's `tsconfig.json` `include` (`**/*.ts`, `**/*.tsx`) already covers `tests/`, `e2e/` and config files, so typecheck sees them.

- [ ] **Step 6: Run the smoke test**

Run: `npm test`
Expected: 1 passed.

- [ ] **Step 7: Env files and gitignore**

`.env.example`:

```
# Login passwords. The role comes from whichever one matches. They must differ.
ADMIN_PASSWORD=change-me-admin
ENCODER_PASSWORD=change-me-encoder
# 32+ random characters. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=
# Optional
# DB_PATH=data/inventory.db
# COOKIE_SECURE=1
```

Create `.env.local` with the same keys, real local passwords, and a generated secret (run the `node -e` command above). Append to `.gitignore`:

```
/data/
/test-results/
/playwright-report/
```

(The scaffold already ignores `.env*`; confirm `.env.example` is **not** ignored. If the pattern is `.env*`, add `!.env.example`.)

- [ ] **Step 8: Verify build and typecheck**

Run: `npm run typecheck; npm run build`
Expected: both succeed.

- [ ] **Step 9: Git init, first commit, private GitHub repo**

```powershell
git init -b main
git add -A
git commit -m "chore: scaffold Next.js 15 inventory app with shadcn, vitest, playwright"
gh repo create jtpepito/inventory --private --source . --push
```

---

### Task 2: Number, time, and CSV utilities

**Files:**
- Create: `lib/num.ts`, `lib/time.ts`, `lib/csv.ts`
- Test: `tests/num.test.ts`, `tests/time.test.ts`, `tests/csv.test.ts`

**Interfaces:**
- Produces:
  - `round(n: number, dp: number): number`
  - `parseNumberInput(raw: unknown): number | null`
  - `formatPeso(n: number): string`, `formatQty(n: number): string`, `formatSignedQty(n: number): string`
  - `nowIso(): string`, `manilaDay(iso: string): string`, `manilaDayStartUtc(day: string): string`, `addDays(day: string, n: number): string`, `isDay(s: unknown): s is string`, `manilaAt(day: string, hour: number, minute?: number): string`, `daysBefore(iso: string, days: number): string`, `formatManila(iso: string): string`, `formatDayLabel(day: string): string`
  - `type CsvCell = string | number | null`, `toCsv(headers: string[], rows: CsvCell[][]): string`

- [ ] **Step 1: Write failing tests**

`tests/num.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatPeso, formatQty, formatSignedQty, parseNumberInput, round } from '@/lib/num';

describe('round', () => {
  it('rounds half away from zero despite float noise', () => {
    expect(round(1.005, 2)).toBe(1.01);
    expect(round(10.00666666, 4)).toBe(10.0067);
    expect(round(-2.5, 0)).toBe(-3);
    expect(Object.is(round(-0.0001, 2), 0)).toBe(true);
  });
});

describe('parseNumberInput', () => {
  it.each([
    ['10', 10], [' 5 ', 5], ['1,000', 1000], ['1,234.5', 1234.5], ['.5', 0.5], ['-5', -5], ['0', 0], [7, 7],
  ])('parses %j', (raw, want) => expect(parseNumberInput(raw)).toBe(want));
  it.each([[''], ['  '], ['abc'], ['1e400'], ['1e3'], ['12abc'], ['--1'], [null], [undefined], [NaN], [Infinity]])(
    'rejects %j', (raw) => expect(parseNumberInput(raw)).toBeNull(),
  );
});

describe('formatting', () => {
  it('formats pesos and quantities', () => {
    expect(formatPeso(75)).toBe('₱75.00');
    expect(formatPeso(1234.5)).toBe('₱1,234.50');
    expect(formatQty(20)).toBe('20');
    expect(formatQty(1.25)).toBe('1.25');
    expect(formatSignedQty(10)).toBe('+10');
    expect(formatSignedQty(-3)).toBe('−3');
  });
});
```

`tests/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addDays, daysBefore, formatDayLabel, isDay, manilaAt, manilaDay, manilaDayStartUtc } from '@/lib/time';

describe('Manila day math', () => {
  it('assigns 23:30 Manila to the same Manila day and 00:00 to the next', () => {
    expect(manilaDay('2026-10-01T15:30:00.000Z')).toBe('2026-10-01');
    expect(manilaDay('2026-10-01T16:00:00.000Z')).toBe('2026-10-02');
  });
  it('finds the UTC instant a Manila day starts', () => {
    expect(manilaDayStartUtc('2026-10-02')).toBe('2026-10-01T16:00:00.000Z');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('validates day strings', () => {
    expect(isDay('2026-10-02')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-1-2')).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });
  it('builds a Manila wall-clock instant', () => {
    expect(manilaAt('2026-10-02', 9, 15)).toBe('2026-10-02T01:15:00.000Z');
  });
  it('subtracts whole days from an instant', () => {
    expect(daysBefore('2026-10-31T00:00:00.000Z', 30)).toBe('2026-10-01T00:00:00.000Z');
  });
  it('labels a day', () => {
    expect(formatDayLabel('2026-10-02')).toBe('Oct 2');
  });
});
```

`tests/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toCsv } from '@/lib/csv';

describe('toCsv', () => {
  it('starts with a BOM and uses CRLF', () => {
    const out = toCsv(['A', 'B'], [[1, 'x']]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('A,B\r\n1,x\r\n');
  });
  it('quotes commas, quotes and newlines', () => {
    const out = toCsv(['Name'], [['Pipe 1/2", blue'], ['two\nlines']]);
    expect(out.slice(1)).toBe('Name\r\n"Pipe 1/2"", blue"\r\n"two\nlines"\r\n');
  });
  it('neutralises formula-looking text but not numbers', () => {
    const out = toCsv(['T', 'N'], [['=SUM(A1)', -3], ['@cmd', 0], ['+63 917', null]]);
    expect(out.slice(1)).toBe("T,N\r\n'=SUM(A1),-3\r\n'@cmd,0\r\n'+63 917,\r\n");
  });
  it('keeps ₱ and other unicode as-is', () => {
    expect(toCsv(['V'], [['₱75.00']]).slice(1)).toBe('V\r\n₱75.00\r\n');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/num`, `@/lib/time`, `@/lib/csv`.

- [ ] **Step 3: Implement**

`lib/num.ts`:

```ts
export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  const r = Math.round(Math.abs(n) * f + 1e-9) / f;
  return Math.sign(n) * r || 0;
}

// Accepts "1,000", " 5 ", ".5", "-5". Rejects blanks, exponents, junk and non-finite values.
export function parseNumberInput(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/,/g, '');
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
const qty = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });

export function formatPeso(n: number): string {
  return peso.format(n);
}

export function formatQty(n: number): string {
  return qty.format(n);
}

export function formatSignedQty(n: number): string {
  return n > 0 ? `+${qty.format(n)}` : n < 0 ? `−${qty.format(-n)}` : '0';
}
```

`lib/time.ts`:

```ts
// Asia/Manila is UTC+8 all year (no DST), so fixed-offset math is exact.
const OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function nowIso(): string {
  return new Date().toISOString();
}

export function manilaDay(iso: string): string {
  return new Date(Date.parse(iso) + OFFSET_MS).toISOString().slice(0, 10);
}

export function manilaDayStartUtc(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - OFFSET_MS).toISOString();
}

export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;
}

export function manilaAt(day: string, hour: number, minute = 0): string {
  return new Date(Date.parse(manilaDayStartUtc(day)) + (hour * 60 + minute) * 60_000).toISOString();
}

export function daysBefore(iso: string, days: number): string {
  return new Date(Date.parse(iso) - days * DAY_MS).toISOString();
}

const dateTime = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const dayLabel = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });

export function formatManila(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function formatDayLabel(day: string): string {
  return dayLabel.format(new Date(`${day}T00:00:00.000Z`));
}
```

`lib/csv.ts`:

```ts
export type CsvCell = string | number | null;

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(v);
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

// UTF-8 BOM so Excel reads ₱ correctly; CRLF line endings; RFC 4180 quoting.
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass. (If `formatPeso` produces `PHP 75.00` on this ICU build, switch to `'₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` with a leading `-` for negatives, and keep the test.)

- [ ] **Step 5: Commit**

```powershell
git add lib tests
git commit -m "feat: number, Manila time and CSV utilities"
git push
```

---

### Task 3: Schema, `openDb`, and transactions

**Files:**
- Create: `lib/schema.ts`, `lib/sqlite.ts`
- Test: `tests/sqlite.test.ts`, `tests/helpers.ts`

**Interfaces:**
- Produces:
  - `SCHEMA: string`
  - `openDb(file: string): DatabaseSync`, which applies pragmas and schema
  - `tx<T>(db: DatabaseSync, fn: () => T): T`, which uses `BEGIN IMMEDIATE`, re-enters when already in a transaction, and rolls back on throw
  - Test helper `makeDb()` returning `{ db, cat, cat2, unit, supplier, item, item2, paint }` (ids), plus `qtyOf(db, id)` and `avgOf(db, id)`

- [ ] **Step 1: Write the test helper and failing tests**

`tests/helpers.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '@/lib/sqlite';

function insert(db: DatabaseSync, sql: string, ...params: (string | number)[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

export function makeDb() {
  const db = openDb(':memory:');
  const cat = insert(db, 'INSERT INTO categories (name) VALUES (?)', 'Tools');
  const cat2 = insert(db, 'INSERT INTO categories (name) VALUES (?)', 'Paint');
  const unit = insert(db, 'INSERT INTO units (name) VALUES (?)', 'pc');
  const supplier = insert(db, 'INSERT INTO suppliers (name, contact) VALUES (?, ?)', 'Acme Supply', '0917 000 0000');
  const itemSql = 'INSERT INTO items (sku, name, category_id, unit_id) VALUES (?, ?, ?, ?)';
  const item = insert(db, itemSql, 'T-001', 'Hammer', cat, unit);
  const item2 = insert(db, itemSql, 'T-002', 'Saw', cat, unit);
  const paint = insert(db, itemSql, 'P-001', 'Latex White', cat2, unit);
  return { db, cat, cat2, unit, supplier, item, item2, paint };
}

export function qtyOf(db: DatabaseSync, id: number): number {
  return (db.prepare('SELECT qty FROM items WHERE id = ?').get(id) as { qty: number }).qty;
}

export function avgOf(db: DatabaseSync, id: number): number {
  return (db.prepare('SELECT avg_cost FROM items WHERE id = ?').get(id) as { avg_cost: number }).avg_cost;
}
```

`tests/sqlite.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { tx } from '@/lib/sqlite';
import { makeDb, qtyOf } from './helpers';

function addMovement(db: ReturnType<typeof makeDb>['db'], itemId: number) {
  db.prepare(
    "INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'receive', 1, 'admin', '2026-10-01T00:00:00.000Z')",
  ).run(itemId);
}

describe('schema', () => {
  it('makes movements immutable', () => {
    const { db, item } = makeDb();
    addMovement(db, item);
    expect(() => db.prepare('UPDATE movements SET qty_delta = 5').run()).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM movements').run()).toThrow(/immutable/);
  });
  it('rejects negative on-hand qty, zero deltas and unknown types', () => {
    const { db, item } = makeDb();
    expect(() => db.prepare('UPDATE items SET qty = -1 WHERE id = ?').run(item)).toThrow();
    expect(() =>
      db.prepare("INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'receive', 0, 'admin', 'x')").run(item),
    ).toThrow();
    expect(() =>
      db.prepare("INSERT INTO movements (item_id, type, qty_delta, actor, created_at) VALUES (?, 'gift', 1, 'admin', 'x')").run(item),
    ).toThrow();
  });
  it('treats SKUs as case-insensitively unique', () => {
    const { db, cat, unit } = makeDb();
    expect(() =>
      db.prepare('INSERT INTO items (sku, name, category_id, unit_id) VALUES (?, ?, ?, ?)').run('t-001', 'Dup', cat, unit),
    ).toThrow();
  });
});

describe('tx', () => {
  it('commits on success', () => {
    const { db, item } = makeDb();
    tx(db, () => db.prepare('UPDATE items SET qty = 5 WHERE id = ?').run(item));
    expect(qtyOf(db, item)).toBe(5);
  });
  it('rolls back on throw', () => {
    const { db, item } = makeDb();
    expect(() =>
      tx(db, () => {
        db.prepare('UPDATE items SET qty = 5 WHERE id = ?').run(item);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(qtyOf(db, item)).toBe(0);
  });
  it('nests without starting a second transaction', () => {
    const { db, item } = makeDb();
    tx(db, () => tx(db, () => db.prepare('UPDATE items SET qty = 2 WHERE id = ?').run(item)));
    expect(qtyOf(db, item)).toBe(2);
    expect(db.isTransaction).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/sqlite.test.ts`
Expected: FAIL — cannot resolve `@/lib/sqlite`.

- [ ] **Step 3: Implement**

`lib/schema.ts`:

```ts
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contact TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL REFERENCES categories(id),
  unit_id INTEGER NOT NULL REFERENCES units(id),
  qty REAL NOT NULL DEFAULT 0 CHECK (qty >= 0),
  avg_cost REAL NOT NULL DEFAULT 0 CHECK (avg_cost >= 0),
  reorder_point REAL NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE TABLE IF NOT EXISTS movements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN ('receive', 'release', 'adjust')),
  qty_delta REAL NOT NULL CHECK (qty_delta <> 0),
  unit_cost REAL,
  ref_no TEXT NOT NULL DEFAULT '',
  counterparty TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL CHECK (actor IN ('admin', 'encoder')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS movements_item_created ON movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS movements_created ON movements(created_at);
CREATE TRIGGER IF NOT EXISTS movements_no_update BEFORE UPDATE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS movements_no_delete BEFORE DELETE ON movements
BEGIN SELECT RAISE(ABORT, 'movements are immutable'); END;
CREATE TABLE IF NOT EXISTS count_sessions (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS count_lines (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES count_sessions(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  expected REAL NOT NULL,
  actual REAL CHECK (actual IS NULL OR actual >= 0),
  variance REAL,
  UNIQUE (session_id, item_id)
);
`;
```

`lib/sqlite.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from './schema';

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// BEGIN IMMEDIATE takes the write lock up front, so a stock check and its update
// can't interleave with another writer. Nested calls join the outer transaction.
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/sqlite.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add lib tests
git commit -m "feat(db): schema with immutable movements, openDb and tx helper"
git push
```

---

### Task 4: Inventory domain — receive, release, adjust, ledger check

**Files:**
- Create: `lib/inventory.ts`
- Test: `tests/inventory.test.ts`

**Interfaces:**
- Consumes: `tx` (Task 3), `round`, `formatQty` (Task 2), `nowIso` (Task 2)
- Produces:
  - `type Actor = 'admin' | 'encoder'`, `type MovementType = 'receive' | 'release' | 'adjust'`, `isMovementType(s: unknown): s is MovementType`
  - `class InventoryError extends Error`
  - `checkQty(n: number, label: string): number`, `checkCost(n: number, label: string): number`
  - `weightedAverage(oldQty: number, oldAvg: number, rcvQty: number, rcvCost: number): number`
  - `type ReceiptLine = { itemId: number; qty: number; unitCost: number }`
  - `type ReceiptInput = { supplierId: number; refNo: string; note?: string; lines: ReceiptLine[] }`
  - `postReceipt(db, input: ReceiptInput, actor: Actor, at?: string): number[]` (movement ids)
  - `type ReleaseLine = { itemId: number; qty: number }`
  - `type ReleaseInput = { counterparty: string; refNo: string; note?: string; lines: ReleaseLine[] }`
  - `postRelease(db, input: ReleaseInput, actor: Actor, at?: string): number[]`
  - `postAdjustment(db, input: { itemId: number; qtyDelta: number; refNo: string; note: string }, actor: Actor, at?: string): number`
  - `type LedgerRow = { itemId: number; sku: string; name: string; cached: number; ledger: number; match: boolean }`
  - `ledgerCheck(db): LedgerRow[]`, `rebuildCachedQty(db): number` (rows fixed)

- [ ] **Step 1: Write failing tests**

`tests/inventory.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  InventoryError, ledgerCheck, postAdjustment, postReceipt, postRelease, rebuildCachedQty, weightedAverage,
} from '@/lib/inventory';
import { avgOf, makeDb, qtyOf } from './helpers';

const AT = '2026-10-02T02:00:00.000Z';

function receive(f: ReturnType<typeof makeDb>, itemId: number, qty: number, unitCost: number, refNo = 'R-1') {
  return postReceipt(f.db, { supplierId: f.supplier, refNo, lines: [{ itemId, qty, unitCost }] }, 'admin', AT);
}

describe('weightedAverage', () => {
  it('uses the receipt cost when nothing is on hand', () => {
    expect(weightedAverage(0, 0, 10, 50)).toBe(50);
  });
  it('blends by quantity and rounds to 4 dp', () => {
    expect(weightedAverage(10, 50, 10, 100)).toBe(75);
    expect(weightedAverage(1, 10, 2, 10.01)).toBe(10.0067);
  });
});

describe('postReceipt', () => {
  it('ACCEPTANCE: 10 @ 50 then 10 @ 100 gives qty 20 at avg 75', () => {
    const f = makeDb();
    receive(f, f.item, 10, 50, 'R-1');
    receive(f, f.item, 10, 100, 'R-2');
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(avgOf(f.db, f.item)).toBe(75);
  });
  it('writes an immutable receive movement with the supplier as counterparty', () => {
    const f = makeDb();
    const [id] = postReceipt(f.db, { supplierId: f.supplier, refNo: ' INV-9 ', note: 'first', lines: [{ itemId: f.item, qty: 10, unitCost: 50 }] }, 'encoder', AT);
    expect(f.db.prepare('SELECT * FROM movements WHERE id = ?').get(id)).toMatchObject({
      type: 'receive', qty_delta: 10, unit_cost: 50, ref_no: 'INV-9', counterparty: 'Acme Supply', note: 'first', actor: 'encoder', created_at: AT,
    });
  });
  it('requires a reference, a supplier and at least one line', () => {
    const f = makeDb();
    const line = [{ itemId: f.item, qty: 1, unitCost: 1 }];
    expect(() => postReceipt(f.db, { supplierId: f.supplier, refNo: '  ', lines: line }, 'admin')).toThrow(/Reference no/);
    expect(() => postReceipt(f.db, { supplierId: 999, refNo: 'R', lines: line }, 'admin')).toThrow(/supplier/);
    expect(() => postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [] }, 'admin')).toThrow(/at least one line/);
  });
  it.each([0, -1, NaN, Infinity, 1.0005, 2e9])('rejects qty %s', (qty) => {
    const f = makeDb();
    expect(() => receive(f, f.item, qty, 10)).toThrow(InventoryError);
  });
  it('rejects a negative cost but allows free goods at 0', () => {
    const f = makeDb();
    expect(() => receive(f, f.item, 1, -1)).toThrow(/unit cost/);
    receive(f, f.item, 1, 0);
    expect(qtyOf(f.db, f.item)).toBe(1);
  });
  it('rolls back the whole receipt when a later line is invalid', () => {
    const f = makeDb();
    expect(() =>
      postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 5, unitCost: 10 }, { itemId: f.item2, qty: -2, unitCost: 10 }] }, 'admin'),
    ).toThrow(/Line 2/);
    expect(qtyOf(f.db, f.item)).toBe(0);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM movements').get()).toEqual({ n: 0 });
  });
  it('rejects unknown and inactive items', () => {
    const f = makeDb();
    expect(() => receive(f, 999, 1, 1)).toThrow(/Line 1: item not found/);
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.item);
    expect(() => receive(f, f.item, 1, 1)).toThrow(/inactive/);
  });
});

describe('postRelease', () => {
  function stocked() {
    const f = makeDb();
    receive(f, f.item, 10, 50, 'R-1');
    receive(f, f.item, 10, 100, 'R-2');
    return f;
  }
  it('ACCEPTANCE: releasing 25 of 20 is blocked with a readable error', () => {
    const f = stocked();
    expect(() => postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D-1', lines: [{ itemId: f.item, qty: 25 }] }, 'encoder')).toThrow(
      'Cannot release 25 pc of Hammer (T-001) — only 20 on hand.',
    );
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM movements WHERE type = 'release'").get()).toEqual({ n: 0 });
  });
  it('blocks a release whose lines for one item add up past stock', () => {
    const f = stocked();
    expect(() =>
      postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D-1', lines: [{ itemId: f.item, qty: 15 }, { itemId: f.item, qty: 10 }] }, 'encoder'),
    ).toThrow(/Cannot release 25 pc of Hammer/);
    expect(qtyOf(f.db, f.item)).toBe(20);
  });
  it('decrements qty, keeps avg cost, and snapshots avg cost on the movement', () => {
    const f = stocked();
    const [id] = postRelease(f.db, { counterparty: 'JDC Construction', refNo: 'D-2', lines: [{ itemId: f.item, qty: 20 }] }, 'encoder', AT);
    expect(qtyOf(f.db, f.item)).toBe(0);
    expect(avgOf(f.db, f.item)).toBe(75);
    expect(f.db.prepare('SELECT type, qty_delta, unit_cost, counterparty FROM movements WHERE id = ?').get(id)).toEqual({
      type: 'release', qty_delta: -20, unit_cost: 75, counterparty: 'JDC Construction',
    });
  });
  it('requires a destination and a reference', () => {
    const f = stocked();
    const lines = [{ itemId: f.item, qty: 1 }];
    expect(() => postRelease(f.db, { counterparty: ' ', refNo: 'D', lines }, 'admin')).toThrow(/Destination/);
    expect(() => postRelease(f.db, { counterparty: 'X', refNo: '', lines }, 'admin')).toThrow(/Reference no/);
  });
});

describe('postAdjustment', () => {
  it('applies a signed delta and refuses to go below zero', () => {
    const f = makeDb();
    receive(f, f.item, 5, 10);
    postAdjustment(f.db, { itemId: f.item, qtyDelta: -3, refNo: 'COUNT-1', note: 'count variance' }, 'admin', AT);
    expect(qtyOf(f.db, f.item)).toBe(2);
    expect(() => postAdjustment(f.db, { itemId: f.item, qtyDelta: -3, refNo: 'X', note: 'x' }, 'admin')).toThrow(/below zero/);
    expect(() => postAdjustment(f.db, { itemId: f.item, qtyDelta: 0, refNo: 'X', note: 'x' }, 'admin')).toThrow(InventoryError);
  });
});

describe('ledger check', () => {
  it('matches after normal posting, detects drift, and rebuilds', () => {
    const f = makeDb();
    receive(f, f.item, 10, 50);
    postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId: f.item, qty: 4 }] }, 'admin');
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
    f.db.prepare('UPDATE items SET qty = 999 WHERE id = ?').run(f.item);
    const bad = ledgerCheck(f.db).filter((r) => !r.match);
    expect(bad).toEqual([{ itemId: f.item, sku: 'T-001', name: 'Hammer', cached: 999, ledger: 6, match: false }]);
    expect(rebuildCachedQty(f.db)).toBe(1);
    expect(qtyOf(f.db, f.item)).toBe(6);
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/inventory.test.ts`
Expected: FAIL — cannot resolve `@/lib/inventory`.

- [ ] **Step 3: Implement `lib/inventory.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { formatQty, round } from './num';
import { tx } from './sqlite';
import { nowIso } from './time';

export type Actor = 'admin' | 'encoder';
export type MovementType = 'receive' | 'release' | 'adjust';
export const MOVEMENT_TYPES: MovementType[] = ['receive', 'release', 'adjust'];

export function isMovementType(s: unknown): s is MovementType {
  return typeof s === 'string' && (MOVEMENT_TYPES as string[]).includes(s);
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

const MAX = 1_000_000_000;

export function checkQty(n: number, label: string): number {
  if (!Number.isFinite(n) || n <= 0) throw new InventoryError(`${label}: quantity must be more than 0.`);
  if (n > MAX) throw new InventoryError(`${label}: quantity is too large.`);
  if (Math.abs(round(n, 3) - n) > 1e-9) throw new InventoryError(`${label}: quantity can have at most 3 decimal places.`);
  return round(n, 3);
}

export function checkCost(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0) throw new InventoryError(`${label}: unit cost must be 0 or more.`);
  if (n > MAX) throw new InventoryError(`${label}: unit cost is too large.`);
  return round(n, 4);
}

export function weightedAverage(oldQty: number, oldAvg: number, rcvQty: number, rcvCost: number): number {
  const base = Math.max(oldQty, 0);
  if (base + rcvQty <= 0) return rcvCost;
  return round((base * oldAvg + rcvQty * rcvCost) / (base + rcvQty), 4);
}

type ItemRow = { id: number; sku: string; name: string; qty: number; avg_cost: number; active: number; unit: string };

function loadItem(db: DatabaseSync, itemId: number, label: string): ItemRow {
  const row = db
    .prepare('SELECT i.id, i.sku, i.name, i.qty, i.avg_cost, i.active, u.name AS unit FROM items i JOIN units u ON u.id = i.unit_id WHERE i.id = ?')
    .get(itemId) as ItemRow | undefined;
  if (!row) throw new InventoryError(`${label}: item not found.`);
  if (!row.active) throw new InventoryError(`${label}: ${row.sku} ${row.name} is inactive.`);
  return row;
}

type NewMovement = {
  itemId: number; type: MovementType; qtyDelta: number; unitCost: number | null;
  refNo: string; counterparty: string; note: string; actor: Actor; at: string;
};

function insertMovement(db: DatabaseSync, m: NewMovement): number {
  return Number(
    db
      .prepare('INSERT INTO movements (item_id, type, qty_delta, unit_cost, ref_no, counterparty, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(m.itemId, m.type, m.qtyDelta, m.unitCost, m.refNo, m.counterparty, m.note, m.actor, m.at).lastInsertRowid,
  );
}

function requireText(raw: string | undefined, message: string, max: number): string {
  const s = (raw ?? '').trim();
  if (!s) throw new InventoryError(message);
  if (s.length > max) throw new InventoryError(`${message.replace(/ is required\.$/, '')} is too long (max ${max} characters).`);
  return s;
}

function optionalText(raw: string | undefined, max: number): string {
  return (raw ?? '').trim().slice(0, max);
}

export type ReceiptLine = { itemId: number; qty: number; unitCost: number };
export type ReceiptInput = { supplierId: number; refNo: string; note?: string; lines: ReceiptLine[] };

export function postReceipt(db: DatabaseSync, input: ReceiptInput, actor: Actor, at = nowIso()): number[] {
  const refNo = requireText(input.refNo, 'Reference no. is required.', 60);
  const note = optionalText(input.note, 200);
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  return tx(db, () => {
    const supplier = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(input.supplierId) as { name: string } | undefined;
    if (!supplier) throw new InventoryError('Pick a supplier.');
    return input.lines.map((line, i) => {
      const label = `Line ${i + 1}`;
      const qty = checkQty(line.qty, label);
      const cost = checkCost(line.unitCost, label);
      const item = loadItem(db, line.itemId, label);
      const newAvg = weightedAverage(item.qty, item.avg_cost, qty, cost);
      db.prepare('UPDATE items SET qty = ROUND(qty + ?, 3), avg_cost = ? WHERE id = ?').run(qty, newAvg, item.id);
      return insertMovement(db, { itemId: item.id, type: 'receive', qtyDelta: qty, unitCost: cost, refNo, counterparty: supplier.name, note, actor, at });
    });
  });
}

export type ReleaseLine = { itemId: number; qty: number };
export type ReleaseInput = { counterparty: string; refNo: string; note?: string; lines: ReleaseLine[] };

export function postRelease(db: DatabaseSync, input: ReleaseInput, actor: Actor, at = nowIso()): number[] {
  const counterparty = requireText(input.counterparty, 'Destination / customer is required.', 120);
  const refNo = requireText(input.refNo, 'Reference no. is required.', 60);
  const note = optionalText(input.note, 200);
  if (input.lines.length === 0) throw new InventoryError('Add at least one line.');
  return tx(db, () => {
    // Check stock against the total per item, so two lines of the same item can't sneak past.
    const wanted = new Map<number, number>();
    const checked = input.lines.map((line, i) => {
      const label = `Line ${i + 1}`;
      const qty = checkQty(line.qty, label);
      loadItem(db, line.itemId, label);
      wanted.set(line.itemId, round((wanted.get(line.itemId) ?? 0) + qty, 3));
      return { itemId: line.itemId, qty };
    });
    const problems: string[] = [];
    for (const [itemId, want] of wanted) {
      const item = loadItem(db, itemId, 'Release');
      if (want > item.qty + 1e-9) {
        problems.push(`Cannot release ${formatQty(want)} ${item.unit} of ${item.name} (${item.sku}) — only ${formatQty(item.qty)} on hand.`);
      }
    }
    if (problems.length) throw new InventoryError(problems.join(' '));
    return checked.map(({ itemId, qty }) => {
      const item = loadItem(db, itemId, 'Release');
      db.prepare('UPDATE items SET qty = ROUND(qty - ?, 3) WHERE id = ?').run(qty, itemId);
      return insertMovement(db, { itemId, type: 'release', qtyDelta: -qty, unitCost: item.avg_cost, refNo, counterparty, note, actor, at });
    });
  });
}

export function postAdjustment(
  db: DatabaseSync,
  input: { itemId: number; qtyDelta: number; refNo: string; note: string },
  actor: Actor,
  at = nowIso(),
): number {
  const delta = round(input.qtyDelta, 3);
  if (!Number.isFinite(delta) || delta === 0) throw new InventoryError('Adjustment must change the quantity.');
  return tx(db, () => {
    const item = loadItem(db, input.itemId, 'Adjustment');
    if (item.qty + delta < -1e-9) {
      throw new InventoryError(`Adjustment would take ${item.sku} below zero (on hand ${formatQty(item.qty)}).`);
    }
    db.prepare('UPDATE items SET qty = ROUND(qty + ?, 3) WHERE id = ?').run(delta, item.id);
    return insertMovement(db, { itemId: item.id, type: 'adjust', qtyDelta: delta, unitCost: item.avg_cost, refNo: input.refNo, counterparty: '', note: input.note, actor, at });
  });
}

export type LedgerRow = { itemId: number; sku: string; name: string; cached: number; ledger: number; match: boolean };

export function ledgerCheck(db: DatabaseSync): LedgerRow[] {
  const rows = db
    .prepare(
      `SELECT i.id AS itemId, i.sku, i.name, i.qty AS cached, ROUND(COALESCE(SUM(m.qty_delta), 0), 3) AS ledger
       FROM items i LEFT JOIN movements m ON m.item_id = i.id GROUP BY i.id ORDER BY i.sku`,
    )
    .all() as Omit<LedgerRow, 'match'>[];
  return rows.map((r) => ({ ...r, match: Math.abs(r.cached - r.ledger) < 0.0005 }));
}

export function rebuildCachedQty(db: DatabaseSync): number {
  return tx(db, () => {
    const bad = ledgerCheck(db).filter((r) => !r.match);
    for (const r of bad) db.prepare('UPDATE items SET qty = ? WHERE id = ?').run(r.ledger, r.itemId);
    return bad.length;
  });
}
```

Note: `toMatchObject`/`toEqual` against rows works because `node:sqlite` rows are plain (null-prototype) objects; if `toEqual` complains about prototypes, wrap with `{ ...row }`.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/inventory.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add lib tests
git commit -m "feat(inventory): receive with weighted average, blocked release, adjustments, ledger check"
git push
```

---

### Task 5: Count domain

**Files:**
- Create: `lib/count.ts`
- Test: `tests/count.test.ts`

**Interfaces:**
- Consumes: `tx`, `InventoryError`, `postAdjustment`, `Actor`, `checkQty`-style rules, `round`, `nowIso`
- Produces:
  - `startCountSession(db, scope: { categoryId: number | null }, at?: string): number`
  - `type CountLineView = { lineId: number; itemId: number; sku: string; name: string; unit: string; expected: number; actual: number | null; variance: number | null; currentQty: number }`
  - `type CountSessionView = { id: number; scope: string; startedAt: string; postedAt: string | null; lines: CountLineView[] }`
  - `getCountSession(db, id: number): CountSessionView | null`
  - `type CountSessionSummary = { id: number; scope: string; startedAt: string; postedAt: string | null; lineCount: number; countedCount: number; varianceCount: number }`
  - `listCountSessions(db): CountSessionSummary[]`
  - `saveCountActuals(db, sessionId: number, entries: { lineId: number; actual: number | null }[]): void`
  - `refreshExpected(db, sessionId: number): number`
  - `postCountSession(db, sessionId: number, actor: Actor, at?: string): { adjustments: number }`
  - Adjustment movements use `refNo = 'COUNT-<id>'` and `note = 'count variance'`.

- [ ] **Step 1: Write failing tests**

`tests/count.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getCountSession, listCountSessions, postCountSession, refreshExpected, saveCountActuals, startCountSession } from '@/lib/count';
import { ledgerCheck, postReceipt, postRelease } from '@/lib/inventory';
import { makeDb, qtyOf } from './helpers';

function stocked() {
  const f = makeDb();
  postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 20, unitCost: 50 }, { itemId: f.item2, qty: 5, unitCost: 10 }, { itemId: f.paint, qty: 4, unitCost: 600 }] }, 'admin');
  return f;
}

function lineFor(f: ReturnType<typeof makeDb>, sessionId: number, itemId: number) {
  return getCountSession(f.db, sessionId)!.lines.find((l) => l.itemId === itemId)!;
}

describe('count sessions', () => {
  it('starts with only the chosen category, expected = current qty', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const s = getCountSession(f.db, id)!;
    expect(s.scope).toBe('Tools');
    expect(s.lines.map((l) => [l.sku, l.expected, l.actual])).toEqual([['T-001', 20, null], ['T-002', 5, null]]);
  });
  it('scope "all" covers every active item', () => {
    const f = stocked();
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.item2);
    const s = getCountSession(f.db, startCountSession(f.db, { categoryId: null }))!;
    expect(s.scope).toBe('All categories');
    expect(s.lines.map((l) => l.sku)).toEqual(['P-001', 'T-001']);
  });
  it('ACCEPTANCE: a variance of −3 posts an adjust movement of −3 and the ledger still matches', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 17 }, { lineId: lineFor(f, id, f.item2).lineId, actual: 5 }]);
    expect(lineFor(f, id, f.item).variance).toBe(-3);
    expect(postCountSession(f.db, id, 'encoder')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(17);
    expect(f.db.prepare("SELECT qty_delta, ref_no, note, actor FROM movements WHERE type = 'adjust'").all()).toEqual([
      { qty_delta: -3, ref_no: `COUNT-${id}`, note: 'count variance', actor: 'encoder' },
    ]);
    expect(ledgerCheck(f.db).every((r) => r.match)).toBe(true);
    expect(getCountSession(f.db, id)!.postedAt).not.toBeNull();
  });
  it('skips uncounted lines and requires at least one count', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/at least one actual/);
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 22 }]);
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(22);
    expect(qtyOf(f.db, f.item2)).toBe(5);
  });
  it('cannot be posted or edited twice', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const lineId = lineFor(f, id, f.item).lineId;
    saveCountActuals(f.db, id, [{ lineId, actual: 20 }]);
    postCountSession(f.db, id, 'admin');
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/already posted/);
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: 1 }])).toThrow(/already posted/);
  });
  it('rejects negative or over-precise actuals and foreign lines', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    const other = startCountSession(f.db, { categoryId: f.cat2 });
    const lineId = lineFor(f, id, f.item).lineId;
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: -1 }])).toThrow(/0 or more/);
    expect(() => saveCountActuals(f.db, id, [{ lineId, actual: 1.0001 }])).toThrow(/3 decimal/);
    expect(() => saveCountActuals(f.db, other, [{ lineId, actual: 1 }])).toThrow(/not part of this count/);
  });
  it('refuses to post when stock moved since the count started', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat });
    postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D', lines: [{ itemId: f.item, qty: 5 }] }, 'encoder');
    saveCountActuals(f.db, id, [{ lineId: lineFor(f, id, f.item).lineId, actual: 14 }]);
    expect(() => postCountSession(f.db, id, 'admin')).toThrow(/Stock moved since this count started for: T-001/);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM movements WHERE type = 'adjust'").get()).toEqual({ n: 0 });
    expect(refreshExpected(f.db, id)).toBe(1);
    expect(lineFor(f, id, f.item)).toMatchObject({ expected: 15, actual: 14, variance: -1 });
    expect(postCountSession(f.db, id, 'admin')).toEqual({ adjustments: 1 });
    expect(qtyOf(f.db, f.item)).toBe(14);
  });
  it('lists sessions newest first with progress counts', () => {
    const f = stocked();
    const a = startCountSession(f.db, { categoryId: f.cat }, '2026-10-01T00:00:00.000Z');
    const b = startCountSession(f.db, { categoryId: null }, '2026-10-02T00:00:00.000Z');
    saveCountActuals(f.db, a, [{ lineId: lineFor(f, a, f.item).lineId, actual: 19 }]);
    expect(listCountSessions(f.db).map((s) => [s.id, s.lineCount, s.countedCount, s.varianceCount])).toEqual([[b, 3, 0, 0], [a, 2, 1, 1]]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/count.test.ts`
Expected: FAIL — cannot resolve `@/lib/count`.

- [ ] **Step 3: Implement `lib/count.ts`**

```ts
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
  return db
    .prepare(
      `SELECT s.id, s.scope, s.started_at AS startedAt, s.posted_at AS postedAt,
         COUNT(l.id) AS lineCount,
         COUNT(l.actual) AS countedCount,
         SUM(CASE WHEN l.variance IS NOT NULL AND l.variance <> 0 THEN 1 ELSE 0 END) AS varianceCount
       FROM count_sessions s LEFT JOIN count_lines l ON l.session_id = s.id
       GROUP BY s.id ORDER BY s.started_at DESC, s.id DESC`,
    )
    .all() as CountSessionSummary[];
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
```

`postAdjustment` rejects inactive items. An item deactivated mid-count will therefore block posting with "T-001 Hammer is inactive". That is acceptable and readable.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/count.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add lib tests
git commit -m "feat(count): count sessions with stale-stock guard and variance adjustments"
git push
```


### Task 6: Catalog, queries, dashboard, and reports domain

**Files:**
- Create: `lib/catalog.ts`, `lib/queries.ts`, `lib/dashboard.ts`, `lib/reports.ts`
- Test: `tests/catalog.test.ts`, `tests/queries.test.ts`, `tests/reports.test.ts`

**Interfaces:**
- Consumes: `tx`, `InventoryError`, `Actor`, `MovementType`, `round`, the time helpers, `CsvCell`
- Produces (`lib/catalog.ts`):
  - `type NamedTable = 'categories' | 'units'`, `type Named = { id: number; name: string; inUse: number }`
  - `listNamed(db, table): Named[]`, `addNamed(db, table, name: string): number`, `renameNamed(db, table, id: number, name: string): void`, `deleteNamed(db, table, id: number): void`
  - `type Supplier = { id: number; name: string; contact: string }`
  - `listSuppliers(db): Supplier[]`, `addSupplier(db, name: string, contact: string): number`, `updateSupplier(db, id: number, name: string, contact: string): void`, `deleteSupplier(db, id: number): void`
  - `type ItemInput = { sku: string; name: string; categoryId: number; unitId: number; reorderPoint: number; active: boolean }`
  - `createItem(db, input: ItemInput): number`, `updateItem(db, id: number, input: ItemInput): void`
  - `setReorderPoints(db, updates: { itemId: number; reorderPoint: number }[]): number`
- Produces (`lib/queries.ts`):
  - `type ItemListRow = { id; sku; name; categoryId; category; unitId; unit; qty; avgCost; reorderPoint; active: boolean; low: boolean }` (numbers and strings as named)
  - `type ItemStatus = 'all' | 'low' | 'active' | 'inactive'`, `isItemStatus(s: unknown): s is ItemStatus`
  - `type ItemFilter = { q?: string; categoryId?: number; status?: ItemStatus }`
  - `listItems(db, f?: ItemFilter): ItemListRow[]`, `getItem(db, id: number): ItemListRow | null`
  - `type MovementRow = { id; createdAt; type: MovementType; itemId; sku; itemName; unit; qtyDelta; unitCost: number | null; refNo; counterparty; note; actor: Actor }`
  - `type MovementFilter = { itemId?: number; type?: MovementType; from?: string; to?: string; limit?: number }`
  - `listMovements(db, f?: MovementFilter): MovementRow[]` (newest first, default limit 500)
- Produces (`lib/dashboard.ts`):
  - `dashboardStats(db, now: string): { totalSkus: number; stockValue: number; lowStockCount: number; todayMovements: number }`
  - `type DayFlow = { day: string; label: string; inValue: number; outValue: number }`, `inOutLast7Days(db, now: string): DayFlow[]`
- Produces (`lib/reports.ts`):
  - `type ReportKey = 'stock-value' | 'fast-movers' | 'dead-stock' | 'low-stock'`, `REPORT_KEYS: ReportKey[]`, `isReportKey(s: unknown): s is ReportKey`
  - `type ReportTable = { key: ReportKey; title: string; description: string; headers: string[]; rows: CsvCell[][]; moneyColumns: number[] }`
  - `buildReport(db, key: ReportKey, now: string): ReportTable`

- [ ] **Step 1: Write failing tests**

`tests/catalog.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addNamed, addSupplier, createItem, deleteNamed, deleteSupplier, listNamed, listSuppliers, renameNamed, setReorderPoints, updateItem,
} from '@/lib/catalog';
import { makeDb } from './helpers';

describe('categories and units', () => {
  it('adds, renames, and blocks duplicates case-insensitively', () => {
    const { db } = makeDb();
    const id = addNamed(db, 'categories', '  Electrical  ');
    expect(listNamed(db, 'categories').find((c) => c.id === id)?.name).toBe('Electrical');
    expect(() => addNamed(db, 'categories', 'electrical')).toThrow('Category "electrical" already exists.');
    expect(() => addNamed(db, 'units', ' ')).toThrow('Unit name is required.');
    renameNamed(db, 'categories', id, 'Electricals');
    expect(() => renameNamed(db, 'categories', id, 'tools')).toThrow(/already exists/);
  });
  it('refuses to delete a category that items use', () => {
    const { db, cat } = makeDb();
    expect(() => deleteNamed(db, 'categories', cat)).toThrow('Can\'t delete "Tools" — 2 item(s) use it.');
    const id = addNamed(db, 'categories', 'Empty');
    deleteNamed(db, 'categories', id);
    expect(listNamed(db, 'categories').map((c) => c.name)).toEqual(['Paint', 'Tools']);
  });
});

describe('suppliers', () => {
  it('adds, lists and deletes', () => {
    const { db } = makeDb();
    const id = addSupplier(db, 'Metro Electrical', '02 8123 4567');
    expect(listSuppliers(db).map((s) => s.name)).toEqual(['Acme Supply', 'Metro Electrical']);
    deleteSupplier(db, id);
    expect(listSuppliers(db)).toHaveLength(1);
  });
});

describe('items', () => {
  it('creates with an upper-cased SKU and rejects duplicates', () => {
    const { db, cat, unit } = makeDb();
    const id = createItem(db, { sku: ' el-100 ', name: 'Wire', categoryId: cat, unitId: unit, reorderPoint: 5, active: true });
    expect(db.prepare('SELECT sku, qty, avg_cost, reorder_point FROM items WHERE id = ?').get(id)).toEqual({ sku: 'EL-100', qty: 0, avg_cost: 0, reorder_point: 5 });
    expect(() => createItem(db, { sku: 't-001', name: 'Dup', categoryId: cat, unitId: unit, reorderPoint: 0, active: true })).toThrow(
      'SKU T-001 is already used by Hammer.',
    );
  });
  it('validates SKU, name, category, unit and reorder point', () => {
    const { db, cat, unit } = makeDb();
    const ok = { sku: 'X-1', name: 'X', categoryId: cat, unitId: unit, reorderPoint: 0, active: true };
    expect(() => createItem(db, { ...ok, sku: 'bad sku' })).toThrow(/SKU must be/);
    expect(() => createItem(db, { ...ok, name: '' })).toThrow(/Item name is required/);
    expect(() => createItem(db, { ...ok, categoryId: 999 })).toThrow(/Pick a category/);
    expect(() => createItem(db, { ...ok, unitId: 999 })).toThrow(/Pick a unit/);
    expect(() => createItem(db, { ...ok, reorderPoint: -1 })).toThrow(/Reorder point/);
  });
  it('updates details but never qty or cost', () => {
    const { db, item, cat2, unit } = makeDb();
    updateItem(db, item, { sku: 'T-001', name: 'Claw Hammer', categoryId: cat2, unitId: unit, reorderPoint: 3, active: false });
    expect(db.prepare('SELECT name, category_id, active, qty FROM items WHERE id = ?').get(item)).toEqual({ name: 'Claw Hammer', category_id: cat2, active: 0, qty: 0 });
    expect(() => updateItem(db, 999, { sku: 'Z', name: 'Z', categoryId: cat2, unitId: unit, reorderPoint: 0, active: true })).toThrow(/Item not found/);
  });
  it('bulk-sets reorder points atomically', () => {
    const { db, item, item2 } = makeDb();
    expect(setReorderPoints(db, [{ itemId: item, reorderPoint: 10 }, { itemId: item2, reorderPoint: 2.5 }])).toBe(2);
    expect(() => setReorderPoints(db, [{ itemId: item, reorderPoint: 1 }, { itemId: item2, reorderPoint: -1 }])).toThrow(/T-002/);
    expect(db.prepare('SELECT reorder_point AS rp FROM items WHERE id = ?').get(item)).toEqual({ rp: 10 });
  });
});
```

`tests/queries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { dashboardStats, inOutLast7Days } from '@/lib/dashboard';
import { postReceipt, postRelease } from '@/lib/inventory';
import { getItem, listItems, listMovements } from '@/lib/queries';
import { makeDb } from './helpers';

describe('listItems', () => {
  it('searches SKU and name, treating % and _ literally', () => {
    const f = makeDb();
    f.db.prepare("UPDATE items SET name = '100% Latex' WHERE id = ?").run(f.paint);
    expect(listItems(f.db, { q: 'ham' }).map((i) => i.sku)).toEqual(['T-001']);
    expect(listItems(f.db, { q: 'p-0' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { q: '%' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { q: '_' })).toEqual([]);
  });
  it('filters by category and status; low = active and qty <= reorder point', () => {
    const f = makeDb();
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 10, unitCost: 1 }, { itemId: f.item2, qty: 3, unitCost: 1 }] }, 'admin');
    f.db.prepare('UPDATE items SET reorder_point = 5').run();
    f.db.prepare('UPDATE items SET active = 0 WHERE id = ?').run(f.paint);
    expect(listItems(f.db, { status: 'low' }).map((i) => i.sku)).toEqual(['T-002']);
    expect(listItems(f.db, { status: 'inactive' }).map((i) => i.sku)).toEqual(['P-001']);
    expect(listItems(f.db, { categoryId: f.cat2 }).map((i) => i.sku)).toEqual(['P-001']);
    expect(getItem(f.db, f.item2)).toMatchObject({ sku: 'T-002', category: 'Tools', unit: 'pc', qty: 3, low: true, active: true });
    expect(getItem(f.db, 999)).toBeNull();
  });
});

describe('listMovements', () => {
  it('filters by Manila day, including the whole "to" day', () => {
    const f = makeDb();
    const rcv = (refNo: string, at: string) =>
      postReceipt(f.db, { supplierId: f.supplier, refNo, lines: [{ itemId: f.item, qty: 1, unitCost: 1 }] }, 'admin', at);
    rcv('LATE-OCT1', '2026-10-01T15:30:00.000Z'); // 23:30 Oct 1 Manila
    rcv('EARLY-OCT2', '2026-10-01T16:00:00.000Z'); // 00:00 Oct 2 Manila
    rcv('NOON-OCT2', '2026-10-02T04:00:00.000Z');
    const refs = (from?: string, to?: string) => listMovements(f.db, { from, to }).map((m) => m.refNo);
    expect(refs('2026-10-01', '2026-10-01')).toEqual(['LATE-OCT1']);
    expect(refs('2026-10-02', '2026-10-02')).toEqual(['NOON-OCT2', 'EARLY-OCT2']);
    expect(refs(undefined, '2026-10-01')).toEqual(['LATE-OCT1']);
    expect(refs('not-a-day', undefined)).toHaveLength(3);
  });
  it('filters by item and type and returns the movement shape', () => {
    const f = makeDb();
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId: f.item, qty: 5, unitCost: 2 }, { itemId: f.item2, qty: 1, unitCost: 2 }] }, 'admin', '2026-10-02T00:00:00.000Z');
    postRelease(f.db, { counterparty: 'Walk-in', refNo: 'D', lines: [{ itemId: f.item, qty: 2 }] }, 'encoder', '2026-10-02T01:00:00.000Z');
    expect(listMovements(f.db, { itemId: f.item, type: 'release' })).toEqual([
      expect.objectContaining({ type: 'release', sku: 'T-001', itemName: 'Hammer', unit: 'pc', qtyDelta: -2, unitCost: 2, refNo: 'D', counterparty: 'Walk-in', actor: 'encoder' }),
    ]);
    expect(listMovements(f.db, { limit: 1 })).toHaveLength(1);
  });
});

describe('dashboard', () => {
  it('counts today in Manila time and builds 7 chart days', () => {
    const f = makeDb();
    const now = '2026-10-02T04:00:00.000Z'; // noon Oct 2 Manila
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'A', lines: [{ itemId: f.item, qty: 10, unitCost: 50 }] }, 'admin', '2026-10-01T15:30:00.000Z');
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'B', lines: [{ itemId: f.item, qty: 10, unitCost: 100 }] }, 'admin', '2026-10-01T16:30:00.000Z');
    postRelease(f.db, { counterparty: 'X', refNo: 'C', lines: [{ itemId: f.item, qty: 4 }] }, 'admin', '2026-10-02T02:00:00.000Z');
    f.db.prepare('UPDATE items SET reorder_point = 100 WHERE id = ?').run(f.item);
    // T-001 is 16 <= 100; T-002 and P-001 sit at 0 <= 0, which the spec also counts as low.
    expect(dashboardStats(f.db, now)).toEqual({ totalSkus: 3, stockValue: 1200, lowStockCount: 3, todayMovements: 2 });
    const days = inOutLast7Days(f.db, now);
    expect(days.map((d) => d.day)).toEqual(['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
    expect(days[5]).toMatchObject({ inValue: 500, outValue: 0, label: 'Oct 1' });
    expect(days[6]).toMatchObject({ inValue: 1000, outValue: 300 });
  });
});
```

`tests/reports.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { postReceipt, postRelease } from '@/lib/inventory';
import { buildReport, isReportKey, REPORT_KEYS } from '@/lib/reports';
import { makeDb } from './helpers';

const NOW = '2026-10-02T04:00:00.000Z';

function scenario() {
  const f = makeDb();
  const rcv = (itemId: number, qty: number, cost: number, at: string) =>
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: [{ itemId, qty, unitCost: cost }] }, 'admin', at);
  const rel = (itemId: number, qty: number, at: string) =>
    postRelease(f.db, { counterparty: 'X', refNo: 'D', lines: [{ itemId, qty }] }, 'admin', at);
  rcv(f.item, 50, 10, '2026-09-25T00:00:00.000Z');
  rcv(f.item2, 20, 5, '2026-09-25T00:00:00.000Z');
  rcv(f.paint, 4, 600, '2026-07-01T00:00:00.000Z'); // last movement 93 days ago → dead
  rel(f.item, 5, '2026-09-30T00:00:00.000Z');
  rel(f.item, 5, '2026-10-01T00:00:00.000Z');
  rel(f.item2, 12, '2026-10-01T00:00:00.000Z');
  rel(f.item2, 1, '2026-10-01T01:00:00.000Z');
  f.db.prepare('UPDATE items SET reorder_point = 10 WHERE id = ?').run(f.item2);
  return f;
}

describe('reports', () => {
  it('knows its keys', () => {
    expect(REPORT_KEYS).toEqual(['stock-value', 'fast-movers', 'dead-stock', 'low-stock']);
    expect(isReportKey('low-stock')).toBe(true);
    expect(isReportKey('../etc')).toBe(false);
  });
  it('stock value by category with a total row', () => {
    const t = buildReport(scenario().db, 'stock-value', NOW);
    expect(t.headers).toEqual(['Category', 'Active items', 'Stock value (PHP)']);
    expect(t.rows).toEqual([['Paint', 1, 2400], ['Tools', 2, 435], ['TOTAL', 3, 2835]]);
    expect(t.moneyColumns).toEqual([2]);
  });
  it('fast movers ranks by number of releases in 30 days, then qty', () => {
    const t = buildReport(scenario().db, 'fast-movers', NOW);
    expect(t.rows.map((r) => [r[0], r[4], r[5]])).toEqual([['T-002', 2, 13], ['T-001', 2, 10]]);
  });
  it('dead stock lists active items with stock and no movement in 60 days', () => {
    const t = buildReport(scenario().db, 'dead-stock', NOW);
    expect(t.rows).toEqual([['P-001', 'Latex White', 'Paint', 'pc', 4, 2400, '2026-07-01']]);
  });
  it('low stock lists shortfall', () => {
    const t = buildReport(scenario().db, 'low-stock', NOW);
    expect(t.rows).toEqual([['T-002', 'Saw', 'Tools', 'pc', 7, 10, 3]]);
  });
});
```

In `scenario()`, T-002 gets two releases totalling 13, which leaves 7 on hand against a reorder point of 10. T-001 is left with 40 @ ₱10 (₱400) and T-002 with 7 @ ₱5 (₱35), so Tools totals ₱435.

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: the three new files FAIL on unresolved modules.

- [ ] **Step 3: Implement `lib/catalog.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { InventoryError } from './inventory';
import { round } from './num';
import { tx } from './sqlite';

export type NamedTable = 'categories' | 'units';
export type Named = { id: number; name: string; inUse: number };
export type Supplier = { id: number; name: string; contact: string };
export type ItemInput = { sku: string; name: string; categoryId: number; unitId: number; reorderPoint: number; active: boolean };

const LABEL: Record<NamedTable, string> = { categories: 'Category', units: 'Unit' };
const ITEM_COL: Record<NamedTable, string> = { categories: 'category_id', units: 'unit_id' };

function cleanName(raw: string, what: string, max = 60): string {
  const s = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) throw new InventoryError(`${what} name is required.`);
  if (s.length > max) throw new InventoryError(`${what} name is too long (max ${max} characters).`);
  return s;
}

export function listNamed(db: DatabaseSync, table: NamedTable): Named[] {
  return db
    .prepare(`SELECT t.id, t.name, (SELECT COUNT(*) FROM items i WHERE i.${ITEM_COL[table]} = t.id) AS inUse FROM ${table} t ORDER BY t.name`)
    .all() as Named[];
}

function assertUniqueName(db: DatabaseSync, table: NamedTable, name: string, exceptId = 0) {
  if (db.prepare(`SELECT 1 FROM ${table} WHERE name = ? AND id <> ?`).get(name, exceptId)) {
    throw new InventoryError(`${LABEL[table]} "${name}" already exists.`);
  }
}

export function addNamed(db: DatabaseSync, table: NamedTable, rawName: string): number {
  const name = cleanName(rawName, LABEL[table]);
  assertUniqueName(db, table, name);
  return Number(db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name).lastInsertRowid);
}

export function renameNamed(db: DatabaseSync, table: NamedTable, id: number, rawName: string): void {
  const name = cleanName(rawName, LABEL[table]);
  if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id)) throw new InventoryError(`${LABEL[table]} not found.`);
  assertUniqueName(db, table, name, id);
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
}

export function deleteNamed(db: DatabaseSync, table: NamedTable, id: number): void {
  const row = listNamed(db, table).find((r) => r.id === id);
  if (!row) throw new InventoryError(`${LABEL[table]} not found.`);
  if (row.inUse > 0) throw new InventoryError(`Can't delete "${row.name}" — ${row.inUse} item(s) use it.`);
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

export function listSuppliers(db: DatabaseSync): Supplier[] {
  return db.prepare('SELECT id, name, contact FROM suppliers ORDER BY name').all() as Supplier[];
}

function cleanSupplier(db: DatabaseSync, rawName: string, rawContact: string, exceptId = 0) {
  const name = cleanName(rawName, 'Supplier', 120);
  const contact = (rawContact ?? '').trim().slice(0, 200);
  if (db.prepare('SELECT 1 FROM suppliers WHERE name = ? AND id <> ?').get(name, exceptId)) {
    throw new InventoryError(`Supplier "${name}" already exists.`);
  }
  return { name, contact };
}

export function addSupplier(db: DatabaseSync, rawName: string, rawContact: string): number {
  const { name, contact } = cleanSupplier(db, rawName, rawContact);
  return Number(db.prepare('INSERT INTO suppliers (name, contact) VALUES (?, ?)').run(name, contact).lastInsertRowid);
}

export function updateSupplier(db: DatabaseSync, id: number, rawName: string, rawContact: string): void {
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id = ?').get(id)) throw new InventoryError('Supplier not found.');
  const { name, contact } = cleanSupplier(db, rawName, rawContact, id);
  db.prepare('UPDATE suppliers SET name = ?, contact = ? WHERE id = ?').run(name, contact, id);
}

// Movements keep the supplier name as text, so deleting a supplier never breaks history.
export function deleteSupplier(db: DatabaseSync, id: number): void {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id);
}

function checkReorderPoint(n: number, label: string): number {
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new InventoryError(`${label}: reorder point must be 0 or more.`);
  return round(n, 3);
}

function cleanItem(db: DatabaseSync, input: ItemInput, exceptId = 0): ItemInput {
  const sku = (input.sku ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(sku)) throw new InventoryError('SKU must be 1–32 letters, numbers, dots, dashes or underscores.');
  const name = cleanName(input.name, 'Item', 120);
  if (!db.prepare('SELECT 1 FROM categories WHERE id = ?').get(input.categoryId)) throw new InventoryError('Pick a category.');
  if (!db.prepare('SELECT 1 FROM units WHERE id = ?').get(input.unitId)) throw new InventoryError('Pick a unit.');
  const dup = db.prepare('SELECT name FROM items WHERE sku = ? AND id <> ?').get(sku, exceptId) as { name: string } | undefined;
  if (dup) throw new InventoryError(`SKU ${sku} is already used by ${dup.name}.`);
  return { sku, name, categoryId: input.categoryId, unitId: input.unitId, reorderPoint: checkReorderPoint(input.reorderPoint, 'Reorder point'), active: !!input.active };
}

export function createItem(db: DatabaseSync, input: ItemInput): number {
  const i = cleanItem(db, input);
  return Number(
    db.prepare('INSERT INTO items (sku, name, category_id, unit_id, reorder_point, active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.sku, i.name, i.categoryId, i.unitId, i.reorderPoint, i.active ? 1 : 0).lastInsertRowid,
  );
}

export function updateItem(db: DatabaseSync, id: number, input: ItemInput): void {
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id)) throw new InventoryError('Item not found.');
  const i = cleanItem(db, input, id);
  db.prepare('UPDATE items SET sku = ?, name = ?, category_id = ?, unit_id = ?, reorder_point = ?, active = ? WHERE id = ?')
    .run(i.sku, i.name, i.categoryId, i.unitId, i.reorderPoint, i.active ? 1 : 0, id);
}

export function setReorderPoints(db: DatabaseSync, updates: { itemId: number; reorderPoint: number }[]): number {
  return tx(db, () => {
    for (const u of updates) {
      const item = db.prepare('SELECT sku FROM items WHERE id = ?').get(u.itemId) as { sku: string } | undefined;
      if (!item) throw new InventoryError('Item not found.');
      const rp = checkReorderPoint(u.reorderPoint, item.sku);
      db.prepare('UPDATE items SET reorder_point = ? WHERE id = ?').run(rp, u.itemId);
    }
    return updates.length;
  });
}
```

- [ ] **Step 4: Implement `lib/queries.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { Actor, MovementType } from './inventory';
import { addDays, isDay, manilaDayStartUtc } from './time';

export type ItemListRow = {
  id: number; sku: string; name: string; categoryId: number; category: string; unitId: number; unit: string;
  qty: number; avgCost: number; reorderPoint: number; active: boolean; low: boolean;
};
export type ItemStatus = 'all' | 'low' | 'active' | 'inactive';
export type ItemFilter = { q?: string; categoryId?: number; status?: ItemStatus };

export function isItemStatus(s: unknown): s is ItemStatus {
  return s === 'all' || s === 'low' || s === 'active' || s === 'inactive';
}

const ITEM_SELECT = `SELECT i.id, i.sku, i.name, i.category_id AS categoryId, c.name AS category, i.unit_id AS unitId, u.name AS unit,
  i.qty, i.avg_cost AS avgCost, i.reorder_point AS reorderPoint, i.active, (i.active = 1 AND i.qty <= i.reorder_point) AS low
  FROM items i JOIN categories c ON c.id = i.category_id JOIN units u ON u.id = i.unit_id`;

type RawItem = Omit<ItemListRow, 'active' | 'low'> & { active: number; low: number };
const toItem = (r: RawItem): ItemListRow => ({ ...r, active: r.active === 1, low: r.low === 1 });

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => '\\' + m);
}

export function listItems(db: DatabaseSync, f: ItemFilter = {}): ItemListRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    where.push(`(i.sku LIKE ? ESCAPE '\\' OR i.name LIKE ? ESCAPE '\\')`);
    params.push(like, like);
  }
  if (f.categoryId) {
    where.push('i.category_id = ?');
    params.push(f.categoryId);
  }
  if (f.status === 'low') where.push('i.active = 1 AND i.qty <= i.reorder_point');
  if (f.status === 'active') where.push('i.active = 1');
  if (f.status === 'inactive') where.push('i.active = 0');
  const sql = `${ITEM_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY i.sku`;
  return (db.prepare(sql).all(...params) as RawItem[]).map(toItem);
}

export function getItem(db: DatabaseSync, id: number): ItemListRow | null {
  const r = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as RawItem | undefined;
  return r ? toItem(r) : null;
}

export type MovementRow = {
  id: number; createdAt: string; type: MovementType; itemId: number; sku: string; itemName: string; unit: string;
  qtyDelta: number; unitCost: number | null; refNo: string; counterparty: string; note: string; actor: Actor;
};
export type MovementFilter = { itemId?: number; type?: MovementType; from?: string; to?: string; limit?: number };

export function listMovements(db: DatabaseSync, f: MovementFilter = {}): MovementRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.itemId) { where.push('m.item_id = ?'); params.push(f.itemId); }
  if (f.type) { where.push('m.type = ?'); params.push(f.type); }
  if (isDay(f.from)) { where.push('m.created_at >= ?'); params.push(manilaDayStartUtc(f.from)); }
  if (isDay(f.to)) { where.push('m.created_at < ?'); params.push(manilaDayStartUtc(addDays(f.to, 1))); }
  params.push(Math.min(Math.max(f.limit ?? 500, 1), 5000));
  const sql = `SELECT m.id, m.created_at AS createdAt, m.type, m.item_id AS itemId, i.sku, i.name AS itemName, u.name AS unit,
      m.qty_delta AS qtyDelta, m.unit_cost AS unitCost, m.ref_no AS refNo, m.counterparty, m.note, m.actor
    FROM movements m JOIN items i ON i.id = m.item_id JOIN units u ON u.id = i.unit_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY m.created_at DESC, m.id DESC LIMIT ?`;
  return (db.prepare(sql).all(...params) as MovementRow[]).map((r) => ({ ...r }));
}
```

- [ ] **Step 5: Implement `lib/dashboard.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { round } from './num';
import { addDays, formatDayLabel, manilaDay, manilaDayStartUtc } from './time';

export type DayFlow = { day: string; label: string; inValue: number; outValue: number };

export function dashboardStats(db: DatabaseSync, now: string) {
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
```

- [ ] **Step 6: Implement `lib/reports.ts`**

```ts
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
```

- [ ] **Step 7: Run to verify pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```powershell
git add lib tests
git commit -m "feat: catalog CRUD, item and movement queries, dashboard stats, reports"
git push
```

---

### Task 7: Deterministic seed and the `getDb` singleton

**Files:**
- Create: `lib/seed.ts`, `lib/db.ts`
- Test: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `openDb`, `tx`, `postReceipt`, `postRelease`, `startCountSession`, `getCountSession`, `saveCountActuals`, `postCountSession`, `ledgerCheck`, the time helpers
- Produces:
  - `seed(db, now?: string): void`, `seedIfEmpty(db, now?: string): boolean`
  - `LOW_STOCK_SKUS: string[]` (6), `DEAD_STOCK_SKUS: string[]` (3)
  - `getDb(): DatabaseSync`, a process-wide singleton on `globalThis.__inventoryDb`. The path comes from `DB_PATH`, default `<cwd>/data/inventory.db`. It creates the folder and seeds when the DB is empty.

- [ ] **Step 1: Write failing tests**

`tests/seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ledgerCheck } from '@/lib/inventory';
import { buildReport } from '@/lib/reports';
import { DEAD_STOCK_SKUS, LOW_STOCK_SKUS, seed, seedIfEmpty } from '@/lib/seed';
import { openDb } from '@/lib/sqlite';

const NOW = '2026-10-03T04:00:00.000Z';

function seeded() {
  const db = openDb(':memory:');
  seed(db, NOW);
  return db;
}

const count = (db: ReturnType<typeof seeded>, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe('seed', () => {
  it('creates 40 items in 5 categories and 3 suppliers', () => {
    const db = seeded();
    expect(count(db, 'SELECT COUNT(*) AS n FROM items')).toBe(40);
    expect((db.prepare('SELECT name FROM categories ORDER BY name').all() as { name: string }[]).map((c) => c.name)).toEqual([
      'Electrical', 'Fasteners', 'Paint', 'Plumbing', 'Tools',
    ]);
    expect(count(db, 'SELECT COUNT(*) AS n FROM categories c WHERE (SELECT COUNT(*) FROM items i WHERE i.category_id = c.id) = 8')).toBe(5);
    expect(count(db, 'SELECT COUNT(*) AS n FROM suppliers')).toBe(3);
  });
  it('spans about 60 days with receives, releases and one posted count with variances', () => {
    const db = seeded();
    const span = db.prepare('SELECT MIN(created_at) AS first, MAX(created_at) AS last FROM movements').get() as { first: string; last: string };
    expect((Date.parse(NOW) - Date.parse(span.first)) / 86_400_000).toBeGreaterThanOrEqual(60);
    expect(Date.parse(span.last)).toBeLessThan(Date.parse(NOW));
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'receive'")).toBeGreaterThan(40);
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'release'")).toBeGreaterThan(100);
    expect(count(db, 'SELECT COUNT(*) AS n FROM count_sessions WHERE posted_at IS NOT NULL')).toBe(1);
    expect(count(db, "SELECT COUNT(*) AS n FROM movements WHERE type = 'adjust' AND note = 'count variance'")).toBe(3);
  });
  it('leaves exactly the 6 intended items low on stock', () => {
    const db = seeded();
    expect(buildReport(db, 'low-stock', NOW).rows.map((r) => r[0]).sort()).toEqual([...LOW_STOCK_SKUS].sort());
  });
  it('produces dead stock and fast movers', () => {
    const db = seeded();
    expect(buildReport(db, 'dead-stock', NOW).rows.map((r) => r[0]).sort()).toEqual([...DEAD_STOCK_SKUS].sort());
    expect(buildReport(db, 'fast-movers', NOW).rows.length).toBeGreaterThan(5);
  });
  it('keeps the cache equal to the ledger', () => {
    expect(ledgerCheck(seeded()).every((r) => r.match)).toBe(true);
  });
  it('is deterministic and seeds only an empty DB', () => {
    const a = seeded();
    const b = seeded();
    const snap = (db: typeof a) => db.prepare('SELECT sku, qty, avg_cost, reorder_point FROM items ORDER BY sku').all();
    expect(snap(a)).toEqual(snap(b));
    expect(seedIfEmpty(a, NOW)).toBe(false);
    expect(seedIfEmpty(openDb(':memory:'), NOW)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/seed.test.ts`
Expected: FAIL — cannot resolve `@/lib/seed`.

- [ ] **Step 3: Implement `lib/seed.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { getCountSession, postCountSession, saveCountActuals, startCountSession } from './count';
import { postReceipt, postRelease } from './inventory';
import { round } from './num';
import { tx } from './sqlite';
import { addDays, manilaAt, manilaDay, nowIso } from './time';

type SeedItem = { sku: string; name: string; unit: string; cost: number };

const CATALOG: Record<string, { supplier: number; items: SeedItem[] }> = {
  Electrical: { supplier: 0, items: [
    { sku: 'EL-001', name: 'THHN Wire 2.0mm² (150m)', unit: 'roll', cost: 2450 },
    { sku: 'EL-002', name: 'THHN Wire 3.5mm² (150m)', unit: 'roll', cost: 3980 },
    { sku: 'EL-003', name: 'Convenience Outlet, Duplex', unit: 'pc', cost: 85 },
    { sku: 'EL-004', name: 'Wall Switch, 1-Gang', unit: 'pc', cost: 65 },
    { sku: 'EL-005', name: 'LED Bulb 9W Daylight', unit: 'pc', cost: 95 },
    { sku: 'EL-006', name: 'Circuit Breaker 20A Plug-in', unit: 'pc', cost: 320 },
    { sku: 'EL-007', name: 'PVC Electrical Tape 19mm', unit: 'roll', cost: 28 },
    { sku: 'EL-008', name: 'Utility Box 2x4', unit: 'pc', cost: 22 },
  ] },
  Plumbing: { supplier: 1, items: [
    { sku: 'PL-001', name: 'PPR Pipe 20mm x 4m', unit: 'pc', cost: 210 },
    { sku: 'PL-002', name: 'PVC Pipe 2in x 3m (Orange)', unit: 'pc', cost: 245 },
    { sku: 'PL-003', name: 'PVC Elbow 1/2in', unit: 'pc', cost: 12 },
    { sku: 'PL-004', name: 'Gate Valve 1/2in Brass', unit: 'pc', cost: 285 },
    { sku: 'PL-005', name: 'Teflon Tape 1/2in', unit: 'roll', cost: 15 },
    { sku: 'PL-006', name: 'Lavatory Faucet, Stainless', unit: 'pc', cost: 450 },
    { sku: 'PL-007', name: 'Flexible Hose 1/2 x 1/2 x 16in', unit: 'pc', cost: 120 },
    { sku: 'PL-008', name: 'PVC Solvent Cement 100cc', unit: 'pc', cost: 75 },
  ] },
  Tools: { supplier: 0, items: [
    { sku: 'TL-001', name: 'Claw Hammer 16oz', unit: 'pc', cost: 260 },
    { sku: 'TL-002', name: 'Screwdriver Set, 6pc', unit: 'set', cost: 340 },
    { sku: 'TL-003', name: 'Measuring Tape 5m', unit: 'pc', cost: 150 },
    { sku: 'TL-004', name: 'Hacksaw Frame 12in', unit: 'pc', cost: 210 },
    { sku: 'TL-005', name: 'Combination Pliers 8in', unit: 'pc', cost: 185 },
    { sku: 'TL-006', name: 'Cutting Disc 4in (box of 25)', unit: 'box', cost: 380 },
    { sku: 'TL-007', name: 'Paint Brush 2in', unit: 'pc', cost: 45 },
    { sku: 'TL-008', name: 'Masonry Trowel 7in', unit: 'pc', cost: 130 },
  ] },
  Paint: { supplier: 2, items: [
    { sku: 'PT-001', name: 'Latex Paint, White', unit: 'gal', cost: 620 },
    { sku: 'PT-002', name: 'Enamel Paint, Black', unit: 'gal', cost: 720 },
    { sku: 'PT-003', name: 'Red Oxide Primer', unit: 'gal', cost: 540 },
    { sku: 'PT-004', name: 'Paint Thinner', unit: 'L', cost: 110 },
    { sku: 'PT-005', name: 'Wood Varnish, Clear', unit: 'L', cost: 260 },
    { sku: 'PT-006', name: 'Masonry Putty', unit: 'kg', cost: 95 },
    { sku: 'PT-007', name: 'Acrylic Emulsion, Blue', unit: 'gal', cost: 650 },
    { sku: 'PT-008', name: 'Paint Roller Set 7in', unit: 'set', cost: 155 },
  ] },
  Fasteners: { supplier: 1, items: [
    { sku: 'FS-001', name: 'Common Nail 2in', unit: 'kg', cost: 85 },
    { sku: 'FS-002', name: 'Common Nail 4in', unit: 'kg', cost: 82 },
    { sku: 'FS-003', name: 'Concrete Nail 2in', unit: 'kg', cost: 120 },
    { sku: 'FS-004', name: 'Wood Screw #8 x 1in (box)', unit: 'box', cost: 140 },
    { sku: 'FS-005', name: 'Tek Screw 1in (box)', unit: 'box', cost: 260 },
    { sku: 'FS-006', name: 'Hex Bolt with Nut 1/2 x 3in', unit: 'pc', cost: 18 },
    { sku: 'FS-007', name: 'Plastic Wall Plug 1/4in (box)', unit: 'box', cost: 65 },
    { sku: 'FS-008', name: 'Blind Rivet 1/8in (box)', unit: 'box', cost: 95 },
  ] },
};

const SUPPLIERS = [
  { name: 'Metro Electrical & Tools Supply', contact: '(02) 8123 4567' },
  { name: 'Luzon Pipe & Fasteners Co.', contact: '0917 555 0142' },
  { name: 'Bulacan Paint Distributors', contact: '0918 555 0199' },
];
const CUSTOMERS = ['Walk-in', 'JDC Construction', 'Santos Residence Project', 'Reyes Builders', 'Dela Cruz Electrical Services', 'Brgy. San Isidro Hall'];

export const LOW_STOCK_SKUS = ['EL-005', 'PL-003', 'TL-006', 'PT-001', 'FS-001', 'FS-004'];
export const DEAD_STOCK_SKUS = ['EL-008', 'TL-008', 'PT-005'];
const COUNT_VARIANCES: Record<string, number> = { 'FS-002': -3, 'FS-006': -1, 'FS-007': 2 };

function mulberry32(seedValue: number) {
  let a = seedValue;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seed(db: DatabaseSync, now = nowIso()): void {
  const rand = mulberry32(20261002);
  const rint = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const today = manilaDay(now);
  const at = (daysAgo: number, hour: number, minute = 0) => manilaAt(addDays(today, -daysAgo), hour, minute);

  tx(db, () => {
    const id = (sql: string, ...p: (string | number)[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
    const supplierIds = SUPPLIERS.map((s) => id('INSERT INTO suppliers (name, contact) VALUES (?, ?)', s.name, s.contact));
    const unitIds = new Map<string, number>();
    const items: { id: number; sku: string; cost: number; supplier: number; categoryId: number }[] = [];
    for (const [category, group] of Object.entries(CATALOG)) {
      const categoryId = id('INSERT INTO categories (name) VALUES (?)', category);
      for (const it of group.items) {
        if (!unitIds.has(it.unit)) unitIds.set(it.unit, id('INSERT INTO units (name) VALUES (?)', it.unit));
        const itemId = id('INSERT INTO items (sku, name, category_id, unit_id) VALUES (?, ?, ?, ?)', it.sku, it.name, categoryId, unitIds.get(it.unit)!);
        items.push({ id: itemId, sku: it.sku, cost: it.cost, supplier: group.supplier, categoryId });
      }
    }
    const qty = (itemId: number) => (db.prepare('SELECT qty FROM items WHERE id = ?').get(itemId) as { qty: number }).qty;
    const isLow = (sku: string) => LOW_STOCK_SKUS.includes(sku);
    const isDead = (sku: string) => DEAD_STOCK_SKUS.includes(sku);
    let seq = 1000;

    // Opening stock, 62 days ago.
    supplierIds.forEach((supplierId, s) => {
      const lines = items.filter((i) => i.supplier === s).map((i) => ({ itemId: i.id, qty: rint(40, 150), unitCost: i.cost }));
      postReceipt(db, { supplierId, refNo: `OB-${s + 1}`, note: 'Opening balance', lines }, 'admin', at(62, 8));
    });

    const movers = items.filter((i) => !isDead(i.sku));
    const fasteners = items.find((i) => i.sku === 'FS-001')!.categoryId;
    for (let d = 58; d >= 1; d--) {
      const releases = rint(2, 5);
      for (let k = 0; k < releases; k++) {
        const lines: { itemId: number; qty: number }[] = [];
        for (let n = rint(1, 3); n > 0; n--) {
          const it = movers[rint(0, movers.length - 1)];
          if (lines.some((l) => l.itemId === it.id)) continue;
          const room = Math.floor(qty(it.id) - (isLow(it.sku) ? 2 : 12));
          if (room < 1) continue;
          lines.push({ itemId: it.id, qty: rint(1, Math.min(room, 15)) });
        }
        if (lines.length) {
          postRelease(db, { counterparty: CUSTOMERS[rint(0, CUSTOMERS.length - 1)], refNo: `DR-${++seq}`, lines }, 'encoder', at(d, 9 + k, rint(0, 59)));
        }
      }
      if (d % 7 === 0) {
        supplierIds.forEach((supplierId, s) => {
          const lines = items
            .filter((i) => i.supplier === s && !isDead(i.sku) && !isLow(i.sku) && qty(i.id) < 40)
            .map((i) => ({ itemId: i.id, qty: rint(30, 80), unitCost: round(i.cost * (0.95 + rand() * 0.15), 2) }));
          if (lines.length) postReceipt(db, { supplierId, refNo: `RR-${++seq}`, lines }, 'admin', at(d, 15));
        });
      }
      if (d === 10) {
        const sid = startCountSession(db, { categoryId: fasteners }, at(d, 16));
        const session = getCountSession(db, sid)!;
        saveCountActuals(db, sid, session.lines.map((l) => ({ lineId: l.lineId, actual: Math.max(0, l.expected + (COUNT_VARIANCES[l.sku] ?? 0)) })));
        postCountSession(db, sid, 'admin', at(d, 17));
      }
    }

    // Reorder points: the 6 low items sit at or below theirs; everything else sits comfortably above.
    for (const it of items) {
      const q = qty(it.id);
      const rp = isLow(it.sku) ? Math.ceil(q) + 5 : Math.max(1, Math.floor(q / 4));
      db.prepare('UPDATE items SET reorder_point = ? WHERE id = ?').run(rp, it.id);
    }
  });
}

export function seedIfEmpty(db: DatabaseSync, now = nowIso()): boolean {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM items').get() as { n: number };
  if (n > 0) return false;
  seed(db, now);
  return true;
}
```

- [ ] **Step 4: Implement `lib/db.ts`**

```ts
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
```

- [ ] **Step 5: Run to verify pass**

Run: `npm test`
Expected: all pass. If `exactly 6 low` fails, a non-low item ended with `qty < 4`. Check the release floor (`12`): it guarantees `qty ≥ 12`, so `floor(qty/4) ≥ 3 < qty`. Fix the cause in the seed rather than loosening the test.

- [ ] **Step 6: Commit**

```powershell
git add lib tests
git commit -m "feat(seed): deterministic 60-day seed and getDb singleton"
git push
```

---

### Task 8: Auth — signed role cookie, login, middleware, app shell

**Files:**
- Create: `lib/session.ts`, `lib/passwords.ts`, `lib/auth.ts`, `lib/action-result.ts`, `middleware.ts`
- Create: `app/login/page.tsx`, `app/login/login-form.tsx`, `app/login/actions.ts`, `app/page.tsx` (replace scaffold), `app/(app)/layout.tsx`
- Create: `components/nav.tsx`, `components/page-header.tsx`, `components/form-message.tsx`, `components/native-select.tsx`, `components/stock-badge.tsx`
- Modify: `app/layout.tsx` (title and lang)
- Test: `tests/session.test.ts`, `tests/passwords.test.ts`

**Interfaces:**
- Produces:
  - `type Role = 'admin' | 'encoder'`, `SESSION_COOKIE = 'inv_session'`, `SESSION_TTL_MS`
  - `signSession(role, secret, nowMs): Promise<string>`, `verifySession(token, secret, nowMs): Promise<Role | null>`
  - `canAccess(role, pathname): boolean`, `homeFor(role): string`
  - `roleForPassword(input: string, cfg: { admin?: string; encoder?: string }): Role | null`
  - `currentRole(): Promise<Role | null>`, `requireRole(...allowed: Role[]): Promise<Role>` (redirects to `/login` when signed out, throws `Error('Not allowed')` on the wrong role), `sessionSecret(): string`
  - `type ActionResult = { ok: true; message: string } | { ok: false; error: string } | null`, `toActionError(e: unknown): ActionResult`
  - UI: `<PageHeader title description? actions?>`, `<FormMessage state>` (renders `data-testid="form-message"`, `role="status"` on success and `role="alert"` on error), `<NativeSelect>`, `<StockBadge active low>`

- [ ] **Step 1: Write failing tests**

`tests/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canAccess, homeFor, SESSION_TTL_MS, signSession, verifySession } from '@/lib/session';

const SECRET = 'test-secret-0123456789abcdef0123456789';
const NOW = 1_800_000_000_000;

describe('session tokens', () => {
  it('round-trips a role', async () => {
    const t = await signSession('encoder', SECRET, NOW);
    expect(await verifySession(t, SECRET, NOW + 1000)).toBe('encoder');
  });
  it('rejects expiry, a wrong secret, tampering and junk', async () => {
    const t = await signSession('encoder', SECRET, NOW);
    expect(await verifySession(t, SECRET, NOW + SESSION_TTL_MS + 1)).toBeNull();
    expect(await verifySession(t, SECRET + 'x', NOW)).toBeNull();
    expect(await verifySession(t.replace('encoder', 'admin'), SECRET, NOW)).toBeNull();
    const [, exp, sig] = t.split('.');
    expect(await verifySession(`encoder.${Number(exp) + 999999}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifySession('garbage', SECRET, NOW)).toBeNull();
    expect(await verifySession('', SECRET, NOW)).toBeNull();
  });
});

describe('canAccess', () => {
  it('lets admin go anywhere', () => {
    for (const p of ['/dashboard', '/reports', '/reports/csv/low-stock', '/settings', '/debug', '/items/new', '/items/3/edit']) {
      expect(canAccess('admin', p)).toBe(true);
    }
  });
  it('limits encoder to receive/release/count/items/movements, read-only items', () => {
    for (const p of ['/receive', '/release', '/count', '/count/4', '/items', '/items/12', '/movements']) expect(canAccess('encoder', p)).toBe(true);
    for (const p of ['/dashboard', '/reports', '/reports/csv/low-stock', '/settings', '/debug', '/items/new', '/items/12/edit', '/receivex']) {
      expect(canAccess('encoder', p)).toBe(false);
    }
  });
  it('sends each role home', () => {
    expect(homeFor('admin')).toBe('/dashboard');
    expect(homeFor('encoder')).toBe('/receive');
  });
});
```

`tests/passwords.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { roleForPassword } from '@/lib/passwords';

const cfg = { admin: 'owner-pass', encoder: 'staff-pass' };

describe('roleForPassword', () => {
  it('maps each password to its role', () => {
    expect(roleForPassword('owner-pass', cfg)).toBe('admin');
    expect(roleForPassword('staff-pass', cfg)).toBe('encoder');
  });
  it('rejects wrong and empty input', () => {
    expect(roleForPassword('nope', cfg)).toBeNull();
    expect(roleForPassword('', cfg)).toBeNull();
    expect(roleForPassword('Owner-pass', cfg)).toBeNull();
  });
  it('refuses a broken config', () => {
    expect(() => roleForPassword('x', { admin: 'same', encoder: 'same' })).toThrow(/must be different/);
    expect(() => roleForPassword('x', { admin: 'a' })).toThrow(/must both be set/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test`
Expected: FAIL — cannot resolve `@/lib/session`, `@/lib/passwords`.

- [ ] **Step 3: Implement `lib/session.ts` (Web Crypto only, so it runs in edge middleware)**

```ts
export type Role = 'admin' | 'encoder';
export const SESSION_COOKIE = 'inv_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(role: Role, secret: string, nowMs: number): Promise<string> {
  const payload = `${role}.${nowMs + SESSION_TTL_MS}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(token: string, secret: string, nowMs: number): Promise<Role | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (role !== 'admin' && role !== 'encoder') return null;
  const expMs = Number(exp);
  if (!Number.isSafeInteger(expMs) || expMs <= nowMs) return null;
  if (!safeEqual(sig, await hmac(`${role}.${exp}`, secret))) return null;
  return role;
}

const ENCODER_PREFIXES = ['/receive', '/release', '/count', '/items', '/movements'];

export function canAccess(role: Role, pathname: string): boolean {
  if (role === 'admin') return true;
  if (pathname === '/items/new' || /^\/items\/[^/]+\/edit\/?$/.test(pathname)) return false;
  return ENCODER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function homeFor(role: Role): string {
  return role === 'admin' ? '/dashboard' : '/receive';
}
```

- [ ] **Step 4: Implement `lib/passwords.ts`, `lib/auth.ts`, `lib/action-result.ts`**

`lib/passwords.ts`:

```ts
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Role } from './session';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function roleForPassword(input: string, cfg: { admin?: string; encoder?: string }): Role | null {
  if (!cfg.admin || !cfg.encoder) throw new Error('ADMIN_PASSWORD and ENCODER_PASSWORD must both be set.');
  if (cfg.admin === cfg.encoder) throw new Error('ADMIN_PASSWORD and ENCODER_PASSWORD must be different.');
  if (!input) return null;
  const d = digest(input);
  const isAdmin = timingSafeEqual(d, digest(cfg.admin));
  const isEncoder = timingSafeEqual(d, digest(cfg.encoder));
  return isAdmin ? 'admin' : isEncoder ? 'encoder' : null;
}
```

`lib/auth.ts` (install the marker package first: `npm install server-only`):

```ts
import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type Role, SESSION_COOKIE, verifySession } from './session';

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  return s;
}

export async function currentRole(): Promise<Role | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token, sessionSecret(), Date.now()) : null;
}

// Call at the top of every server action, page and route handler that needs a role.
export async function requireRole(...allowed: Role[]): Promise<Role> {
  const role = await currentRole();
  if (!role) redirect('/login');
  if (!allowed.includes(role)) throw new Error('Not allowed');
  return role;
}
```

`lib/action-result.ts`:

```ts
import { InventoryError } from './inventory';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string } | null;

export function toActionError(e: unknown): ActionResult {
  if (e instanceof InventoryError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: 'Something went wrong. Nothing was saved.' };
}
```

- [ ] **Step 5: Run unit tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 6: Middleware**

`middleware.ts`:

```ts
import { NextResponse, type NextRequest } from 'next/server';
import { canAccess, homeFor, SESSION_COOKIE, verifySession } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login') return NextResponse.next();
  const secret = process.env.SESSION_SECRET ?? '';
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const role = token && secret.length >= 32 ? await verifySession(token, secret, Date.now()) : null;
  if (!role) return NextResponse.redirect(new URL('/login', req.url));
  if (pathname === '/') return NextResponse.redirect(new URL(homeFor(role), req.url));
  if (!canAccess(role, pathname)) return NextResponse.redirect(new URL(`${homeFor(role)}?denied=1`, req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
```

- [ ] **Step 7: Shared UI components**

`components/native-select.tsx`:

```tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
```

`components/form-message.tsx`:

```tsx
import type { ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/utils';

export function FormMessage({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <p
      data-testid="form-message"
      role={state.ok ? 'status' : 'alert'}
      className={cn('rounded-md border px-3 py-2 text-sm', state.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900')}
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
```

`components/page-header.tsx`:

```tsx
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
```

`components/stock-badge.tsx`:

```tsx
import { Badge } from '@/components/ui/badge';

export function StockBadge({ active, low }: { active: boolean; low: boolean }) {
  if (!active) return <Badge variant="secondary">Inactive</Badge>;
  if (low) return <Badge variant="destructive">Low</Badge>;
  return <Badge variant="outline">OK</Badge>;
}
```

`components/nav.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { canAccess, type Role } from '@/lib/session';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/items', label: 'Items' },
  { href: '/receive', label: 'Receive' },
  { href: '/release', label: 'Release' },
  { href: '/count', label: 'Count' },
  { href: '/movements', label: 'Movements' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
  { href: '/debug', label: 'Ledger check' },
];

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <aside className="border-b bg-muted/40 md:min-h-screen md:w-56 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between px-4 py-3 md:block">
        <div>
          <p className="font-semibold">Inventory</p>
          <p className="text-xs text-muted-foreground">Signed in as {role === 'admin' ? 'Admin' : 'Encoder'}</p>
        </div>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
        {LINKS.filter((l) => canAccess(role, l.href)).map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-accent', active && 'bg-accent font-medium')}
            >
              {l.label}
            </Link>
          );
        })}
        <form action={logoutAction} className="md:mt-4">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">Log out</Button>
        </form>
      </nav>
    </aside>
  );
}
```

- [ ] **Step 8: Login page, actions, root page, app layout**

`app/login/actions.ts`:

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/lib/auth';
import { roleForPassword } from '@/lib/passwords';
import { homeFor, SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/lib/session';

export async function loginAction(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const role = roleForPassword(String(formData.get('password') ?? ''), {
    admin: process.env.ADMIN_PASSWORD,
    encoder: process.env.ENCODER_PASSWORD,
  });
  if (!role) return { error: 'Wrong password.' };
  (await cookies()).set(SESSION_COOKIE, await signSession(role, sessionSecret(), Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(homeFor(role));
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
```

`app/login/login-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" autoFocus required />
      </div>
      {state?.error && (
        <p data-testid="form-message" role="alert" className="text-sm text-red-700">{state.error}</p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}
```

`app/login/page.tsx`:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoginForm } from './login-form';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Inventory</CardTitle>
          <CardDescription>Enter the admin or encoder password.</CardDescription>
        </CardHeader>
        <CardContent><LoginForm /></CardContent>
      </Card>
    </main>
  );
}
```

`app/page.tsx` (replace the scaffold page):

```tsx
import { redirect } from 'next/navigation';
import { currentRole } from '@/lib/auth';
import { homeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const role = await currentRole();
  redirect(role ? homeFor(role) : '/login');
}
```

`app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { currentRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  if (!role) redirect('/login');
  return (
    <div className="min-h-screen md:flex">
      <Nav role={role} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
```

In `app/layout.tsx`, set `export const metadata = { title: 'Inventory', description: 'Stock you can trust' }` and `<html lang="en">`. Keep the scaffold's fonts.

- [ ] **Step 9: Manual check**

Run: `npm run dev`. Open `http://localhost:3000`: you are redirected to `/login`. Signing in with the wrong password shows "Wrong password." The admin password lands on `/dashboard` (404 for now is expected). Log out, then sign in with the encoder password: you land on `/receive` (404 for now), and the nav shows only Items, Receive, Release, Count, and Movements. Visiting `/reports` redirects to `/receive?denied=1`.

- [ ] **Step 10: Typecheck and commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat(auth): admin/encoder login with HMAC cookie, middleware gating, app shell"
git push
```


### Task 9: Form parsing, items table, item card, item create/edit

**Files:**
- Create: `lib/forms.ts`, `components/movement-table.tsx`
- Create: `app/(app)/items/page.tsx`, `app/(app)/items/[id]/page.tsx`, `app/(app)/items/new/page.tsx`, `app/(app)/items/[id]/edit/page.tsx`, `app/(app)/items/item-form.tsx`, `app/(app)/items/actions.ts`
- Test: `tests/forms.test.ts`

**Interfaces:**
- Consumes: `parseNumberInput`, `InventoryError`, `ItemInput`, `ReceiptLine`, `ReleaseLine`, `listItems`, `getItem`, `listMovements`, `listNamed`, `createItem`, `updateItem`, `requireRole`, `toActionError`, `ActionResult`, the UI components from Task 8
- Produces (`lib/forms.ts`):
  - `readItemForm(fd: FormData): ItemInput`
  - `parseReceiptLines(raw: string): ReceiptLine[]`, `parseReleaseLines(raw: string): ReleaseLine[]`
  - `parseCountEntries(raw: string): { lineId: number; actual: number | null }[]`
  - `parseReorderUpdates(raw: string): { itemId: number; reorderPoint: number }[]`
  - Line JSON from the client: receipt `{ itemId: string; qty: string; unitCost: string }[]`, release `{ itemId: string; qty: string }[]`, count `{ lineId: number; actual: string; label: string }[]`, reorder `{ itemId: number; sku: string; reorderPoint: string }[]`
- Produces (UI): `<MovementTable rows showItem?>`, `createItemAction`, `updateItemAction`

- [ ] **Step 1: Write failing tests**

`tests/forms.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseCountEntries, parseReceiptLines, parseReleaseLines, parseReorderUpdates, readItemForm } from '@/lib/forms';

const j = (v: unknown) => JSON.stringify(v);

describe('parseReceiptLines', () => {
  it('parses lines, accepts thousands separators, and skips fully blank rows', () => {
    expect(parseReceiptLines(j([{ itemId: '3', qty: '1,000', unitCost: ' 50 ' }, { itemId: '', qty: '', unitCost: '' }, { itemId: '4', qty: '2', unitCost: '0' }]))).toEqual([
      { itemId: 3, qty: 1000, unitCost: 50 },
      { itemId: 4, qty: 2, unitCost: 0 },
    ]);
  });
  it('labels errors with the row number the user sees', () => {
    expect(() => parseReceiptLines(j([{ itemId: '', qty: '', unitCost: '' }, { itemId: '3', qty: 'abc', unitCost: '1' }]))).toThrow('Line 2: enter a valid quantity.');
    expect(() => parseReceiptLines(j([{ itemId: '', qty: '5', unitCost: '1' }]))).toThrow('Line 1: pick an item.');
    expect(() => parseReceiptLines(j([{ itemId: '3', qty: '5', unitCost: '' }]))).toThrow('Line 1: enter a valid unit cost.');
  });
  it('rejects junk payloads', () => {
    expect(() => parseReceiptLines('not json')).toThrow(/Could not read the line items/);
    expect(() => parseReceiptLines(j({ a: 1 }))).toThrow(/Could not read the line items/);
  });
});

describe('parseReleaseLines', () => {
  it('parses item and qty', () => {
    expect(parseReleaseLines(j([{ itemId: '7', qty: '2.5' }]))).toEqual([{ itemId: 7, qty: 2.5 }]);
    expect(() => parseReleaseLines(j([{ itemId: '7', qty: '1e3' }]))).toThrow('Line 1: enter a valid quantity.');
  });
});

describe('parseCountEntries', () => {
  it('treats blank as not counted', () => {
    expect(parseCountEntries(j([{ lineId: 1, actual: '17', label: 'T-001' }, { lineId: 2, actual: ' ', label: 'T-002' }]))).toEqual([
      { lineId: 1, actual: 17 },
      { lineId: 2, actual: null },
    ]);
    expect(() => parseCountEntries(j([{ lineId: 1, actual: 'x', label: 'T-001' }]))).toThrow('T-001: enter a valid count.');
  });
});

describe('parseReorderUpdates', () => {
  it('parses and names bad rows by SKU', () => {
    expect(parseReorderUpdates(j([{ itemId: 1, sku: 'A', reorderPoint: '5' }]))).toEqual([{ itemId: 1, reorderPoint: 5 }]);
    expect(() => parseReorderUpdates(j([{ itemId: 1, sku: 'A', reorderPoint: '' }]))).toThrow('A: enter a reorder point.');
  });
});

describe('readItemForm', () => {
  it('reads fields, defaults a blank reorder point to 0, and reads the checkbox', () => {
    const fd = new FormData();
    fd.set('sku', 'X-1'); fd.set('name', 'Thing'); fd.set('categoryId', '2'); fd.set('unitId', '3'); fd.set('reorderPoint', '');
    expect(readItemForm(fd)).toEqual({ sku: 'X-1', name: 'Thing', categoryId: 2, unitId: 3, reorderPoint: 0, active: false });
    fd.set('active', 'on'); fd.set('reorderPoint', 'ten');
    expect(() => readItemForm(fd)).toThrow('Reorder point must be a number.');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/forms.test.ts`
Expected: FAIL — cannot resolve `@/lib/forms`.

- [ ] **Step 3: Implement `lib/forms.ts`**

```ts
import type { ItemInput } from './catalog';
import { InventoryError, type ReceiptLine, type ReleaseLine } from './inventory';
import { parseNumberInput } from './num';

const isBlank = (v: unknown) => v === undefined || v === null || String(v).trim() === '';

function readArray(raw: string): Record<string, unknown>[] {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    v = null;
  }
  if (!Array.isArray(v)) throw new InventoryError('Could not read the line items. Reload the page and try again.');
  return v.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
}

// Row numbers in messages match what the user sees, even when blank rows are skipped.
function rows(raw: string, fields: string[]): { label: string; row: Record<string, unknown> }[] {
  return readArray(raw)
    .map((row, i) => ({ label: `Line ${i + 1}`, row }))
    .filter(({ row }) => !fields.every((f) => isBlank(row[f])));
}

function itemIdOf(v: unknown, label: string): number {
  const n = Number(v);
  if (isBlank(v) || !Number.isInteger(n) || n <= 0) throw new InventoryError(`${label}: pick an item.`);
  return n;
}

function num(v: unknown, message: string): number {
  const n = parseNumberInput(v);
  if (n === null) throw new InventoryError(message);
  return n;
}

export function parseReceiptLines(raw: string): ReceiptLine[] {
  return rows(raw, ['itemId', 'qty', 'unitCost']).map(({ label, row }) => ({
    itemId: itemIdOf(row.itemId, label),
    qty: num(row.qty, `${label}: enter a valid quantity.`),
    unitCost: num(row.unitCost, `${label}: enter a valid unit cost.`),
  }));
}

export function parseReleaseLines(raw: string): ReleaseLine[] {
  return rows(raw, ['itemId', 'qty']).map(({ label, row }) => ({
    itemId: itemIdOf(row.itemId, label),
    qty: num(row.qty, `${label}: enter a valid quantity.`),
  }));
}

export function parseCountEntries(raw: string): { lineId: number; actual: number | null }[] {
  return readArray(raw).map((row) => ({
    lineId: Number(row.lineId),
    actual: isBlank(row.actual) ? null : num(row.actual, `${String(row.label ?? 'Line')}: enter a valid count.`),
  }));
}

export function parseReorderUpdates(raw: string): { itemId: number; reorderPoint: number }[] {
  return readArray(raw).map((row) => {
    const label = String(row.sku ?? 'Item');
    if (isBlank(row.reorderPoint)) throw new InventoryError(`${label}: enter a reorder point.`);
    return { itemId: Number(row.itemId), reorderPoint: num(row.reorderPoint, `${label}: enter a valid reorder point.`) };
  });
}

export function readItemForm(fd: FormData): ItemInput {
  const rp = String(fd.get('reorderPoint') ?? '');
  return {
    sku: String(fd.get('sku') ?? ''),
    name: String(fd.get('name') ?? ''),
    categoryId: Number(fd.get('categoryId')),
    unitId: Number(fd.get('unitId')),
    reorderPoint: isBlank(rp) ? 0 : num(rp, 'Reorder point must be a number.'),
    active: fd.get('active') === 'on',
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/forms.test.ts`
Expected: all pass.

- [ ] **Step 5: Movement table**

`components/movement-table.tsx`:

```tsx
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatPeso, formatSignedQty } from '@/lib/num';
import type { MovementRow } from '@/lib/queries';
import { formatManila } from '@/lib/time';
import { cn } from '@/lib/utils';

const TYPE_STYLE = { receive: 'bg-emerald-100 text-emerald-900', release: 'bg-sky-100 text-sky-900', adjust: 'bg-amber-100 text-amber-900' };

export function MovementTable({ rows, showItem = true }: { rows: MovementRow[]; showItem?: boolean }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No movements match.</p>;
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Type</TableHead>
            {showItem && <TableHead>Item</TableHead>}
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit cost</TableHead>
            <TableHead>Ref</TableHead>
            <TableHead>Counterparty / note</TableHead>
            <TableHead>Who</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((m) => (
            <TableRow key={m.id} data-testid="movement-row">
              <TableCell className="whitespace-nowrap">{formatManila(m.createdAt)}</TableCell>
              <TableCell><Badge className={cn('border-0 capitalize', TYPE_STYLE[m.type])}>{m.type}</Badge></TableCell>
              {showItem && (
                <TableCell>
                  <Link href={`/items/${m.itemId}`} className="hover:underline"><span className="font-mono text-xs">{m.sku}</span> {m.itemName}</Link>
                </TableCell>
              )}
              <TableCell className={cn('text-right font-medium tabular-nums', m.qtyDelta < 0 ? 'text-red-700' : 'text-emerald-700')}>
                {formatSignedQty(m.qtyDelta)} <span className="text-xs text-muted-foreground">{m.unit}</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{m.unitCost === null ? '—' : formatPeso(m.unitCost)}</TableCell>
              <TableCell className="font-mono text-xs">{m.refNo}</TableCell>
              <TableCell>{m.counterparty}{m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}</TableCell>
              <TableCell className="capitalize">{m.actor}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 6: Items list page**

`app/(app)/items/page.tsx`:

```tsx
import Link from 'next/link';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { StockBadge } from '@/components/stock-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { isItemStatus, listItems } from '@/lib/queries';
import { cn } from '@/lib/utils';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default async function ItemsPage({ searchParams }: { searchParams: SP }) {
  const role = await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const category = Number(one(sp.category)) || undefined;
  const status = isItemStatus(one(sp.status)) ? (one(sp.status) as 'all') : 'all';
  const db = getDb();
  const items = listItems(db, { q: q || undefined, categoryId: category, status });
  const categories = listNamed(db, 'categories');

  return (
    <>
      <PageHeader
        title="Items"
        description={`${items.length} item(s)`}
        actions={role === 'admin' && <Button asChild><Link href="/items/new">New item</Link></Button>}
      />
      <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_12rem_10rem_auto]" role="search">
        <Input name="q" defaultValue={q} placeholder="Search SKU or name" aria-label="Search" />
        <NativeSelect name="category" defaultValue={category ?? ''} aria-label="Category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
        <NativeSelect name="status" defaultValue={status} aria-label="Status">
          <option value="all">Any status</option>
          <option value="low">Low stock</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </NativeSelect>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items match.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead><TableHead>Name</TableHead><TableHead>Category</TableHead><TableHead>Unit</TableHead>
                <TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reorder pt</TableHead>
                <TableHead className="text-right">Avg cost</TableHead><TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id} className={cn(i.low && 'bg-red-50/60')}>
                  <TableCell className="font-mono text-xs"><Link href={`/items/${i.id}`} className="hover:underline">{i.sku}</Link></TableCell>
                  <TableCell><Link href={`/items/${i.id}`} className="hover:underline">{i.name}</Link></TableCell>
                  <TableCell>{i.category}</TableCell>
                  <TableCell>{i.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(i.qty)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(i.reorderPoint)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatPeso(i.avgCost)}</TableCell>
                  <TableCell><StockBadge active={i.active} low={i.low} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 7: Item card**

`app/(app)/items/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MovementTable } from '@/components/movement-table';
import { PageHeader } from '@/components/page-header';
import { StockBadge } from '@/components/stock-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { getItem, listMovements } from '@/lib/queries';

export default async function ItemCard({ params }: { params: Promise<{ id: string }> }) {
  const role = await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const db = getDb();
  const item = Number.isInteger(id) ? getItem(db, id) : null;
  if (!item) notFound();
  const movements = listMovements(db, { itemId: item.id, limit: 300 });
  const stats = [
    { label: 'On hand', value: `${formatQty(item.qty)} ${item.unit}`, testId: 'qty-on-hand', raw: formatQty(item.qty) },
    { label: 'Average cost', value: formatPeso(item.avgCost), testId: 'avg-cost', raw: formatPeso(item.avgCost) },
    { label: 'Stock value', value: formatPeso(item.qty * item.avgCost) },
    { label: 'Reorder point', value: `${formatQty(item.reorderPoint)} ${item.unit}` },
  ];
  return (
    <>
      <PageHeader
        title={item.name}
        description={`${item.sku} · ${item.category} · per ${item.unit}`}
        actions={
          <>
            <StockBadge active={item.active} low={item.low} />
            {role === 'admin' && <Button asChild variant="outline"><Link href={`/items/${item.id}/edit`}>Edit</Link></Button>}
          </>
        }
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{s.label}</CardTitle></CardHeader>
            <CardContent className="text-xl font-semibold tabular-nums">
              {s.testId ? <><span data-testid={s.testId}>{s.raw}</span>{s.label === 'On hand' && <span className="ml-1 text-sm font-normal">{item.unit}</span>}</> : s.value}
            </CardContent>
          </Card>
        ))}
      </div>
      <h2 className="mb-2 text-lg font-semibold">Movement history</h2>
      <MovementTable rows={movements} showItem={false} />
    </>
  );
}
```

- [ ] **Step 8: Item form, actions, new and edit pages**

`app/(app)/items/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { createItem, updateItem } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { readItemForm } from '@/lib/forms';

export async function createItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  let id: number;
  try {
    id = createItem(getDb(), readItemForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/items/${id}`);
}

export async function updateItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const id = Number(fd.get('id'));
  try {
    updateItem(getDb(), id, readItemForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/items/${id}`);
}
```

`app/(app)/items/item-form.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createItemAction, updateItemAction } from './actions';

type Option = { id: number; name: string };
export type ItemFormValues = { id?: number; sku: string; name: string; categoryId: string; unitId: string; reorderPoint: string; active: boolean };

export function ItemForm({ initial, categories, units }: { initial: ItemFormValues; categories: Option[]; units: Option[] }) {
  const [state, action, pending] = useActionState(initial.id ? updateItemAction : createItemAction, null);
  const [v, setV] = useState(initial);
  const set = (patch: Partial<ItemFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  return (
    <form action={action} className="max-w-xl space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" value={v.sku} onChange={(e) => set({ sku: e.target.value })} required maxLength={32} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reorderPoint">Reorder point</Label>
          <Input id="reorderPoint" name="reorderPoint" inputMode="decimal" value={v.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" value={v.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="categoryId">Category</Label>
          <NativeSelect id="categoryId" name="categoryId" value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })} required>
            <option value="" disabled>Pick a category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitId">Unit</Label>
          <NativeSelect id="unitId" name="unitId" value={v.unitId} onChange={(e) => set({ unitId: e.target.value })} required>
            <option value="" disabled>Pick a unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> Active
      </label>
      <p className="text-xs text-muted-foreground">Quantity and cost change only through receive, release and count.</p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save item'}</Button>
    </form>
  );
}
```

`app/(app)/items/new/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { ItemForm } from '../item-form';

export default async function NewItemPage() {
  await requireRole('admin');
  const db = getDb();
  return (
    <>
      <PageHeader title="New item" />
      <ItemForm
        initial={{ sku: '', name: '', categoryId: '', unitId: '', reorderPoint: '0', active: true }}
        categories={listNamed(db, 'categories')}
        units={listNamed(db, 'units')}
      />
    </>
  );
}
```

`app/(app)/items/[id]/edit/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { getItem } from '@/lib/queries';
import { ItemForm } from '../../item-form';

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('admin');
  const db = getDb();
  const item = getItem(db, Number((await params).id));
  if (!item) notFound();
  return (
    <>
      <PageHeader title={`Edit ${item.sku}`} />
      <ItemForm
        initial={{ id: item.id, sku: item.sku, name: item.name, categoryId: String(item.categoryId), unitId: String(item.unitId), reorderPoint: String(item.reorderPoint), active: item.active }}
        categories={listNamed(db, 'categories')}
        units={listNamed(db, 'units')}
      />
    </>
  );
}
```

- [ ] **Step 9: Manual check, then commit**

Run `npm run dev` and sign in as admin. On `/items`, 40 seeded items show, and 6 of them have red "Low" badges. Search "nail" and filter by Paint. Click a row to see the card and its history. Create item `TEST-1`, then edit it. Sign in as encoder: there is no "New item" or "Edit", and `/items/1/edit` redirects to `/receive?denied=1`.

```powershell
npm test; npm run typecheck
git add -A
git commit -m "feat(items): searchable items table, item card with history, admin create/edit"
git push
```

---

### Task 10: Receive flow

**Files:**
- Create: `app/(app)/receive/page.tsx`, `app/(app)/receive/receive-form.tsx`, `app/(app)/receive/actions.ts`

**Interfaces:**
- Consumes: `postReceipt`, `parseReceiptLines`, `listItems`, `listSuppliers`, `requireRole`, `toActionError`, `FormMessage`, `NativeSelect`, `formatPeso`, `parseNumberInput`, `formatQty`
- Produces: `receiveAction(prev: ActionResult, fd: FormData): Promise<ActionResult>`; form fields `supplierId`, `refNo`, `note`, `lines` (JSON). Accessible labels `Supplier`, `Reference no.`, `Line N item`, `Line N qty`, `Line N unit cost`, and a submit button `Post receipt` (the e2e tests rely on these).

- [ ] **Step 1: Server action**

`app/(app)/receive/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReceiptLines } from '@/lib/forms';
import { postReceipt } from '@/lib/inventory';

export async function receiveAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const lines = parseReceiptLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    postReceipt(getDb(), { supplierId: Number(fd.get('supplierId')), refNo, note: String(fd.get('note') ?? ''), lines }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Received ${lines.length} line(s) under ${refNo.trim()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
```

- [ ] **Step 2: Form (all fields controlled, so a failed post keeps what was typed)**

`app/(app)/receive/receive-form.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatPeso, formatQty, parseNumberInput } from '@/lib/num';
import { receiveAction } from './actions';

export type ItemOption = { id: number; sku: string; name: string; unit: string; qty: number; avgCost: number };
type Line = { key: number; itemId: string; qty: string; unitCost: string };

let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '', unitCost: '' });

export function ReceiveForm({ items, suppliers }: { items: ItemOption[]; suppliers: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(receiveAction, null);
  const [supplierId, setSupplierId] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  useEffect(() => {
    if (state?.ok) {
      setRefNo('');
      setNote('');
      setLines([blankLine()]);
    }
  }, [state]);

  const byId = new Map(items.map((i) => [String(i.id), i]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const lineTotal = (l: Line) => {
    const q = parseNumberInput(l.qty);
    const c = parseNumberInput(l.unitCost);
    return q !== null && c !== null ? q * c : null;
  };
  const total = lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="supplierId">Supplier</Label>
          <NativeSelect id="supplierId" name="supplierId" value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
            <option value="" disabled>Pick a supplier…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="refNo">Reference no.</Label>
          <Input id="refNo" name="refNo" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="DR / invoice no." maxLength={60} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((l, idx) => {
          const n = idx + 1;
          const item = byId.get(l.itemId);
          const t = lineTotal(l);
          return (
            <div key={l.key} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_8rem_9rem_8rem_auto]">
              <div className="space-y-1">
                <Label htmlFor={`item-${l.key}`} className="text-xs">Line {n} item</Label>
                <NativeSelect
                  id={`item-${l.key}`}
                  value={l.itemId}
                  onChange={(e) => {
                    const it = byId.get(e.target.value);
                    update(l.key, { itemId: e.target.value, unitCost: l.unitCost || (it && it.avgCost > 0 ? String(it.avgCost) : '') });
                  }}
                >
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && <p className="text-xs text-muted-foreground">On hand {formatQty(item.qty)} {item.unit} · avg {formatPeso(item.avgCost)}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`qty-${l.key}`} className="text-xs">Line {n} qty</Label>
                <Input id={`qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`cost-${l.key}`} className="text-xs">Line {n} unit cost</Label>
                <Input id={`cost-${l.key}`} inputMode="decimal" value={l.unitCost} onChange={(e) => update(l.key, { unitCost: e.target.value })} />
              </div>
              <p className="pb-2 text-right text-sm tabular-nums">{t === null ? '—' : formatPeso(t)}</p>
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                Remove
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty, unitCost }) => ({ itemId, qty, unitCost })))} />
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="text-sm">Total <span className="ml-2 text-lg font-semibold tabular-nums">{formatPeso(total)}</span></p>
        <Button type="submit" disabled={pending}>{pending ? 'Posting…' : 'Post receipt'}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
```

- [ ] **Step 3: Page**

`app/(app)/receive/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { ReceiveForm } from './receive-form';

export default async function ReceivePage() {
  await requireRole('admin', 'encoder');
  const db = getDb();
  const items = listItems(db, { status: 'active' }).map(({ id, sku, name, unit, qty, avgCost }) => ({ id, sku, name, unit, qty, avgCost }));
  return (
    <>
      <PageHeader title="Receive stock" description="Posting adds to on-hand qty and updates the weighted-average cost." />
      <ReceiveForm items={items} suppliers={listSuppliers(db).map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
```

- [ ] **Step 4: Manual check**

Run: `npm run dev`. Sign in as encoder, then on `/receive`:
- Post with an empty ref and see the native required prompt.
- Post a line with qty `abc` and see "Line 1: enter a valid quantity.", with supplier, ref, and lines still filled in.
- Post 10 @ 50 for a new item, then 10 @ 100. Its card should show 20 at ₱75.00.

- [ ] **Step 5: Commit**

```powershell
npm run typecheck
git add -A
git commit -m "feat(receive): multi-line receipt posting with weighted-average cost"
git push
```

---

### Task 11: Release flow with the hard block

**Files:**
- Create: `app/(app)/release/page.tsx`, `app/(app)/release/release-form.tsx`, `app/(app)/release/actions.ts`

**Interfaces:**
- Consumes: `postRelease`, `parseReleaseLines`, `listItems`, `requireRole`, `toActionError`, `ItemOption` (from `receive/receive-form.tsx`)
- Produces: `releaseAction`. Labels: `Destination / customer`, `Reference no.`, `Line N item`, `Line N qty`; button `Post release`.

- [ ] **Step 1: Server action**

`app/(app)/release/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReleaseLines } from '@/lib/forms';
import { postRelease } from '@/lib/inventory';

export async function releaseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const lines = parseReleaseLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    postRelease(getDb(), { counterparty: String(fd.get('counterparty') ?? ''), refNo, note: String(fd.get('note') ?? ''), lines }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Released ${lines.length} line(s) under ${refNo.trim()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
```

- [ ] **Step 2: Form, which shows on-hand qty and warns early (the server is still the authority)**

`app/(app)/release/release-form.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatQty, parseNumberInput } from '@/lib/num';
import type { ItemOption } from '../receive/receive-form';
import { releaseAction } from './actions';

type Line = { key: number; itemId: string; qty: string };
let nextKey = 1;
const blankLine = (): Line => ({ key: nextKey++, itemId: '', qty: '' });

export function ReleaseForm({ items }: { items: ItemOption[] }) {
  const [state, action, pending] = useActionState(releaseAction, null);
  const [counterparty, setCounterparty] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [blankLine()]);

  useEffect(() => {
    if (state?.ok) {
      setRefNo('');
      setNote('');
      setLines([blankLine()]);
    }
  }, [state]);

  const byId = new Map(items.map((i) => [String(i.id), i]));
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const wanted = new Map<string, number>();
  for (const l of lines) {
    const q = parseNumberInput(l.qty);
    if (l.itemId && q !== null) wanted.set(l.itemId, (wanted.get(l.itemId) ?? 0) + q);
  }

  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="counterparty">Destination / customer</Label>
          <Input id="counterparty" name="counterparty" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={120} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="refNo">Reference no.</Label>
          <Input id="refNo" name="refNo" value={refNo} onChange={(e) => setRefNo(e.target.value)} placeholder="DR / charge slip no." maxLength={60} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">Note (optional)</Label>
          <Input id="note" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </div>
      </div>

      <div className="space-y-3">
        {lines.map((l, idx) => {
          const n = idx + 1;
          const item = byId.get(l.itemId);
          const over = item && (wanted.get(l.itemId) ?? 0) > item.qty;
          return (
            <div key={l.key} className="grid items-end gap-2 rounded-md border p-3 md:grid-cols-[1fr_8rem_auto]">
              <div className="space-y-1">
                <Label htmlFor={`item-${l.key}`} className="text-xs">Line {n} item</Label>
                <NativeSelect id={`item-${l.key}`} value={l.itemId} onChange={(e) => update(l.key, { itemId: e.target.value })}>
                  <option value="">Pick an item…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
                </NativeSelect>
                {item && (
                  <p className={over ? 'text-xs font-medium text-red-700' : 'text-xs text-muted-foreground'}>
                    On hand {formatQty(item.qty)} {item.unit}{over && ' — this release asks for more than that'}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`qty-${l.key}`} className="text-xs">Line {n} qty</Label>
                <Input id={`qty-${l.key}`} inputMode="decimal" value={l.qty} onChange={(e) => update(l.key, { qty: e.target.value })} />
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                Remove
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>Add line</Button>
      </div>

      <input type="hidden" name="lines" value={JSON.stringify(lines.map(({ itemId, qty }) => ({ itemId, qty })))} />
      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={pending}>{pending ? 'Posting…' : 'Post release'}</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
```

- [ ] **Step 3: Page**

`app/(app)/release/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { ReleaseForm } from './release-form';

export default async function ReleasePage() {
  await requireRole('admin', 'encoder');
  const items = listItems(getDb(), { status: 'active' }).map(({ id, sku, name, unit, qty, avgCost }) => ({ id, sku, name, unit, qty, avgCost }));
  return (
    <>
      <PageHeader title="Release stock" description="Posting subtracts from on-hand qty. You can't release more than is on hand." />
      <ReleaseForm items={items} />
    </>
  );
}
```

- [ ] **Step 4: Manual check, then commit**

Try to release 25 of an item that has 20 on hand: the error reads `Cannot release 25 pc of … — only 20 on hand.` and everything you typed stays. Split the same 25 across two lines: same block. Release 5: on hand drops by 5, and avg cost is unchanged.

```powershell
npm run typecheck
git add -A
git commit -m "feat(release): release posting with hard over-release block"
git push
```

---

### Task 12: Movements ledger

**Files:**
- Create: `app/(app)/movements/page.tsx`

**Interfaces:**
- Consumes: `listMovements`, `listItems`, `isMovementType`, `isDay`, `MovementTable`
- Produces: `/movements?item=<id>&type=<t>&from=YYYY-MM-DD&to=YYYY-MM-DD`

- [ ] **Step 1: Page**

```tsx
import { MovementTable } from '@/components/movement-table';
import { NativeSelect } from '@/components/native-select';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { isMovementType } from '@/lib/inventory';
import { listItems, listMovements } from '@/lib/queries';
import { isDay } from '@/lib/time';

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const LIMIT = 500;

export default async function MovementsPage({ searchParams }: { searchParams: SP }) {
  await requireRole('admin', 'encoder');
  const sp = await searchParams;
  const itemId = Number(one(sp.item)) || undefined;
  const type = isMovementType(one(sp.type)) ? (one(sp.type) as 'receive') : undefined;
  const from = isDay(one(sp.from)) ? one(sp.from) : undefined;
  const to = isDay(one(sp.to)) ? one(sp.to) : undefined;
  const db = getDb();
  const rows = listMovements(db, { itemId, type, from, to, limit: LIMIT });
  const items = listItems(db);

  return (
    <>
      <PageHeader title="Movements" description="Every receive, release and adjustment. Entries are never edited." />
      <form className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_10rem_10rem_auto] lg:items-end">
        <div className="space-y-1">
          <Label htmlFor="item">Item</Label>
          <NativeSelect id="item" name="item" defaultValue={itemId ?? ''}>
            <option value="">All items</option>
            {items.map((i) => <option key={i.id} value={i.id}>{`${i.sku} — ${i.name}`}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <Label htmlFor="type">Type</Label>
          <NativeSelect id="type" name="type" defaultValue={type ?? ''}>
            <option value="">All types</option>
            <option value="receive">Receive</option>
            <option value="release">Release</option>
            <option value="adjust">Adjust</option>
          </NativeSelect>
        </div>
        <div className="space-y-1"><Label htmlFor="from">From</Label><Input id="from" name="from" type="date" defaultValue={from} /></div>
        <div className="space-y-1"><Label htmlFor="to">To</Label><Input id="to" name="to" type="date" defaultValue={to} /></div>
        <Button type="submit" variant="secondary">Filter</Button>
      </form>
      {rows.length === LIMIT && <p className="mb-2 text-xs text-muted-foreground">Showing the latest {LIMIT}. Narrow the filters to see older entries.</p>}
      <MovementTable rows={rows} />
    </>
  );
}
```

- [ ] **Step 2: Manual check, then commit**

Filter by an item, by type `adjust` (the seeded count variances appear), and by a single day.

```powershell
npm run typecheck
git add -A
git commit -m "feat(movements): filterable ledger page"
git push
```

---

### Task 13: Count workflow pages

**Files:**
- Create: `app/(app)/count/page.tsx`, `app/(app)/count/start-count-form.tsx`, `app/(app)/count/actions.ts`, `app/(app)/count/[id]/page.tsx`, `app/(app)/count/[id]/count-sheet.tsx`

**Interfaces:**
- Consumes: `startCountSession`, `getCountSession`, `listCountSessions`, `saveCountActuals`, `refreshExpected`, `postCountSession`, `parseCountEntries`, `listNamed`
- Produces: `startCountAction`, `countAction` (intent `save | refresh | post`). Labels `Category`, `Start count`, `Actual for <SKU>`, and the buttons `Save progress`, `Refresh expected`, `Post count`.

- [ ] **Step 1: Actions**

`app/(app)/count/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { postCountSession, refreshExpected, saveCountActuals, startCountSession } from '@/lib/count';
import { getDb } from '@/lib/db';
import { parseCountEntries } from '@/lib/forms';

export async function startCountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin', 'encoder');
  const raw = String(fd.get('categoryId') ?? '');
  let id: number;
  try {
    id = startCountSession(getDb(), { categoryId: raw === '' ? null : Number(raw) });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/count');
  redirect(`/count/${id}`);
}

export async function countAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  const sessionId = Number(fd.get('sessionId'));
  const intent = String(fd.get('intent') ?? 'save');
  let result: ActionResult;
  let posted: number | null = null;
  try {
    const db = getDb();
    saveCountActuals(db, sessionId, parseCountEntries(String(fd.get('actuals') ?? '[]')));
    if (intent === 'refresh') {
      const n = refreshExpected(db, sessionId);
      result = { ok: true, message: n ? `Updated expected qty for ${n} item(s). Re-check them before posting.` : 'Expected quantities are already current.' };
    } else if (intent === 'post') {
      posted = postCountSession(db, sessionId, actor).adjustments;
      result = null;
    } else {
      result = { ok: true, message: 'Progress saved.' };
    }
  } catch (e) {
    result = toActionError(e);
  }
  revalidatePath('/', 'layout');
  // redirect() throws, so it must stay outside the try/catch above.
  if (posted !== null) redirect(`/count/${sessionId}?posted=${posted}`);
  return result;
}
```

- [ ] **Step 2: Session list and start form**

`app/(app)/count/start-count-form.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { startCountAction } from './actions';

export function StartCountForm({ categories }: { categories: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(startCountAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="categoryId">Category</Label>
        <NativeSelect id="categoryId" name="categoryId" defaultValue="" className="w-56">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Start count'}</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}
```

`app/(app)/count/page.tsx`:

```tsx
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listNamed } from '@/lib/catalog';
import { listCountSessions } from '@/lib/count';
import { getDb } from '@/lib/db';
import { formatManila } from '@/lib/time';
import { StartCountForm } from './start-count-form';

export default async function CountPage() {
  await requireRole('admin', 'encoder');
  const db = getDb();
  const sessions = listCountSessions(db);
  return (
    <>
      <PageHeader title="Physical count" description="Count shelves, type what you find, and post the variances as adjustments." />
      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Start a new count</CardTitle></CardHeader>
        <CardContent><StartCountForm categories={listNamed(db, 'categories')} /></CardContent>
      </Card>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No counts yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Started</TableHead><TableHead>Scope</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Variances</TableHead><TableHead>Status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell><Link className="hover:underline" href={`/count/${s.id}`}>{formatManila(s.startedAt)}</Link></TableCell>
                  <TableCell>{s.scope}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.countedCount} / {s.lineCount}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.varianceCount}</TableCell>
                  <TableCell>{s.postedAt ? <Badge variant="secondary">Posted {formatManila(s.postedAt)}</Badge> : <Badge>Open</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 3: Count sheet**

`app/(app)/count/[id]/count-sheet.tsx`:

```tsx
'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { CountLineView } from '@/lib/count';
import { formatQty, formatSignedQty, parseNumberInput } from '@/lib/num';
import { cn } from '@/lib/utils';
import { countAction } from '../actions';

export function CountSheet({ sessionId, lines }: { sessionId: number; lines: CountLineView[] }) {
  const [state, action, pending] = useActionState(countAction, null);
  const [actuals, setActuals] = useState<Record<number, string>>(() =>
    Object.fromEntries(lines.map((l) => [l.lineId, l.actual === null ? '' : String(l.actual)])),
  );
  const payload = lines.map((l) => ({ lineId: l.lineId, actual: actuals[l.lineId] ?? '', label: l.sku }));
  const counted = payload.filter((p) => p.actual.trim() !== '').length;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sessionId" value={sessionId} />
      <input type="hidden" name="actuals" value={JSON.stringify(payload)} />
      <p className="text-sm text-muted-foreground">{counted} of {lines.length} counted. Leave a row blank to skip it.</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="w-36">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l) => {
              const a = parseNumberInput(actuals[l.lineId] ?? '');
              const variance = a === null || (actuals[l.lineId] ?? '').trim() === '' ? null : a - l.expected;
              const moved = Math.abs(l.currentQty - l.expected) > 1e-9;
              return (
                <TableRow key={l.lineId} className={cn(moved && 'bg-amber-50')}>
                  <TableCell className="font-mono text-xs">{l.sku}</TableCell>
                  <TableCell>
                    {l.name}
                    {moved && <span className="block text-xs text-amber-800">Stock moved since start (now {formatQty(l.currentQty)}). Refresh expected.</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(l.expected)} {l.unit}</TableCell>
                  <TableCell>
                    <Input
                      aria-label={`Actual for ${l.sku}`}
                      inputMode="decimal"
                      value={actuals[l.lineId] ?? ''}
                      onChange={(e) => setActuals((cur) => ({ ...cur, [l.lineId]: e.target.value }))}
                    />
                  </TableCell>
                  <TableCell className={cn('text-right font-medium tabular-nums', variance !== null && variance < 0 && 'text-red-700', variance !== null && variance > 0 && 'text-emerald-700')}>
                    {variance === null ? '—' : formatSignedQty(Math.round(variance * 1000) / 1000)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <FormMessage state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="intent" value="save" variant="outline" disabled={pending}>Save progress</Button>
        <Button type="submit" name="intent" value="refresh" variant="outline" disabled={pending}>Refresh expected</Button>
        <Button
          type="submit"
          name="intent"
          value="post"
          disabled={pending}
          onClick={(e) => {
            if (!confirm('Post this count? Variances become adjustments and cannot be edited.')) e.preventDefault();
          }}
        >
          Post count
        </Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 4: Session page (editable while open, read-only once posted)**

`app/(app)/count/[id]/page.tsx`:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getCountSession } from '@/lib/count';
import { getDb } from '@/lib/db';
import { formatQty, formatSignedQty } from '@/lib/num';
import { formatManila } from '@/lib/time';
import { CountSheet } from './count-sheet';

export default async function CountSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ posted?: string }>;
}) {
  await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const { posted } = await searchParams;
  const session = Number.isInteger(id) ? getCountSession(getDb(), id) : null;
  if (!session) notFound();
  const title = `Count #${session.id} — ${session.scope}`;
  if (!session.postedAt) {
    return (
      <>
        <PageHeader title={title} description={`Started ${formatManila(session.startedAt)}`} />
        <CountSheet sessionId={session.id} lines={session.lines} />
      </>
    );
  }
  return (
    <>
      <PageHeader title={title} description={`Posted ${formatManila(session.postedAt)} · adjustments use ref COUNT-${session.id}`} />
      {posted !== undefined && (
        <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Count posted. {Number(posted) || 0} adjustment(s) created.
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {session.lines.map((l) => (
              <TableRow key={l.lineId}>
                <TableCell className="font-mono text-xs"><Link className="hover:underline" href={`/items/${l.itemId}`}>{l.sku}</Link></TableCell>
                <TableCell>{l.name}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.expected)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.actual === null ? 'Not counted' : formatQty(l.actual)}</TableCell>
                <TableCell className="text-right tabular-nums">{l.variance === null ? '—' : formatSignedQty(l.variance)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Manual check, then commit**

Start a Fasteners count, enter one actual 3 below expected, and save. In another tab, release 1 of that item, then try to post: you get the "Stock moved…" error and an amber row. Refresh expected, then post. Movements shows the adjust with note `count variance`.

```powershell
npm run typecheck
git add -A
git commit -m "feat(count): count sessions UI with save, refresh-expected and post"
git push
```


### Task 14: Dashboard, reports with CSV export, ledger check page

**Files:**
- Create: `components/in-out-chart.tsx`, `app/(app)/dashboard/page.tsx`
- Create: `app/(app)/reports/page.tsx`, `app/(app)/reports/csv/[report]/route.ts`
- Create: `app/(app)/debug/page.tsx`, `app/(app)/debug/actions.ts`

**Interfaces:**
- Consumes: `dashboardStats`, `inOutLast7Days`, `DayFlow`, `buildReport`, `REPORT_KEYS`, `isReportKey`, `toCsv`, `ledgerCheck`, `rebuildCachedQty`, `listMovements`, `currentRole`, `requireRole`
- Produces: `GET /reports/csv/<key>` returns `text/csv` with `attachment; filename="<key>-<YYYY-MM-DD>.csv"`. It answers 403 for non-admins and 404 for unknown keys. Each report section has a download link with `data-testid="csv-<key>"`. `/debug` shows the text `All items match the ledger.` when clean.

- [ ] **Step 1: Chart**

`components/in-out-chart.tsx`:

```tsx
'use client';

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import type { DayFlow } from '@/lib/dashboard';

const config = {
  inValue: { label: 'Received (₱)', color: 'var(--chart-2)' },
  outValue: { label: 'Released (₱)', color: 'var(--chart-1)' },
} satisfies ChartConfig;

export function InOutChart({ data }: { data: DayFlow[] }) {
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis width={80} tickLine={false} axisLine={false} tickFormatter={(v) => `₱${Number(v).toLocaleString('en-PH')}`} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="inValue" fill="var(--color-inValue)" radius={4} />
        <Bar dataKey="outValue" fill="var(--color-outValue)" radius={4} />
      </BarChart>
    </ChartContainer>
  );
}
```

- [ ] **Step 2: Dashboard page**

`app/(app)/dashboard/page.tsx`:

```tsx
import Link from 'next/link';
import { InOutChart } from '@/components/in-out-chart';
import { MovementTable } from '@/components/movement-table';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { dashboardStats, inOutLast7Days } from '@/lib/dashboard';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { listMovements } from '@/lib/queries';
import { buildReport } from '@/lib/reports';
import { nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

export default async function DashboardPage() {
  await requireRole('admin');
  const db = getDb();
  const now = nowIso();
  const s = dashboardStats(db, now);
  const low = buildReport(db, 'low-stock', now).rows.slice(0, 8);
  const tiles = [
    { label: 'Active SKUs', value: formatQty(s.totalSkus), href: '/items?status=active' },
    { label: 'Stock value', value: formatPeso(s.stockValue), href: '/reports' },
    { label: 'Low stock', value: formatQty(s.lowStockCount), href: '/items?status=low', alert: s.lowStockCount > 0 },
    { label: "Today's movements", value: formatQty(s.todayMovements), href: '/movements' },
  ];
  return (
    <>
      <PageHeader title="Dashboard" />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href}>
            <Card className={cn('h-full transition-colors hover:bg-accent/50', t.alert && 'border-red-300')}>
              <CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{t.label}</CardTitle></CardHeader>
              <CardContent className={cn('text-2xl font-semibold tabular-nums', t.alert && 'text-red-700')}>{t.value}</CardContent>
            </Card>
          </Link>
        ))}
      </div>
      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">Last 7 days — value in vs out</CardTitle></CardHeader>
          <CardContent><InOutChart data={inOutLast7Days(db, now)} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Low stock</CardTitle></CardHeader>
          <CardContent>
            {low.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing is low.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {low.map((r) => (
                  <li key={String(r[0])} className="flex justify-between gap-2">
                    <span><span className="font-mono text-xs">{r[0]}</span> {r[1]}</span>
                    <span className="whitespace-nowrap tabular-nums text-red-700">{formatQty(Number(r[4]))} / {formatQty(Number(r[5]))}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
      <h2 className="mb-2 text-lg font-semibold">Recent movements</h2>
      <MovementTable rows={listMovements(db, { limit: 10 })} />
    </>
  );
}
```

- [ ] **Step 3: CSV route handler**

`app/(app)/reports/csv/[report]/route.ts`:

```ts
import { currentRole } from '@/lib/auth';
import { toCsv } from '@/lib/csv';
import { getDb } from '@/lib/db';
import { buildReport, isReportKey } from '@/lib/reports';
import { manilaDay, nowIso } from '@/lib/time';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ report: string }> }) {
  if ((await currentRole()) !== 'admin') return new Response('Forbidden', { status: 403 });
  const { report } = await params;
  if (!isReportKey(report)) return new Response('Not found', { status: 404 });
  const now = nowIso();
  const table = buildReport(getDb(), report, now);
  return new Response(toCsv(table.headers, table.rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${report}-${manilaDay(now)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
```

- [ ] **Step 4: Reports page**

`app/(app)/reports/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { buildReport, REPORT_KEYS } from '@/lib/reports';
import { nowIso } from '@/lib/time';

export default async function ReportsPage() {
  await requireRole('admin');
  const db = getDb();
  const now = nowIso();
  const tables = REPORT_KEYS.map((k) => buildReport(db, k, now));
  return (
    <>
      <PageHeader title="Reports" description="Each report downloads as a CSV that opens in Excel." />
      <div className="space-y-6">
        {tables.map((t) => (
          <Card key={t.key}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </div>
              <a
                href={`/reports/csv/${t.key}`}
                download
                data-testid={`csv-${t.key}`}
                className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
              >
                Download CSV
              </a>
            </CardHeader>
            <CardContent>
              {t.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing to show.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>{t.headers.map((h) => <TableHead key={h}>{h}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.rows.map((r, i) => (
                        <TableRow key={i}>
                          {r.map((c, j) => (
                            <TableCell key={j} className={typeof c === 'number' ? 'text-right tabular-nums' : undefined}>
                              {typeof c === 'number' ? (t.moneyColumns.includes(j) ? formatPeso(c) : formatQty(c)) : c}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Ledger check (`/debug`)**

`app/(app)/debug/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { rebuildCachedQty } from '@/lib/inventory';

export async function rebuildAction(): Promise<void> {
  await requireRole('admin');
  const fixed = rebuildCachedQty(getDb());
  revalidatePath('/', 'layout');
  redirect(`/debug?rebuilt=${fixed}`);
}
```

`app/(app)/debug/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ledgerCheck } from '@/lib/inventory';
import { formatQty } from '@/lib/num';
import { rebuildAction } from './actions';

export default async function DebugPage({ searchParams }: { searchParams: Promise<{ rebuilt?: string }> }) {
  await requireRole('admin');
  const { rebuilt } = await searchParams;
  const rows = ledgerCheck(getDb());
  const bad = rows.filter((r) => !r.match);
  return (
    <>
      <PageHeader title="Ledger check" description="Compares each item's cached qty with the sum of its movements." />
      {rebuilt !== undefined && <p role="status" className="mb-4 text-sm">Rebuild finished: {rebuilt} item(s) corrected.</p>}
      {bad.length === 0 ? (
        <p className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          All items match the ledger. ({rows.length} items checked)
        </p>
      ) : (
        <div className="mb-4 overflow-x-auto rounded-md border border-red-300">
          <Table>
            <TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">Cached</TableHead><TableHead className="text-right">Ledger</TableHead></TableRow></TableHeader>
            <TableBody>
              {bad.map((r) => (
                <TableRow key={r.itemId}>
                  <TableCell className="font-mono text-xs">{r.sku}</TableCell><TableCell>{r.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.cached)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(r.ledger)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <form action={rebuildAction}>
        <Button type="submit" variant="outline">Recompute cached qty from ledger</Button>
      </form>
    </>
  );
}
```

- [ ] **Step 6: Manual check, then commit**

As admin: the dashboard tiles show 40 SKUs and 6 low, and the chart has 7 bars per series. Reports shows four tables, and each "Download CSV" saves a file that opens in Excel with ₱-free numeric columns and readable text. `/debug` says "All items match the ledger." As encoder: `/reports/csv/low-stock` redirects (middleware), and the handler returns 403 even if middleware is bypassed.

```powershell
npm test; npm run typecheck
git add -A
git commit -m "feat: dashboard with 7-day chart, reports with CSV export, ledger check page"
git push
```

---

### Task 15: Settings — categories, units, suppliers, reorder bulk edit

**Files:**
- Create: `app/(app)/settings/page.tsx`, `app/(app)/settings/actions.ts`, `app/(app)/settings/named-list-editor.tsx`, `app/(app)/settings/supplier-editor.tsx`, `app/(app)/settings/reorder-editor.tsx`

**Interfaces:**
- Consumes: `listNamed`, `addNamed`, `renameNamed`, `deleteNamed`, `listSuppliers`, `addSupplier`, `updateSupplier`, `deleteSupplier`, `setReorderPoints`, `parseReorderUpdates`, `listItems`
- Produces: `namedListAction`, `supplierAction`, `saveReorderPointsAction` (all admin-only)

- [ ] **Step 1: Actions**

`app/(app)/settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { addNamed, addSupplier, deleteNamed, deleteSupplier, type NamedTable, renameNamed, setReorderPoints, updateSupplier } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { parseReorderUpdates } from '@/lib/forms';

const done = (message: string): ActionResult => {
  revalidatePath('/', 'layout');
  return { ok: true, message };
};

export async function namedListAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const table = String(fd.get('table')) as NamedTable;
  if (table !== 'categories' && table !== 'units') return { ok: false, error: 'Unknown list.' };
  const intent = String(fd.get('intent'));
  const name = String(fd.get('name') ?? '');
  const id = Number(fd.get('id'));
  try {
    const db = getDb();
    if (intent === 'add') { addNamed(db, table, name); return done('Added.'); }
    if (intent === 'rename') { renameNamed(db, table, id, name); return done('Saved.'); }
    if (intent === 'delete') { deleteNamed(db, table, id); return done('Deleted.'); }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function supplierAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const intent = String(fd.get('intent'));
  const id = Number(fd.get('id'));
  const name = String(fd.get('name') ?? '');
  const contact = String(fd.get('contact') ?? '');
  try {
    const db = getDb();
    if (intent === 'add') { addSupplier(db, name, contact); return done('Supplier added.'); }
    if (intent === 'save') { updateSupplier(db, id, name, contact); return done('Supplier saved.'); }
    if (intent === 'delete') { deleteSupplier(db, id); return done('Supplier deleted.'); }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveReorderPointsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  try {
    const n = setReorderPoints(getDb(), parseReorderUpdates(String(fd.get('updates') ?? '[]')));
    return done(`Saved ${n} reorder point(s).`);
  } catch (e) {
    return toActionError(e);
  }
}
```

- [ ] **Step 2: Named list editor (categories and units)**

`app/(app)/settings/named-list-editor.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Named, NamedTable } from '@/lib/catalog';
import { namedListAction } from './actions';

export function NamedListEditor({ table, title, rows }: { table: NamedTable; title: string; rows: Named[] }) {
  const [state, action, pending] = useActionState(namedListAction, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <form key={r.id} action={action} className="flex items-center gap-2">
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={r.id} />
            <Input name="name" defaultValue={r.name} aria-label={`${title}: ${r.name}`} />
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{r.inUse} items</span>
            <Button type="submit" name="intent" value="rename" variant="outline" size="sm" disabled={pending}>Save</Button>
            <Button
              type="submit" name="intent" value="delete" variant="ghost" size="sm"
              disabled={pending || r.inUse > 0}
              title={r.inUse > 0 ? 'In use by items' : undefined}
            >
              Delete
            </Button>
          </form>
        ))}
        <form action={action} className="flex gap-2 pt-2">
          <input type="hidden" name="table" value={table} />
          <Input name="name" placeholder={`New ${table === 'categories' ? 'category' : 'unit'}`} aria-label={`New ${title}`} />
          <Button type="submit" name="intent" value="add" size="sm" disabled={pending}>Add</Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Supplier editor**

`app/(app)/settings/supplier-editor.tsx`:

```tsx
'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Supplier } from '@/lib/catalog';
import { supplierAction } from './actions';

export function SupplierEditor({ rows }: { rows: Supplier[] }) {
  const [state, action, pending] = useActionState(supplierAction, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Suppliers</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((s) => (
          <form key={s.id} action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input type="hidden" name="id" value={s.id} />
            <Input name="name" defaultValue={s.name} aria-label={`Supplier name: ${s.name}`} />
            <Input name="contact" defaultValue={s.contact} aria-label={`Contact for ${s.name}`} />
            <Button type="submit" name="intent" value="save" variant="outline" size="sm" disabled={pending}>Save</Button>
            <Button
              type="submit" name="intent" value="delete" variant="ghost" size="sm" disabled={pending}
              onClick={(e) => { if (!confirm(`Delete ${s.name}? Past movements keep the name.`)) e.preventDefault(); }}
            >
              Delete
            </Button>
          </form>
        ))}
        <form action={action} className="grid gap-2 pt-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input name="name" placeholder="New supplier name" aria-label="New supplier name" />
          <Input name="contact" placeholder="Contact (phone / person)" aria-label="New supplier contact" />
          <Button type="submit" name="intent" value="add" size="sm" disabled={pending}>Add</Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Reorder point bulk edit**

`app/(app)/settings/reorder-editor.tsx`:

```tsx
'use client';

import { useActionState, useEffect, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatQty } from '@/lib/num';
import { saveReorderPointsAction } from './actions';

type Row = { id: number; sku: string; name: string; categoryId: number; unit: string; qty: number; reorderPoint: number };

export function ReorderEditor({ rows, categories }: { rows: Row[]; categories: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(saveReorderPointsAction, null);
  const [category, setCategory] = useState('');
  const initial = () => Object.fromEntries(rows.map((r) => [r.id, String(r.reorderPoint)]));
  const [values, setValues] = useState<Record<number, string>>(initial);
  useEffect(() => setValues(initial()), [rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = rows.filter((r) => !category || String(r.categoryId) === category);
  const changed = rows.filter((r) => values[r.id] !== String(r.reorderPoint)).map((r) => ({ itemId: r.id, sku: r.sku, reorderPoint: values[r.id] }));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Reorder points</CardTitle>
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)} className="w-48" aria-label="Show category">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="updates" value={JSON.stringify(changed)} />
          <div className="max-h-[28rem] overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow><TableHead>SKU</TableHead><TableHead>Item</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="w-32">Reorder point</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.sku}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatQty(r.qty)} {r.unit}</TableCell>
                    <TableCell>
                      <Input
                        aria-label={`Reorder point for ${r.sku}`}
                        inputMode="decimal"
                        value={values[r.id] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <FormMessage state={state} />
          <Button type="submit" disabled={pending || changed.length === 0}>
            {pending ? 'Saving…' : `Save ${changed.length} change(s)`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Settings page**

`app/(app)/settings/page.tsx`:

```tsx
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed, listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { NamedListEditor } from './named-list-editor';
import { ReorderEditor } from './reorder-editor';
import { SupplierEditor } from './supplier-editor';

export default async function SettingsPage() {
  await requireRole('admin');
  const db = getDb();
  const categories = listNamed(db, 'categories');
  const rows = listItems(db, { status: 'active' }).map(({ id, sku, name, categoryId, unit, qty, reorderPoint }) => ({ id, sku, name, categoryId, unit, qty, reorderPoint }));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <NamedListEditor table="categories" title="Categories" rows={categories} />
        <NamedListEditor table="units" title="Units" rows={listNamed(db, 'units')} />
      </div>
      <div className="mb-6"><SupplierEditor rows={listSuppliers(db)} /></div>
      <ReorderEditor rows={rows} categories={categories.map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
```

- [ ] **Step 6: Manual check, then commit**

Add a category, rename it, and delete it. Deleting "Paint" is disabled (8 items). Change three reorder points under the Paint filter and save: "Saved 3 reorder point(s)". Clear one field and save: the error is "PT-00x: enter a reorder point."

```powershell
npm run typecheck
git add -A
git commit -m "feat(settings): categories, units, suppliers and reorder point bulk edit"
git push
```

---

### Task 16: End-to-end acceptance suite, polish, README

**Files:**
- Create: `playwright.config.ts`, `scripts/reset-e2e-db.mjs`, `e2e/helpers.ts`, `e2e/acceptance.spec.ts`, `e2e/roles.spec.ts`, `e2e/reports.spec.ts`
- Create: `app/(app)/loading.tsx`, `app/(app)/error.tsx`, `app/not-found.tsx`, `README.md`
- Modify: `vitest.config.ts` (already limited to `tests/`; confirm `e2e/` isn't picked up)

**Interfaces:**
- Consumes: every label and test id fixed in Tasks 8–15

- [ ] **Step 1: Playwright config and DB reset**

`scripts/reset-e2e-db.mjs`:

```js
import fs from 'node:fs';

for (const f of ['data/e2e.db', 'data/e2e.db-wal', 'data/e2e.db-shm']) fs.rmSync(f, { force: true });
```

`playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export const E2E = { admin: 'admin-e2e-pass', encoder: 'encoder-e2e-pass' };

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure', acceptDownloads: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/reset-e2e-db.mjs && npx next build && npx next start -p 3100',
    url: 'http://localhost:3100/login',
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DB_PATH: 'data/e2e.db',
      ADMIN_PASSWORD: E2E.admin,
      ENCODER_PASSWORD: E2E.encoder,
      SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
    },
  },
});
```

- [ ] **Step 2: Helpers**

`e2e/helpers.ts`:

```ts
import { expect, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';

export async function login(page: Page, who: 'admin' | 'encoder') {
  await page.goto('/login');
  await page.getByLabel('Password').fill(E2E[who]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(who === 'admin' ? /\/dashboard/ : /\/receive/);
}

// Quote-aware CSV line splitter (enough for checking column counts).
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
```

- [ ] **Step 3: Acceptance spec (checklist items 1–4 through the real UI)**

`e2e/acceptance.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const ITEM_LABEL = 'E2E-001 — E2E Test Widget';

test('receive → weighted average, release block, count variance, ledger match', async ({ page }) => {
  await login(page, 'admin');

  await page.goto('/items/new');
  await page.getByLabel('SKU').fill('E2E-001');
  await page.getByLabel('Name').fill('E2E Test Widget');
  await page.getByLabel('Category').selectOption({ label: 'Tools' });
  await page.getByLabel('Unit').selectOption({ label: 'pc' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Widget' })).toBeVisible();
  const itemUrl = page.url();

  for (const [ref, cost] of [['E2E-R1', '50'], ['E2E-R2', '100']]) {
    await page.goto('/receive');
    await page.getByLabel('Supplier').selectOption({ index: 1 });
    await page.getByLabel('Reference no.').fill(ref);
    await page.getByLabel('Line 1 item').selectOption({ label: ITEM_LABEL });
    await page.getByLabel('Line 1 qty').fill('10');
    await page.getByLabel('Line 1 unit cost').fill(cost);
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await expect(page.getByTestId('form-message')).toContainText(`Received 1 line(s) under ${ref}`);
  }
  await page.goto(itemUrl);
  await expect(page.getByTestId('qty-on-hand')).toHaveText('20');
  await expect(page.getByTestId('avg-cost')).toHaveText('₱75.00');

  await page.goto('/release');
  await page.getByLabel('Destination / customer').fill('E2E Customer');
  await page.getByLabel('Reference no.').fill('E2E-D1');
  await page.getByLabel('Line 1 item').selectOption({ label: ITEM_LABEL });
  await page.getByLabel('Line 1 qty').fill('25');
  await page.getByRole('button', { name: 'Post release' }).click();
  await expect(page.getByTestId('form-message')).toHaveText('Cannot release 25 pc of E2E Test Widget (E2E-001) — only 20 on hand.');
  await expect(page.getByLabel('Destination / customer')).toHaveValue('E2E Customer');

  await page.goto('/count');
  await page.getByLabel('Category').selectOption({ label: 'Tools' });
  await page.getByRole('button', { name: 'Start count' }).click();
  await expect(page).toHaveURL(/\/count\/\d+$/);
  await page.getByLabel('Actual for E2E-001').fill('17');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Post count' }).click();
  await expect(page.getByTestId('form-message')).toContainText('Count posted. 1 adjustment(s) created.');

  await page.goto(itemUrl);
  await expect(page.getByTestId('qty-on-hand')).toHaveText('17');
  const adjust = page.getByTestId('movement-row').filter({ hasText: 'adjust' });
  await expect(adjust).toHaveCount(1);
  await expect(adjust).toContainText('−3');
  await expect(adjust).toContainText('count variance');

  await page.goto('/debug');
  await expect(page.getByText('All items match the ledger.')).toBeVisible();
});
```

- [ ] **Step 4: Role spec (checklist item 5)**

`e2e/roles.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('form-message')).toHaveText('Wrong password.');
});

test('signed-out visitors are sent to login', async ({ page }) => {
  await page.goto('/items');
  await expect(page).toHaveURL(/\/login$/);
});

test('encoder cannot see reports or edit items', async ({ page }) => {
  await login(page, 'encoder');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const hidden of ['Dashboard', 'Reports', 'Settings', 'Ledger check']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
  const csv = await page.request.get('/reports/csv/low-stock', { maxRedirects: 0 });
  expect(csv.status()).toBe(307);

  await page.goto('/items');
  await expect(page.getByRole('link', { name: 'New item' })).toHaveCount(0);
  await page.getByRole('link', { name: 'EL-001' }).click();
  await expect(page.getByRole('heading', { name: /THHN Wire 2\.0/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await page.goto('/items/1/edit');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
  await page.goto('/items/new');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
});

test('admin reaches every page', async ({ page }) => {
  await login(page, 'admin');
  for (const p of ['/dashboard', '/items', '/receive', '/release', '/count', '/movements', '/reports', '/settings', '/debug']) {
    await page.goto(p);
    await expect(page).toHaveURL(new RegExp(`${p}$`));
  }
});
```

- [ ] **Step 5: Reports spec (checklist item 6)**

`e2e/reports.spec.ts`:

```ts
import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { login, splitCsvLine } from './helpers';

for (const key of ['stock-value', 'fast-movers', 'dead-stock', 'low-stock']) {
  test(`${key} CSV downloads and parses cleanly`, async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/reports');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`csv-${key}`).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${key}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const text = fs.readFileSync((await download.path())!, 'utf8');
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.endsWith('\r\n')).toBe(true);
    const lines = text.slice(1).replace(/\r\n$/, '').split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    const width = splitCsvLine(lines[0]).length;
    for (const line of lines) expect(splitCsvLine(line)).toHaveLength(width);
  });
}
```

- [ ] **Step 6: Run the e2e suite**

Run: `npm run test:e2e`
Expected: 9 passed (1 acceptance, 4 roles, 4 reports). If a selector misses, fix the component's label rather than loosening the test. These labels are the accessible names a real user's screen reader announces.

- [ ] **Step 7: Polish — loading, error, and not-found states**

`app/(app)/loading.tsx`:

```tsx
export default function Loading() {
  return <p className="animate-pulse text-sm text-muted-foreground">Loading…</p>;
}
```

`app/(app)/error.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';

export default function AppError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Nothing was saved. Try again; if it keeps happening, note what you clicked and tell the admin.</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
```

`app/not-found.tsx`:

```tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 p-4">
      <h1 className="text-xl font-semibold">Not found</h1>
      <Link href="/" className="text-sm underline">Back to the app</Link>
    </main>
  );
}
```

Also show a notice when middleware bounced a user. In `app/(app)/layout.tsx` nothing changes. In `app/(app)/receive/page.tsx` and `app/(app)/dashboard/page.tsx`, accept `searchParams` and, when `denied=1`, render this above the header: `<p role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">That page is for admins only.</p>`. The receive page signature becomes `ReceivePage({ searchParams }: { searchParams: Promise<{ denied?: string }> })`, with `const { denied } = await searchParams;`, and the dashboard follows the same pattern.

Check phone width (375px) on `/receive` and `/items`: the nav scrolls horizontally, tables scroll inside their border, and the line rows stack.

- [ ] **Step 8: README**

`README.md` (replace the scaffold's):

````markdown
# Inventory

Stock you can trust for a hardware/retail shop: receive and release stock, live on-hand quantities with weighted-average cost, low-stock alerts, physical counts, an immutable movement ledger, and CSV reports.

Runs locally on one PC. No Docker, no cloud. Data lives in a single SQLite file.

## Requirements

- Node.js 24 or newer

## First run

```bash
npm install
cp .env.example .env.local
```

Edit `.env.local`: set `ADMIN_PASSWORD`, `ENCODER_PASSWORD` (different from each other), and `SESSION_SECRET` (generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).

```bash
npm run build
npm start
```

Open http://localhost:3000. The database (`data/inventory.db`) is created and filled with 60 days of sample data on first start. To start over, stop the app and delete the `data/` folder.

## Roles

- **Admin** password: everything: dashboard, items, receive, release, count, movements, reports, settings, ledger check.
- **Encoder** password: receive, release, count, and read-only items and movements.

## Rules the app enforces

- On-hand qty is cached on each item and updated in the same transaction as each movement. **Ledger check** (`/debug`) compares it with the sum of movements and can rebuild it.
- Receiving updates the weighted-average cost; releasing never changes it.
- You cannot release more than is on hand.
- Movements are never edited or deleted; corrections are new adjustments (counts post them automatically with the note "count variance").

## Backups

Copy `data/inventory.db` (with the app stopped, or also copy the `-wal` file) to a USB drive or another PC.

## Development

```bash
npm run dev        # dev server
npm test           # domain tests (Vitest)
npm run test:e2e   # end-to-end acceptance (Playwright, builds the app, uses data/e2e.db)
npm run typecheck
```
````

- [ ] **Step 9: Final verification**

Run: `npm test; npm run typecheck; npm run lint; npm run test:e2e`
Expected: everything passes. Then walk the spec's acceptance checklist once by hand in `npm run dev` with a fresh `data/`.

- [ ] **Step 10: Commit**

```powershell
git add -A
git commit -m "test(e2e): acceptance checklist suite; polish loading/error states; README"
git push
```
