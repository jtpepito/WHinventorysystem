# Sales & Accounting — design

Extends the Inventory app (same repo, same stack: Next.js 15 App Router, `node:sqlite`, shadcn/Base UI, Vitest + Playwright) into a system that records sales and purchases, keeps stock in sync, and produces financial reports the owner can rely on.

## Intent

The owner wants numbers they can trust: how much was sold, what it cost, what's owed to them and by them, how much cash there is, and a monthly profit figure — without a bookkeeper re-keying everything. "Reliable" here means:

1. **Every peso is explained.** Each sale, purchase, payment, expense and stock adjustment posts a balanced double-entry journal entry automatically. Reports are read from that ledger, never computed ad hoc.
2. **Nothing is edited after the fact.** Documents and journal entries are immutable; mistakes are fixed with voids/reversals that leave a trail.
3. **Closed months stay closed.** A period lock refuses any posting dated on or before the lock date.
4. **Stock and books agree.** Inventory value in the balance sheet equals Σ qty × avg cost from the inventory module (checked on `/debug`).

## Goals / non-goals / anti-goals

**Goals (v1):** sales (cash, GCash, bank, on-account), customer payments, sales void, purchases on account with supplier payments (the existing Receive flow becomes a purchase), expenses, manual journal entries, chart of accounts, VAT handling (12%, inclusive pricing; or non-VAT), period lock, reports: sales register, sales by item/customer/day, income statement, balance sheet, trial balance, account ledger, AR/AP aging, VAT summary — each exportable to CSV; printable sales receipt; dashboard money tiles.

**Non-goals (v1):** quotations, purchase orders, delivery scheduling, multi-branch, payroll, bank reconciliation, BIR e-filing/CAS accreditation, fixed-asset depreciation, multi-currency, barcode scanning, customer self-service.

**Anti-goals:** a report that can show a different number tomorrow for the same past month; a sale that changes stock without a ledger entry (or vice versa); editing a posted document in place.

## Philippine assumptions (settings, changeable)

- `vat_registered` (default **yes**): 12% VAT, **prices VAT-inclusive** (retail norm). Sales post Output VAT; purchases/expenses with a VAT invoice post Input VAT. Non-VAT: no VAT lines at all.
- Business name, address, TIN, receipt footer text — printed on receipts.
- Currency ₱, 2-decimal money, Asia/Manila dates (existing helpers).

## Roles

- **admin**: everything.
- **encoder** (shop staff/cashier): record sales, customer payments, purchases (existing Receive), counts; see customers, items (read-only), movements, today's sales register. **Cannot** void, record expenses, post manual journals, lock periods, change settings, or see financial reports.

## Data model (additions)

```
settings(key PK, value)                      -- vat_registered, business_*, locked_through, receipt_footer
accounts(id, code UNIQUE, name, type asset|liability|equity|income|expense, system 0|1, active)
journal_entries(id, entry_no UNIQUE, date, source_type, source_id, memo, actor, created_at)
journal_lines(id, entry_id, account_id, debit, credit)         -- Σdebit = Σcredit per entry, enforced
counters(name PK, next)                       -- SI, CR (customer receipt), PV (payment voucher), EXP, JE
customers(id, name UNIQUE NOCASE, contact, terms_days, active)
items + sell_price (default 0)               -- VAT-inclusive selling price
sales(id, number UNIQUE, date, customer_id NULL=walk-in, customer_name snapshot, payment_method cash|gcash|bank|credit,
      subtotal, vat, total, cogs, note, status posted|void, void_reason, voided_at, actor, created_at)
sale_lines(id, sale_id, item_id, qty, unit_price, line_total, unit_cost)   -- unit_cost = avg cost at posting
customer_payments(id, number, date, customer_id, sale_id, amount, method cash|gcash|bank, ref_no, note,
                  status posted|void, actor, created_at)
purchases(id, number, date, supplier_id, supplier_name, ref_no (supplier invoice), payment_method cash|gcash|bank|credit,
          subtotal, vat, total, vat_invoice 0|1, note, status posted|void, actor, created_at)
          -- lines are the existing movements with ref_no = purchase number; purchase_id stored on movements
supplier_payments(id, number, date, supplier_id, purchase_id, amount, method, ref_no, note, status, actor, created_at)
expenses(id, number, date, account_id (expense account), payee, amount, vat_input (0 or 12% portion), vat_invoice 0|1,
         method cash|gcash|bank|credit, supplier_id NULL, ref_no, note, status posted|void, actor, created_at)
movements + purchase_id NULL, sale_id NULL   -- link stock lines to their document
```

Immutability: triggers on `journal_entries`, `journal_lines`, `sales`, `sale_lines`, `purchases`, `customer_payments`, `supplier_payments`, `expenses` block UPDATE/DELETE **except** setting `status='void'` + void fields (one guarded UPDATE path). A void posts a reversing journal entry (`source_type='<type>_void'`) and, for sales, `adjust` movements that return stock at the line's `unit_cost` (avg cost unaffected).

