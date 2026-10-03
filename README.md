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

Open http://localhost:3000. The database (`data/inventory.db`) is created on first start and filled with 60 days of sample data to try things out.

**Going live:** add `SAMPLE_DATA=0` to `.env.local`, stop the app, and delete (or move) the `data/` folder. On the next start the database begins empty except for the five categories and common units; add suppliers and items under Settings and Items. To start over at any time, stop the app and delete `data/` again.

Other PCs on the shop network can use `http://<this-pc's-ip>:3000`. Login cookies work over plain HTTP; set `COOKIE_SECURE=1` only if you put the app behind HTTPS.

## Roles

- **Admin** password: everything — dashboard, items, receive, release, count, movements, reports, settings, ledger check.
- **Encoder** password: receive, release, count, and read-only items and movements.

## Rules the app enforces

- On-hand qty is cached on each item and updated in the same transaction as each movement. **Ledger check** (`/debug`) compares it with the sum of movements and can rebuild it.
- Receiving updates the weighted-average cost; releasing never changes it.
- You cannot release more than is on hand, even split across several lines.
- A count can't be posted if stock moved after it started; use **Refresh expected** and re-check those items.
- Movements are never edited or deleted; corrections are new adjustments (counts post them automatically with the note "count variance").
- Low stock = active item with qty at or below its reorder point. New items start at qty 0 with reorder point 0, so they show as low until you set one.

## Backups

Copy `data/inventory.db` (with the app stopped, or also copy the `-wal` file) to a USB drive or another PC.

## Development

```bash
npm run dev        # dev server
npm test           # domain tests (Vitest)
npm run test:e2e   # end-to-end acceptance (Playwright; builds the app and uses data/e2e.db)
npm run typecheck
npm run lint
```
