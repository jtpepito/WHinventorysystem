# Sales & Accounting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sales, purchases, payments, expenses and a double-entry ledger to the Inventory app so it produces financial reports the owner can trust.

**Architecture:** Every business document (sale, purchase, payment, expense, count, manual entry) is posted by a domain function in `lib/` that, inside one SQLite transaction, writes the document, the stock movements it implies, and a balanced journal entry. Reports read only the journal (and stock tables for quantities). Documents and journal rows are immutable (triggers); corrections are voids that post reversing entries. A period lock refuses postings dated in closed months.

**Tech Stack:** unchanged — Next.js 15.5 App Router, React 19, TypeScript, Tailwind v4, shadcn (Base UI), `node:sqlite` on Node 24, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-22-sales-and-accounting-design.md` (read it first; `docs/SPEC.md` is the inventory v1 spec it builds on).

## Global Constraints

- Same conventions as the existing code: domain functions take `db: DatabaseSync` and a `date`/`at`, throw `InventoryError` with a sentence a clerk can act on, run inside `tx()`; server actions call `requireRole(...)`; tests use in-memory DBs from `tests/helpers.ts`.
- Money is 2-decimal, rounded half-up with `round(n, 2)`; VAT 12%, prices VAT-inclusive; `net = round(gross / 1.12, 2)`, `vat = round(gross − net, 2)` (derive VAT from the total once, never per line).
- Document dates are Manila calendar days (`YYYY-MM-DD`); `created_at` stays ISO UTC. Any posting dated ≤ `settings.locked_through` is refused.
- Account codes are fixed strings in `lib/ledger.ts` `ACC` (see Task 2). AR (1100), Inventory (1200), AP (2100) may only be touched by document postings, never by manual entries.
- Encoders: may post sales, customer payments, purchases, counts; may view customers, items, movements, the sales register and their purchases. Everything under `/finance`, `/expenses`, `/reports`, `/settings`, voids and period changes are admin-only (route rule in `canAccess` **and** `requireRole('admin')` in the action).
- Immutable tables get the same `RAISE(ABORT, '… are immutable')` triggers as `movements`; the only permitted UPDATE is the void path, allowed by the trigger `WHEN NEW.status = 'void' AND OLD.status = 'posted'` and only the void columns changing.
- `npm test` (Vitest), `npm run typecheck`, `npx eslint .`, `npm run test:e2e` must be green at every commit. E2E runs on port 3217 against `data/e2e.db` with `SAMPLE_DATA=1`; stop the live app (`scripts\stop-app.ps1`) before building and restart it after (`scripts\restart-app.ps1`).

## Review Focus

1. **Rounding drift across many lines**: a sale of 3 lines at ₱33.33 must have total 99.99, net 89.28, VAT 10.71, and the journal must balance to the centavo — never ₱0.01 off. (Task 1 `vatSplit` + Task 5 sale totals tests.)
2. **Backdating into a closed month**: a sale dated inside a locked period, or a void of a sale that is now in a locked period, must be refused with the month named — even when today is open. (Task 3 lock tests; Task 5 void test.)
3. **Void after payment**: voiding a credit sale that already has a posted payment must be refused, and voiding the payment first must restore the open balance. (Task 6.)
4. **VAT switch on a live book**: turning `vat_registered` off after documents exist must not restate history; the setting applies to new postings only, and the settings page warns. (Task 2 settings test; Task 11 UI copy.)
5. **Stock vs books**: after a cash sale, a purchase with a VAT invoice, a count variance and a void, `/debug` must show Σ qty×avg_cost equal to the Inventory account balance (to the centavo for this sequence). (Task 9 reconciliation test.)

## File map (new or changed)

```
lib/money.ts            roundMoney, vatSplit, VAT_RATE
lib/settings.ts         getSetting/setSetting, typed getters (vatRegistered, lockedThrough, business)
lib/schema.ts           new tables + triggers;  lib/sqlite.ts migrate(): items.sell_price, movements.purchase_id/sale_id
lib/ledger.ts           ACC codes, seedChart, nextNumber, postJournal, reverseJournal, accountBalance, assertNotControlled
lib/periods.ts          assertOpen, closeThrough, reopen, listPeriods
lib/customers.ts        CRUD
lib/sales.ts            postSale, voidSale, getSale, listSales
lib/receivables.ts      postCustomerPayment, voidCustomerPayment, saleOpenBalance, arAging
lib/purchases.ts        postPurchase, voidPurchase, postSupplierPayment, voidSupplierPayment, purchaseOpenBalance, apAging, listPurchases, getPurchase
lib/stock-postings.ts   journalForOpening, journalForCount, postStockRelease (non-sale release)
lib/expenses.ts         postExpense, voidExpense, listExpenses
lib/finance-reports.ts  incomeStatement, balanceSheet, trialBalance, accountLedger, vatSummary, cashBook, salesByDay/Item/Customer
lib/reports.ts          buildReport grows the finance keys (CSV)
lib/seed.ts             chart + settings in both seeds; sample sales/expenses/payments
lib/session.ts          canAccess rules;  components/nav.tsx links
app/(app)/sales/…  customers/…  purchases/…  expenses/…  finance/{journal,accounts,ledger/[code],periods}/…  reports/… (new tabs)  settings/… (business, VAT, chart, sell prices)  debug (reconciliation)  dashboard (money tiles)
e2e/finance.spec.ts     acceptance
```

---

### Task 1: Money helpers, settings, schema and migrations

**Files:**
- Create: `lib/money.ts`, `lib/settings.ts`
- Modify: `lib/schema.ts` (append), `lib/sqlite.ts` `migrate()`
- Test: `tests/money.test.ts`, `tests/settings.test.ts`, `tests/sqlite.test.ts` (add)

**Interfaces:**
- Produces: `VAT_RATE = 0.12`; `roundMoney(n: number): number`; `vatSplit(gross: number, registered: boolean): { net: number; vat: number }`; `checkMoney(n: number, label: string): number` (finite, ≥ 0, ≤ 1e9, ≤ 2 dp, else `InventoryError('<label> must be …')`).
- `getSetting(db, key: string): string | null`, `setSetting(db, key, value: string): void`; typed: `vatRegistered(db): boolean` (default true), `lockedThrough(db): string | null`, `businessInfo(db): { name: string; address: string; tin: string; receiptFooter: string }`.
- Tables per spec: `settings`, `accounts`, `journal_entries`, `journal_lines`, `counters`, `customers`, `sales`, `sale_lines`, `customer_payments`, `purchases`, `supplier_payments`, `expenses`, `period_log(id, action close|reopen, through, reason, actor, created_at)`. Columns: `items.sell_price REAL NOT NULL DEFAULT 0 CHECK(sell_price >= 0)`; `movements.purchase_id INTEGER`, `movements.sale_id INTEGER` (both nullable, added by `migrate()` for existing DBs). `journal_lines` CHECK: `debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND debit + credit > 0`.
- Immutability triggers on `journal_entries`, `journal_lines`, `sale_lines` (no update/delete at all) and on `sales`, `purchases`, `customer_payments`, `supplier_payments`, `expenses` (delete blocked; update blocked unless `OLD.status='posted' AND NEW.status='void'` and `NEW.total/amount, date, number` unchanged).

- [ ] **Step 1: Write failing tests**

`tests/money.test.ts`:
```ts
expect(vatSplit(112, true)).toEqual({ net: 100, vat: 12 });
expect(vatSplit(99.99, true)).toEqual({ net: 89.28, vat: 10.71 });
expect(vatSplit(99.99, false)).toEqual({ net: 99.99, vat: 0 });
expect(roundMoney(1.005)).toBe(1.01);
expect(() => checkMoney(-1, 'Amount')).toThrow('Amount must be 0 or more.');
expect(() => checkMoney(1.005, 'Amount')).toThrow('Amount can have at most 2 decimal places.');
```
`tests/settings.test.ts`: `vatRegistered(db)` is `true` on a fresh DB; after `setSetting(db,'vat_registered','0')` it is `false`; `lockedThrough(db)` null then `'2026-09-30'` after set; `businessInfo(db)` returns empty strings by default.
`tests/sqlite.test.ts` additions: a `sales` row can move `posted → void` but a second update (`void → posted`, or changing `total`) throws `/immutable/`; `journal_lines` reject a line with both debit and credit; the migration test also asserts `items.sell_price` and `movements.sale_id` exist after opening a pre-existing DB.

- [ ] **Step 2: Run** `npx vitest run tests/money.test.ts tests/settings.test.ts tests/sqlite.test.ts` — FAIL (modules/columns missing).
- [ ] **Step 3: Implement** `lib/money.ts`, `lib/settings.ts`, the schema additions and `migrate()` columns.
- [ ] **Step 4: Run** `npm test` — all green (existing 160 + new).
- [ ] **Step 5: Commit** `feat(finance): money helpers, settings, accounting schema`

---

### Task 2: Ledger core — chart of accounts, numbering, journal posting

**Files:**
- Create: `lib/ledger.ts`
- Test: `tests/ledger.test.ts`

**Interfaces:**
- Produces: `ACC = { cash:'1010', gcash:'1020', bank:'1030', ar:'1100', inventory:'1200', inputVat:'1300', ap:'2100', outputVat:'2200', capital:'3100', drawings:'3200', retained:'3900', sales:'4100', returns:'4200', cogs:'5100', shrink:'5200' } as const`; `CONTROLLED = [ACC.ar, ACC.inventory, ACC.ap]`.
- `type PayMethod = 'cash' | 'gcash' | 'bank'`; `cashAccountFor(m: PayMethod): string`.
- `seedChart(db): void` (idempotent; inserts the spec's table with `system=1` for codes < 6000 and the seven 6xxx expense accounts with `system=0`).
- `type AccountRow = { id: number; code: string; name: string; type: AccountType; system: boolean; active: boolean }`; `listAccounts(db, opts?: { type?: AccountType; activeOnly?: boolean }): AccountRow[]`; `addAccount(db, { code, name, type }): number` (code 4 digits, unique; type from the union); `updateAccount(db, id, { name, active }): void` (system accounts: name only); `accountByCode(db, code): AccountRow`.
- `nextNumber(db, prefix: 'SI'|'CR'|'PUR'|'PV'|'EXP'|'JE'): string` → `'SI-000001'`, sequential inside the caller's transaction.
- `type JournalLineInput = { account: string /* code */; debit?: number; credit?: number }`; `postJournal(db, e: { date: string; sourceType: string; sourceId: number | null; memo: string; lines: JournalLineInput[] }, actor: Actor, at?: string): number` — drops zero-amount lines, requires ≥ 2 lines, Σdebit = Σcredit within 0.005 else `InventoryError('Journal entry does not balance: debits ₱X, credits ₱Y.')`, inactive/unknown account → error, period lock via Task 3's `assertOpen` (Task 2 ships with a stub that Task 3 replaces: import `assertOpen` from `./periods` once it exists — in Task 2 create `lib/periods.ts` exporting only `assertOpen = () => {}` to be filled in Task 3).
- `reverseJournal(db, entryId: number, r: { date: string; sourceType: string; sourceId: number | null; memo: string }, actor, at?): number` — same lines with debit/credit swapped.
- `accountBalance(db, code: string, opts?: { through?: string /* date */ }): number` — signed by natural side (assets/expenses: debit − credit; others: credit − debit).
- `assertNotControlled(lines: JournalLineInput[]): void` → `InventoryError('Accounts receivable, Inventory and Accounts payable are posted by sales, purchases and payments; use those screens.')`.

- [ ] **Step 1: Write failing tests** (`tests/ledger.test.ts`, each on `makeDb()` + `seedChart`):
  - `seedChart` inserts 22 accounts; running twice still 22; `accountByCode(db,'1200')` is `{ code:'1200', name:'Inventory', type:'asset', system:true }`.
  - `nextNumber(db,'SI')` → `'SI-000001'`, then `'SI-000002'`; `'CR'` is independent.
  - `postJournal` with Dr 1010 112 / Cr 4100 100 / Cr 2200 12 returns an id; `accountBalance(db,'1010')` = 112, `'4100'` = 100, `'2200'` = 12.
  - unbalanced (Dr 100 / Cr 99.99) throws `'Journal entry does not balance: debits ₱100.00, credits ₱99.99.'`; a single line throws `/at least two/`; unknown code `'9999'` throws `/Account 9999/`; a line `{ account:'1010', debit: 0 }` only → dropped, so `[zero, Dr 1030 5, Cr 1010 5]` posts 2 lines.
  - `reverseJournal` posts an entry whose lines are swapped; balances return to 0; `journal_entries.entry_no` is `JE-000001`, `JE-000002`.
  - `accountBalance(db,'1010',{ through:'2026-10-01' })` excludes an entry dated `'2026-10-02'`.
  - `assertNotControlled([{ account:'1100', debit:1 }])` throws; `[{ account:'2200', credit:1 }]` does not.
  - `addAccount` rejects code `'61'` (`/4 digits/`) and a duplicate code; `updateAccount` on a system account changes name but ignores `active:false` (still active).
- [ ] **Step 2: Run** — FAIL (module missing).
- [ ] **Step 3: Implement** `lib/ledger.ts` and the stub `lib/periods.ts`.
- [ ] **Step 4: Run** `npm test` — green.
- [ ] **Step 5: Commit** `feat(finance): chart of accounts, document numbering, journal posting`

---

### Task 3: Period lock

**Files:**
- Modify: `lib/periods.ts` (replace stub), `lib/inventory.ts` (`postReceipt`, `postRelease`, `postAdjustment` call `assertOpen(db, manilaDay(at))`), `lib/count.ts` (`postCountSession`)
- Test: `tests/periods.test.ts`

**Interfaces:**
- Produces: `assertOpen(db, date: string): void` → `InventoryError('<Mon YYYY> is closed. Ask the admin to reopen it.')` when `date <= lockedThrough`; `closeThrough(db, through: string /* a month-end YYYY-MM-DD */, actor, at?): void` (must be a month end and > current lock); `reopen(db, through: string | null, reason: string, actor, at?): void` (reason required, ≥ 5 chars; writes `period_log`); `listPeriods(db, now: string): { month: 'YYYY-MM'; closed: boolean; sales: number; purchases: number; expenses: number }[]` for every month from the earliest journal entry (or the current month) to now.
- `monthLabel(date: string): string` → `'Oct 2026'`.

- [ ] **Step 1: Write failing tests**: fresh DB → `assertOpen(db,'2026-10-01')` ok; after `closeThrough(db,'2026-09-30','admin')`: `assertOpen(db,'2026-09-30')` throws `'Sep 2026 is closed. Ask the admin to reopen it.'`, `'2026-10-01'` ok; `closeThrough(db,'2026-09-15',…)` throws `/month end/`; `closeThrough(db,'2026-08-31',…)` throws `/already closed through/`; `reopen(db, null, 'x', 'admin')` throws `/reason/`; `reopen(db,'2026-08-31','Found an unposted invoice','admin')` → `lockedThrough` = `'2026-08-31'` and `period_log` has `{ action:'reopen', reason:'Found an unposted invoice' }`; `postReceipt(... at = '2026-09-10T00:00:00.000Z')` throws `/Sep 2026 is closed/` while a receipt `at` Oct 2 posts; `postCountSession` dated inside the lock throws the same.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** `lib/periods.ts`; add the `assertOpen` calls to the three inventory posters and the count poster (before any write).
- [ ] **Step 4: Run** `npm test` — green.
- [ ] **Step 5: Commit** `feat(finance): period lock with close/reopen log`

---

### Task 4: Customers and selling prices

**Files:**
- Create: `lib/customers.ts`
- Modify: `lib/catalog.ts` (`ItemInput` gains `sellPrice: number`; `createItem`/`updateItem` store it; new `setSellPrices(db, updates: { itemId; sellPrice }[]): number`), `lib/queries.ts` (`ItemListRow.sellPrice`), `lib/forms.ts` (`readItemForm` reads `sellPrice`, blank → 0), `lib/import.ts` (optional `Sell price`/`Price`/`SRP` column → `sellPrice`)
- Test: `tests/customers.test.ts`, `tests/catalog.test.ts` (add), `tests/import.test.ts` (add)

**Interfaces:**
- Produces: `type Customer = { id; name; contact; termsDays; active }`; `listCustomers(db, opts?: { q?: string; activeOnly?: boolean }): Customer[]`; `getCustomer(db, id): Customer | null`; `createCustomer(db, { name, contact, termsDays }): number` (name required ≤120, unique NOCASE → `'Customer "X" already exists.'`; termsDays 0..365 default 30); `updateCustomer(db, id, { name, contact, termsDays, active })`.
- `WALK_IN = 'Walk-in'` constant.

- [ ] **Step 1: Write failing tests**: create/duplicate/update/list-with-search for customers; `createItem` with `sellPrice: 120.5` stores `sell_price = 120.5`; `sellPrice: -1` throws `/Sell price/`; `setSellPrices` atomic (second bad row rolls back the first); `readItemForm` blank sell price → 0; import maps a `Price` column and rejects `'abc'` with `'Sell price must be a number.'`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4:** `npm test` green. **Step 5: Commit** `feat: customers; selling prices on items and import`

---

### Task 5: Sales posting and void

**Files:**
- Create: `lib/sales.ts`
- Modify: `lib/inventory.ts` (`postRelease` accepts `saleId?: number` in `ReleaseInput` and stores it on the movements; `postAdjustment` accepts optional `unitCost` override and `saleId`)
- Test: `tests/sales.test.ts`

**Interfaces:**
- Produces: `type SaleMethod = PayMethod | 'credit'`; `type SaleLineInput = { itemId: number; qty: number; unitPrice: number; label?: string }`; `type SaleInput = { date: string; customerId: number | null; method: SaleMethod; note?: string; lines: SaleLineInput[] }`.
- `postSale(db, input: SaleInput, actor, at?): { id: number; number: string; total: number }` — rules: `assertOpen`; ≥1 line; qty via `checkQty`, price via `checkMoney`; `credit` requires a customer (`'On-account sales need a customer.'`); customer must be active; line_total = `roundMoney(qty × unitPrice)`; total = Σ line totals; `{net, vat} = vatSplit(total, vatRegistered)`; stock via `postRelease({ counterparty: customer name or 'Walk-in', refNo: number, saleId })` (its over-release block applies); `unit_cost` per line = the item's avg cost at posting; `cogs = roundMoney(Σ qty × unit_cost)`; journal: `Dr cashAccountFor(method)|AR total; Cr 4100 net; Cr 2200 vat; Dr 5100 cogs; Cr 1200 cogs` with `sourceType:'sale'`, memo `'<number> <customer>'`.
- `voidSale(db, id, reason: string, actor, at?): void` — refuses if not posted, if any `customer_payments` posted against it (`'Void the payment(s) first.'`), if `assertOpen(sale.date)` fails or `assertOpen(today)` fails; posts `adjust` +qty movements per line with `unitCost = line.unit_cost`, `refNo = number`, note `'Void <number>'`; `reverseJournal` with `sourceType:'sale_void'`; sets status/void fields.
- `getSale(db, id): SaleView | null` (header + lines with sku/name/unit + payments summary `paid`, `balance`); `listSales(db, f: { from?; to?; customerId?; method?; status?; limit? }): SaleRow[]` newest first; `salesTotals(db, f): { count; total; cogs; vat }`.

- [ ] **Step 1: Write failing tests** (fixture: `seedChart`, two items received at known costs, a customer):
  - **ACCEPTANCE cash sale**: 2 × ₱56 of T-001 (avg 50) → `{ number:'SI-000001', total:112 }`; qty 20→18; journal lines `[1010 Dr 112],[4100 Cr 100],[2200 Cr 12],[5100 Dr 100],[1200 Cr 100]`; `accountBalance('1200')` dropped by 100.
  - **Rounding**: 3 lines × 1 @ 33.33 → total 99.99, net 89.28, vat 10.71, journal balanced (`SUM(debit) = SUM(credit)`).
  - non-VAT setting: same sale → Cr 4100 99.99, no 2200 line.
  - credit sale with walk-in → throws; with customer → Dr 1100 112, `saleOpenBalance`-style check via `getSale().balance === 112`.
  - over-release → existing readable block, nothing written (`sales` count 0, journal count unchanged).
  - **void**: after the cash sale, `voidSale` → qty back to 20, a `JE` with swapped lines, `getSale().status === 'void'`, movements has an `adjust +2` with `unit_cost 50`; voiding again throws `/already void/`.
  - void refused when `closeThrough` covers the sale date: `/Oct 2026 is closed/`.
  - `listSales` filters by date range and method; `salesTotals` sums only `posted`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `lib/sales.ts` and the `inventory.ts` additions. **Step 4:** `npm test` green. **Step 5: Commit** `feat(sales): post and void sales with stock and journal entries`

---

### Task 6: Customer payments and AR aging

**Files:**
- Create: `lib/receivables.ts`
- Test: `tests/receivables.test.ts`

**Interfaces:**
- Produces: `saleOpenBalance(db, saleId): number` (total − Σ posted payments; 0 for non-credit or void sales); `postCustomerPayment(db, { date; saleId; amount; method: PayMethod; refNo?; note? }, actor, at?): { id; number /* CR-000001 */ }` — sale must be posted & credit; `0 < amount ≤ open balance` (`'Only ₱X is still owed on SI-000003.'`); journal `Dr cash account amount; Cr 1100 amount`, `sourceType:'customer_payment'`.
- `voidCustomerPayment(db, id, reason, actor, at?)`; `listCustomerPayments(db, { customerId?; saleId?; from?; to? })`.
- `arAging(db, asOf: string): { rows: { customerId; customer; current; d31_60; d61_90; d90plus; total }[]; total: number }` — bucket by days between `sale.date` and `asOf`, open balance only.
- `customerStatement(db, customerId, asOf): { sales: SaleRow[]; payments; balance }`.

- [ ] **Step 1: Write failing tests**: credit sale 112 → open 112; payment 50 cash → open 62, journal Dr 1010 50 / Cr 1100 50; payment 70 → throws `'Only ₱62.00 is still owed on SI-000001.'`; `voidSale` now throws `'Void the payment(s) first.'`; `voidCustomerPayment` → open 112 again, reversal entry; then `voidSale` succeeds; aging: sales dated 10, 45, 75, 100 days before `asOf` land in the four buckets; a sale in a locked period can still receive a payment dated today (lock checks the payment date, not the sale date).
- [ ] **Steps 2–5** as usual. Commit `feat(sales): customer payments and receivables aging`

---

### Task 7: Purchases, supplier payments, inventory postings

**Files:**
- Create: `lib/purchases.ts`, `lib/stock-postings.ts`
- Modify: `lib/inventory.ts` (`ReceiptInput` gains `purchaseId?: number`, stored on movements), `lib/count.ts` (`postCountSession` posts the shrinkage journal), `lib/import.ts` + `lib/seed.ts` (opening stock calls `journalForOpening`)
- Test: `tests/purchases.test.ts`, `tests/stock-postings.test.ts`, `tests/count.test.ts` (add), `tests/import.test.ts` (add)

**Interfaces:**
- `type PurchaseInput = { date; supplierId; refNo; method: PayMethod | 'credit'; vatInvoice: boolean; note?; lines: ReceiptLine[] /* unitCost as printed on the invoice (gross) */ }`.
- `postPurchase(db, input, actor, at?): { id; number /* PUR-000001 */; total }` — `assertOpen`; totals: gross total = Σ `roundMoney(qty × unitCost)`; if `vatRegistered && vatInvoice`: `{net, vat} = vatSplit(total)`, inventory unit cost = `round(unitCost / 1.12, 4)`; else net = total, vat = 0, unit cost as given; stock via `postReceipt({ supplierId, refNo: number, purchaseId, lines with the net unit cost })`; journal `Dr 1200 net; Dr 1300 vat; Cr cash|AP total`, `sourceType:'purchase'`, memo `'<number> <supplier> inv <refNo>'`.
- `voidPurchase(db, id, reason, actor, at?)` — refused if any supplier payment posted, if stock already moved below what was received (`'T-001 has only 3 on hand; 10 were received on this purchase. Adjust stock first.'`), or period locked; posts `adjust −qty` movements at the received unit cost and reverses the journal.
- `purchaseOpenBalance`, `postSupplierPayment(db, { date; purchaseId; amount; method: PayMethod; refNo?; note? }, actor, at?)` (`PV-000001`, `Dr 2100 / Cr cash`), `voidSupplierPayment`, `apAging(db, asOf)` (same shape as AR by supplier), `listPurchases(db, f)`, `getPurchase(db, id)` (header, lines from movements, paid/balance).
- `lib/stock-postings.ts`: `journalForOpening(db, { date; amount; refNo }, actor, at?)` → `Dr 1200 / Cr 3100`, `sourceType:'opening'`; `journalForCount(db, { date; sessionId; delta /* signed ₱ */ }, actor, at?)` → delta > 0: `Dr 1200 / Cr 5200`, delta < 0: `Dr 5200 / Cr 1200`, skip when 0; `postStockRelease(db, input: ReleaseInput & { date: string }, actor, at?)` → `postRelease` + `Dr 5200 / Cr 1200` at Σ qty × avg cost, `sourceType:'release'` (used by the existing `/release` page, now labelled "not a sale").

- [ ] **Step 1: Write failing tests**:
  - purchase 10 × ₱112 gross with VAT invoice, cash → item avg cost **100**, qty +10; journal `Dr 1200 1000; Dr 1300 120; Cr 1010 1120`.
  - same without VAT invoice → avg cost 112; `Dr 1200 1120 / Cr 1010 1120`.
  - non-VAT setting ignores `vatInvoice:true` (no 1300 line).
  - credit purchase → `Cr 2100`; `purchaseOpenBalance` 1120; payment 1120 bank → balance 0, `Dr 2100 / Cr 1030`; overpay throws `/still owed/`.
  - `voidPurchase` after releasing 8 of the 10 → throws the readable "only 2 on hand" error; after a fresh purchase with nothing released → qty back, avg cost recomputed by the ledger rebuild? (avg cost stays — document in the test that avg is unchanged and the GL reversal restores 1200 exactly).
  - `postCountSession` with variance −3 on an item at avg 50 → a journal `Dr 5200 150 / Cr 1200 150` with `sourceType:'count'`; variance +2 → `Dr 1200 100 / Cr 5200 100`; zero net variance across lines → no entry.
  - `commitImport` with opening stock worth ₱3,180 → `journalForOpening` posted `Dr 1200 3180 / Cr 3100 3180`.
  - `postStockRelease` of 2 @ avg 50 → `Dr 5200 100 / Cr 1200 100`.
- [ ] **Steps 2–5**. Commit `feat(purchases): purchases with VAT, supplier payments, AP aging; stock postings to the ledger`

---

### Task 8: Expenses and manual journal entries

**Files:**
- Create: `lib/expenses.ts`
- Modify: `lib/ledger.ts` (`postManualJournal`)
- Test: `tests/expenses.test.ts`, `tests/ledger.test.ts` (add)

**Interfaces:**
- `postExpense(db, { date; accountCode /* 6xxx or any active expense account */; payee; amount /* gross */; vatInvoice: boolean; method: PayMethod; refNo?; note? }, actor, at?): { id; number /* EXP-000001 */ }` — account must be type `expense` and not 5100/5200 (`'Pick an expense account.'`); `{net, vat}` as purchases; journal `Dr account net; Dr 1300 vat; Cr cash account gross`, `sourceType:'expense'`.
- `voidExpense(db, id, reason, actor, at?)`; `listExpenses(db, { from?; to?; accountCode?; status? })`; `expenseTotalsByAccount(db, from, to)`.
- `postManualJournal(db, { date; memo; lines: JournalLineInput[] }, actor, at?): number` — `assertNotControlled` then `postJournal` with `sourceType:'manual'`.

- [ ] **Step 1: Write failing tests**: rent 11,200 with VAT invoice by bank → `Dr 6100 10000; Dr 1300 1200; Cr 1030 11200`; salaries 5,000 no VAT cash → `Dr 6200 5000 / Cr 1010 5000`; `accountCode:'5100'` throws `'Pick an expense account.'`; `voidExpense` reverses; `postManualJournal` owner capital `Dr 1010 50000 / Cr 3100 50000` posts; a manual line on `1200` throws the controlled-accounts message; unbalanced manual throws.
- [ ] **Steps 2–5**. Commit `feat(finance): expenses and manual journal entries`


### Task 9: Financial reports, CSV keys, debug reconciliation

**Files:**
- Create: `lib/finance-reports.ts`
- Modify: `lib/reports.ts` (`ReportKey` union + `buildReport(db, key, now, params?: ReportParams)`), `lib/inventory.ts` (`ledgerCheck` unchanged) + new `financeCheck(db): { stockValue: number; inventoryGl: number; match: boolean; unbalancedEntries: number[] }` in `lib/finance-reports.ts`
- Test: `tests/finance-reports.test.ts`, `tests/reports.test.ts` (add)

**Interfaces:**
- `type Range = { from: string; to: string }` (inclusive Manila days).
- `incomeStatement(db, r: Range): { sales; returns; netSales; cogs; grossProfit; expenses: { code; name; amount }[]; totalExpenses; netIncome }`.
- `balanceSheet(db, asOf: string): { assets: Line[]; liabilities: Line[]; equity: Line[] /* includes { code:'3900', name:'Retained earnings', amount } = all income − all expense through asOf */; totalAssets; totalLiabilities; totalEquity; balanced: boolean }` where `Line = { code; name; amount }`, zero balances omitted.
- `trialBalance(db, asOf): { rows: { code; name; debit; credit }[]; totalDebit; totalCredit }`.
- `accountLedger(db, code, r: Range): { opening: number; rows: { date; entryNo; memo; debit; credit; balance }[]; closing: number }`.
- `cashBook(db, r)`: the three cash accounts' ledgers merged, with an `account` column.
- `vatSummary(db, month: 'YYYY-MM'): { outputVat; inputVat; netPayable /* max(0, …) */; carryOver }` from 2200/1300 movements in the month.
- `salesByDay(db, r)`, `salesByItem(db, r)`, `salesByCustomer(db, r)`: rows with `{ key, count, qty?, total, cogs, grossProfit }`, posted sales only.
- `financeCheck(db)` as above: `stockValue = Σ qty × avg_cost` (active and inactive), `inventoryGl = accountBalance('1200')`, `match` within ₱0.05 × number of items (rounding), plus every journal entry whose debits ≠ credits (should always be `[]`).
- `buildReport` keys added: `'sales-by-day' | 'sales-by-item' | 'sales-by-customer' | 'income-statement' | 'balance-sheet' | 'trial-balance' | 'ar-aging' | 'ap-aging' | 'vat-summary' | 'cash-book' | 'journal'`; `ReportParams = { from?; to?; asOf?; month? }` with defaults (this month / today); `isReportKey` covers them; `REPORT_KEYS` keeps the four stock ones first.

- [ ] **Step 1: Write failing tests** on one scenario fixture (`tests/finance-fixture.ts`: capital 50,000; purchase 10 × 112 VAT cash; cash sale 2 × 168; credit sale 1 × 168 + payment 100; rent 11,200 VAT bank; count −1):
  - `incomeStatement` for the month: sales 300, cogs 300 (3 × 100), gross 0? — choose prices so the numbers are distinct: sell 168 gross → net 150 each; 3 sold → sales 450, cogs 300, gross profit 150; expenses 10,000; netIncome −9,850.
  - `balanceSheet(asOf)`: `balanced === true`; equity includes retained earnings −9,850; assets include Inventory = (10 − 3 − 1) × 100 = 600.
  - `trialBalance` totals equal.
  - `accountLedger('1010')` running balance ends at `accountBalance('1010')`.
  - `vatSummary('2026-10')`: outputVat 54 (3 × 18), inputVat 1,320 (120 + 1,200), netPayable 0, carryOver 1,266.
  - `salesByItem` row for T-001 `{ qty: 3, total: 504, cogs: 300, grossProfit: 150 }` (gross profit on net sales).
  - `financeCheck().match === true` and `unbalancedEntries` empty for the fixture; after `UPDATE items SET qty = 999` it reports `match:false`.
  - `buildReport(db,'income-statement', now, { from, to })` returns headers `['Line', 'Amount (PHP)']` and a `'Net income'` row; every new key returns a table with ≥ 1 header; `isReportKey('journal')` true.
- [ ] **Steps 2–5**. Commit `feat(finance): income statement, balance sheet, trial balance, ledgers, aging, VAT summary; CSV; reconciliation`

---

### Task 10: Seed data and starter setup

**Files:**
- Modify: `lib/seed.ts` (`seedStarter` and `seed` both call `seedChart` + default settings; sample seed adds: sell prices = `round(cost × 1.35, 2)`, opening capital ₱200,000 (manual JE), the opening receipt posted via `postPurchase` as a credit purchase paid 10 days later, weekly restocks as VAT purchases, the daily releases replaced by `postSale` (70% cash, 15% GCash, 15% credit to 4 seeded customers, with payments on ~half), monthly rent/utilities/salaries expenses, the posted count), `lib/db.ts` unchanged
- Test: `tests/seed.test.ts` (add)

- [ ] **Step 1: Write failing tests**: sample seed → ≥ 100 posted sales, ≥ 6 expenses, `financeCheck().match` true, `balanceSheet(NOW).balanced` true, `ledgerCheck` all match, every `journal_entries` balanced, `incomeStatement` for the last full month has `netSales > 0`; starter seed → 22 accounts, `vatRegistered` true, zero journal entries; both deterministic (same balance sheet twice).
- [ ] **Steps 2–5**. Commit `feat(seed): sample sales, purchases, expenses and customers; chart of accounts in both seeds`

---

### Task 11: Access rules, navigation, settings pages

**Files:**
- Modify: `lib/session.ts` (`canAccess`), `components/nav.tsx`, `app/(app)/settings/page.tsx` + new `settings/business-form.tsx`, `settings/accounts-editor.tsx`, `settings/sell-price-editor.tsx`, `settings/actions.ts`
- Test: `tests/session.test.ts` (add), `e2e/finance-access.spec.ts`

**Interfaces:**
- `canAccess('encoder', p)` true for `/sales`, `/sales/new`, `/sales/12`, `/customers`, `/customers/new`, `/customers/3`, `/purchases`, `/purchases/4`; false for `/expenses`, `/finance`, `/finance/journal`, `/reports`, `/settings`, `/sales/12/void` (and the void action checks admin anyway).
- Nav links (in order): Dashboard, Sales, Customers, Items, Receive, Purchases, Release, Count, Movements, Expenses, Finance, Reports, Settings, Ledger check — filtered by `canAccess`.
- Settings page sections: **Business** (name, address, TIN, receipt footer), **VAT** (registered toggle; when any journal entry exists the toggle shows the warning copy from the spec and requires typing `CHANGE` to submit), **Chart of accounts** (list; add expense account; rename; deactivate non-system), **Selling prices** (bulk editor like reorder points), plus the existing sections.
- Actions: `saveBusinessAction`, `saveVatAction`, `accountAction` (add|rename|toggle), `saveSellPricesAction` — all `requireRole('admin')`.

- [ ] **Step 1:** unit test for `canAccess` (RED), e2e: encoder nav shows Sales/Customers/Purchases and not Expenses/Finance/Reports/Settings; `/expenses` → `/receive?denied=1`.
- [ ] **Steps 2–5** (typecheck, lint, e2e). Commit `feat(ui): finance navigation, access rules, business/VAT/accounts/prices settings`

---

### Task 12: Sales, customers UI (POS form, register, detail, print, void, payment)

**Files:**
- Create: `app/(app)/sales/page.tsx` (register + totals + filters, CSV link to `sales-by-day`), `sales/new/page.tsx` + `sale-form.tsx` + `actions.ts`, `sales/[id]/page.tsx` (detail: lines, totals, journal entry link, payments, buttons), `sales/[id]/print/page.tsx` (receipt layout, `@media print`, business info, "VAT-inclusive" footer when registered), `sales/[id]/payment-form.tsx`, `customers/page.tsx`, `customers/new/page.tsx`, `customers/[id]/page.tsx` (statement), `customers/[id]/edit/page.tsx`, `customers/customer-form.tsx`, `customers/actions.ts`
- Test: `e2e/sales.spec.ts`

**Interfaces (UI contract the e2e relies on):**
- Sale form labels: `Customer` (select, default Walk-in), `Date`, `Payment method`, `Line N item`, `Line N qty`, `Line N price` (prefilled from sell price on item pick), `Note`; live totals `Subtotal`/`VAT`/`Total` with `data-testid="sale-total"`; buttons `Post sale`, `Add line`; on success redirect to `/sales/[id]?posted=1` whose banner (`form-message`) reads `Sale SI-000001 posted.`; detail buttons `Print receipt`, `Record payment` (credit, balance > 0), `Void sale` (admin; `confirm()` + reason prompt via a small form with `Reason` label and `Confirm void`).
- Payment form labels: `Amount`, `Method`, `Reference`, button `Record payment`; success banner `Payment CR-000001 recorded.`
- Register columns: Number, Date, Customer, Method, Total, Balance, Status; totals row.

- [ ] **Step 1: Write the e2e** (`e2e/sales.spec.ts`): admin posts a cash sale of 2 × EL-001 at its sell price → banner, total equals `2 × price` formatted, item on-hand down by 2, `/finance/journal` shows an entry `SI-…`; encoder posts a credit sale to a seeded customer, records a partial payment, sees the balance drop; admin voids a cash sale (reason typed) → status Void, stock restored; `/sales/[id]/print` contains the business name and `VAT-inclusive`.
- [ ] **Steps 2–5**. Commit `feat(ui): sales form, register, receipt, void and payments; customers`

---

### Task 13: Purchases, expenses, finance UI

**Files:**
- Modify: `app/(app)/receive/page.tsx` + `receive-form.tsx` + `actions.ts` (title "Purchase / Receive"; fields `Date`, `Supplier invoice no.`, `VAT invoice` checkbox (hidden when non-VAT), `Payment method` incl. `On account`; posts via `postPurchase`; keeps the duplicate-ref warning; success → `/purchases/[id]?posted=1`), `app/(app)/release/*` (uses `postStockRelease`; description "Release stock that is not a sale (internal use, samples, write-off)")
- Create: `purchases/page.tsx`, `purchases/[id]/page.tsx` (+ supplier payment form, void), `purchases/actions.ts`; `expenses/page.tsx`, `expenses/new/page.tsx` + `expense-form.tsx` + `actions.ts`; `finance/page.tsx` (links + cash balances), `finance/journal/page.tsx` (list, filters, link to source doc), `finance/journal/new/page.tsx` + `journal-form.tsx` (lines with account select, running Dr/Cr totals, submit disabled until balanced), `finance/accounts/page.tsx` (balances as of today, links to ledger), `finance/ledger/[code]/page.tsx` (range filter), `finance/periods/page.tsx` + `actions.ts` (close through month, reopen with reason)
- Test: `e2e/purchases-finance.spec.ts`

- [ ] **Step 1: Write the e2e**: encoder receives 5 × PL-001 "On account" with VAT invoice → `/purchases/PUR-…` shows balance; admin pays it (bank) → balance 0; admin records a rent expense → appears in `/finance/ledger/6100`; manual journal `Dr Bank / Cr Cash on hand 5,000` posts, and one touching Inventory is refused with the controlled-accounts message; close through last month → posting a sale dated in it is refused with `… is closed`; reopen with a reason → allowed again and `/finance/periods` shows the log line.
- [ ] **Steps 2–5**. Commit `feat(ui): purchases, expenses, journal, ledgers, periods`

---

### Task 14: Reports UI, dashboard, debug, README, acceptance suite

**Files:**
- Modify: `app/(app)/reports/page.tsx` (tabs: Stock | Sales | Financial; date-range / as-of / month controls via search params; each table with its CSV link `data-testid="csv-<key>"`), `reports/csv/[report]/route.ts` (passes params), `dashboard/page.tsx` (tiles: Today's sales, This month's sales / gross profit, Cash + GCash + Bank, Receivables, Payables; existing stock tiles move to a second row), `debug/page.tsx` (adds the `financeCheck` panel: stock value vs Inventory account, unbalanced entries), `README.md` (new sections: Sales, Purchases & payments, Expenses, Month-end close, Reports, "How the books work")
- Test: `e2e/finance.spec.ts` (acceptance), `e2e/reports.spec.ts` (add the new CSV keys to the download loop with params)

- [ ] **Step 1: Write the acceptance e2e** mirroring Review Focus 1–5: rounding sale (3 × 33.33) balanced; backdated sale into a closed month refused; void-after-payment refused then allowed after voiding the payment; `/debug` shows "Stock value matches the Inventory account"; all finance CSVs download with a BOM and consistent column counts.
- [ ] **Steps 2–5**: `npm test`, typecheck, lint, `npm run test:e2e` ×2 green; `scripts\restart-app.ps1`. Commit `feat(ui): financial reports, money dashboard, reconciliation; README`