## Chart of accounts (seeded, `system=1` ones can't be deleted)

| Code | Name | Type |
|---|---|---|
| 1010 | Cash on hand | asset |
| 1020 | GCash | asset |
| 1030 | Bank | asset |
| 1100 | Accounts receivable | asset |
| 1200 | Inventory | asset |
| 1300 | Input VAT | asset |
| 2100 | Accounts payable | liability |
| 2200 | Output VAT payable | liability |
| 3100 | Owner's capital | equity |
| 3200 | Owner's drawings | equity |
| 3900 | Retained earnings | equity (closing target, computed, not posted) |
| 4100 | Sales | income |
| 4200 | Sales returns | income (contra) |
| 5100 | Cost of goods sold | expense |
| 5200 | Inventory shrinkage/adjustments | expense |
| 6100 Rent · 6200 Salaries & wages · 6300 Utilities · 6400 Transport & delivery · 6500 Supplies · 6600 Repairs · 6900 Other expenses | expense |

Admins can add/rename/deactivate non-system accounts (expense accounts mostly).

## Postings (VAT-registered; non-VAT drops the VAT lines and uses gross amounts)

- **Sale** total T (inclusive), net N = T/1.12, VAT V = T − N, COGS C = Σ qty × avg cost:
  Dr Cash/GCash/Bank/AR T · Cr Sales N · Cr Output VAT V; Dr COGS C · Cr Inventory C. Stock: `release` movements, counterparty = customer, ref = SI number, unit_cost = avg cost.
- **Sale void**: exact reversal of both entries; `adjust` +qty movements at line unit_cost. Refused if any customer payment is posted against it (void the payment first) or the sale is in a locked period.
- **Customer payment** (on a credit sale): Dr Cash/GCash/Bank · Cr AR. Amount ≤ open balance. Void = reversal.
- **Purchase** (existing Receive, now with a purchase header) total T, with VAT invoice: net N = T/1.12 → Dr Inventory N · Dr Input VAT V · Cr Cash/…/AP T. Without VAT invoice: Dr Inventory T · Cr … T. Inventory unit cost used for weighted average = **net** cost per unit when VAT-registered with a VAT invoice (input VAT is recoverable, not inventory cost); gross otherwise.
- **Supplier payment**: Dr AP · Cr Cash/… .
- **Expense**: Dr Expense account (net) · Dr Input VAT (if VAT invoice) · Cr Cash/…/AP.
- **Count variance** (existing): Dr/Cr Inventory vs 5200 at avg cost × variance.
- **Opening stock** (existing Receive with supplier "Opening balance", CSV import): Dr Inventory · Cr Owner's capital.
- **Manual journal** (admin): any balanced entry; used for capital injection, owner drawings, cash→bank deposits (Dr Bank Cr Cash), etc. Must balance; must not touch Inventory, AR or AP directly (those are controlled by documents) — refused with a message.

Money rounding: half-up to 2 dp per line, then totals; VAT derived once from the total so lines + VAT always sum exactly.

## Period lock

`settings.locked_through = YYYY-MM-DD`. Any posting (document, payment, expense, journal, void, count post, receive) dated ≤ lock date is refused: "Oct 2026 is closed. Ask the admin to reopen it." Admin page **Finance → Periods**: shows months with totals, "Close through <month end>" button; reopen requires a reason, which is written to a `period_log`. Documents are dated by the user (default today) but never earlier than the lock.

## Pages

- `/sales` register (filters: date range, customer, method, status; totals) · `/sales/new` POS-style form: customer (walk-in default) + lines (item search, qty, price prefilled from sell_price, editable by admin; encoder can lower price only with a note? → keep simple: price editable by both, logged on the line) + payment method; blocks qty > on hand (existing rule); shows totals incl. VAT · `/sales/[id]` detail with print view, void (admin), record payment.
- `/customers` list + card (open invoices, payments) · add/edit.
- `/receive` → becomes "Purchase / Receive": adds date, VAT invoice checkbox, payment method; creates purchase header. `/purchases` register + detail (pay, void).
- `/expenses` register + new (date, account, payee, amount, VAT invoice?, method).
- `/finance/journal` general journal list + new manual entry (admin) · `/finance/accounts` chart · `/finance/ledger/[account]` · `/finance/periods`.
- `/reports` gains: Sales by day / by item / by customer, Income statement (range), Balance sheet (as of), Trial balance (as of), AR aging, AP aging, VAT summary (month), Cash book. All with CSV.
- Dashboard: today's sales, this month's sales & gross profit, cash+GCash+bank balances, receivables, payables.
- Settings: business details, VAT registered toggle (changing it is allowed only when no documents exist or with an admin warning — it does not restate history), sell prices bulk edit, chart of accounts.

## What's left to the builder

Exact layouts, keyboard flow of the sales form, CSV column choices, how `/debug` presents the inventory-vs-ledger reconciliation, and test data for the sample seed (extend the existing 60-day seed with sales/expenses so reports look real).
