# SPEC.md — Inventory System for a trading/retail SME
Stock you can trust: items in, items out, live quantities, low-stock alarms,
and a physical-count workflow. Built for a Philippine hardware/retail trader.

## Stack (do not deviate)
- Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- node:sqlite singleton lib/db.ts, seeded on first boot. No Docker, no cloud.
- Auth: shared password (env `ADMIN_PASSWORD`), HMAC cookie.
- ₱ currency, Asia/Manila dates.

## Roles
Admin (everything) and Encoder (receive/release/count only — no item editing, no reports). Role picked at login via two passwords (`ADMIN_PASSWORD`, `ENCODER_PASSWORD`).

## Pages
1. /login
2. /dashboard — total SKUs, stock value (qty × cost), low-stock count, today's movements, 7-day in/out chart.
3. /items — searchable/filterable table: SKU, name, category, unit, qty on hand, reorder point, avg cost, status. Row → item card with movement history.
4. /receive — receive stock: supplier, reference no, line items (item, qty, unit cost). Posting updates qty and recomputes weighted-average cost.
5. /release — release stock: destination/customer, reference, line items (item, qty). Blocks release beyond available qty. Posting decrements.
6. /count — physical count session: pick a category (or all), system shows expected qty, encoder types actual, variance computed; posting creates adjustment movements with reason "count variance".
7. /movements — unified ledger, filter by item/type/date; every row: when, type (receive/release/adjust), item, qty ±, ref, who.
8. /reports — stock value by category, fast movers (30d), dead stock (no movement 60d), low stock list. Each exportable CSV.
9. /settings — categories, units, suppliers, reorder points bulk-edit.

## Data model
items (id, sku unique, name, category_id, unit_id, qty numeric default 0, avg_cost numeric default 0, reorder_point numeric default 0, active)
categories(id,name) · units(id,name) · suppliers(id,name,contact)
movements (id, item_id, type enum[receive,release,adjust], qty_delta numeric, unit_cost numeric nullable, ref_no, counterparty, note, actor enum[admin,encoder], created_at)
count_sessions (id, scope, started_at, posted_at nullable)
count_lines (id, session_id, item_id, expected, actual, variance)

## Core rules
- qty on hand is DERIVED-THEN-CACHED: every movement post updates items.qty inside the same transaction; a /debug recompute button rebuilds from the ledger (they must always match).
- Weighted average cost on receive: new_avg = (old_qty*old_avg + rcv_qty*rcv_cost) / (old_qty+rcv_qty). Releases never change avg cost.
- Release > available is a hard block with a clear error.
- Low stock = qty <= reorder_point AND active. Dashboard + items table badge it red.
- Every movement is immutable; corrections are new adjustments, never edits.

## Seed data
40 items across 5 categories (Electrical, Plumbing, Tools, Paint, Fasteners), 3 suppliers, 60 days of movements incl. receives, releases, one posted count with variances, 6 items low on stock.

## Build order
1. db + schema + seed → 2. auth + roles → 3. items table + item card → 4. receive flow → 5. release flow (with block) → 6. movements ledger → 7. count workflow → 8. dashboard + reports → 9. polish.

## Acceptance checklist
- [ ] Receive 10 @ ₱50 then 10 @ ₱100 → avg cost ₱75, qty 20
- [ ] Releasing 25 of a 20-qty item is blocked with a readable error
- [ ] Posting a count variance of −3 shows an adjust movement of −3
- [ ] Recompute-from-ledger matches cached qty for every item after all of the above
- [ ] Encoder login cannot see /reports or edit items
- [ ] All 4 report CSVs download and open clean

## Non-goals (v1)
Barcode scanning, multi-warehouse, purchase orders, sales/POS, customer accounts.
