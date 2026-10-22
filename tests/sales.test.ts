import { describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/customers';
import { postReceipt } from '@/lib/inventory';
import { accountBalance, seedChart } from '@/lib/ledger';
import { closeThrough } from '@/lib/periods';
import { getSale, listSales, postSale, salesTotals, voidSale } from '@/lib/sales';
import { setSetting } from '@/lib/settings';
import { type Fixture, makeDb, plain, qtyOf } from './helpers';

const D = '2026-10-02';
const AT = '2026-10-02T04:00:00.000Z';

function fixture() {
  const f = makeDb();
  seedChart(f.db);
  // T-001 (Hammer): 20 on hand at avg 50. T-002 (Saw): 5 at avg 10.
  postReceipt(f.db, { supplierId: f.supplier, refNo: 'OB', lines: [{ itemId: f.item, qty: 20, unitCost: 50 }, { itemId: f.item2, qty: 5, unitCost: 10 }] }, 'admin', '2026-09-01T00:00:00.000Z');
  const customer = createCustomer(f.db, { name: 'JDC Construction' });
  return { ...f, customer };
}

function journalLines(f: Fixture, entryId: number) {
  return plain(f.db.prepare('SELECT a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = ? ORDER BY l.id').all(entryId));
}
const lastEntryId = (f: Fixture) => (f.db.prepare('SELECT MAX(id) AS id FROM journal_entries').get() as { id: number }).id;
const journalCount = (f: Fixture) => (f.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n;

describe('postSale', () => {
  it('ACCEPTANCE: cash sale moves stock and posts sales, VAT, COGS', () => {
    const f = fixture();
    const inv0 = accountBalance(f.db, '1200');
    const r = postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 2, unitPrice: 56 }] }, 'encoder', AT);
    expect(r).toEqual({ id: 1, number: 'SI-000001', total: 112 });
    expect(qtyOf(f.db, f.item)).toBe(18);
    expect(journalLines(f, lastEntryId(f))).toEqual([
      { code: '1010', debit: 112, credit: 0 }, { code: '4100', debit: 0, credit: 100 }, { code: '2200', debit: 0, credit: 12 },
      { code: '5100', debit: 100, credit: 0 }, { code: '1200', debit: 0, credit: 100 },
    ]);
    expect(accountBalance(f.db, '1200')).toBe(inv0 - 100);
    const move = plain(f.db.prepare("SELECT type, qty_delta, unit_cost, ref_no, counterparty, sale_id FROM movements WHERE type = 'release'").all());
    expect(move).toEqual([{ type: 'release', qty_delta: -2, unit_cost: 50, ref_no: 'SI-000001', counterparty: 'Walk-in', sale_id: 1 }]);
    expect(getSale(f.db, 1)).toMatchObject({
      number: 'SI-000001', date: D, customerName: 'Walk-in', method: 'cash', subtotal: 100, vat: 12, total: 112, cogs: 100, status: 'posted', paid: 112, balance: 0,
      lines: [{ sku: 'T-001', name: 'Hammer', unit: 'pc', qty: 2, unitPrice: 56, lineTotal: 112, unitCost: 50 }],
    });
  });
  it('keeps rounding exact across lines', () => {
    const f = fixture();
    const r = postSale(f.db, { date: D, customerId: null, method: 'gcash', lines: [
      { itemId: f.item, qty: 1, unitPrice: 33.33 }, { itemId: f.item, qty: 1, unitPrice: 33.33 }, { itemId: f.item2, qty: 1, unitPrice: 33.33 },
    ] }, 'admin', AT);
    expect(r.total).toBe(99.99);
    expect(getSale(f.db, r.id)).toMatchObject({ subtotal: 89.28, vat: 10.71, total: 99.99 });
    const sums = f.db.prepare('SELECT ROUND(SUM(debit), 2) AS dr, ROUND(SUM(credit), 2) AS cr FROM journal_lines WHERE entry_id = ?').get(lastEntryId(f));
    expect(sums).toMatchObject({ dr: 209.99, cr: 209.99 });
    expect(journalLines(f, lastEntryId(f))[0]).toEqual({ code: '1020', debit: 99.99, credit: 0 });
  });
  it('posts gross sales with no VAT line when not VAT-registered', () => {
    const f = fixture();
    setSetting(f.db, 'vat_registered', '0');
    postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 99.99 }] }, 'admin', AT);
    expect(journalLines(f, lastEntryId(f)).map((l) => l.code)).toEqual(['1010', '4100', '5100', '1200']);
    expect(getSale(f.db, 1)).toMatchObject({ subtotal: 99.99, vat: 0, total: 99.99 });
  });
  it('needs a customer for on-account sales and posts them to AR', () => {
    const f = fixture();
    expect(() => postSale(f.db, { date: D, customerId: null, method: 'credit', lines: [{ itemId: f.item, qty: 1, unitPrice: 56 }] }, 'admin', AT)).toThrow('On-account sales need a customer.');
    const r = postSale(f.db, { date: D, customerId: f.customer, method: 'credit', lines: [{ itemId: f.item, qty: 2, unitPrice: 56 }] }, 'admin', AT);
    expect(journalLines(f, lastEntryId(f))[0]).toEqual({ code: '1100', debit: 112, credit: 0 });
    expect(getSale(f.db, r.id)).toMatchObject({ customerName: 'JDC Construction', paid: 0, balance: 112 });
  });
  it('blocks over-release and bad input without writing anything', () => {
    const f = fixture();
    expect(() => postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 25, unitPrice: 56 }] }, 'admin', AT)).toThrow(/only 20 on hand/);
    expect(() => postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [] }, 'admin', AT)).toThrow(/at least one line/);
    expect(() => postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: -5 }] }, 'admin', AT)).toThrow(/Line 1: price/);
    expect(() => postSale(f.db, { date: 'not-a-day', customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 5 }] }, 'admin', AT)).toThrow(/date/);
    expect(f.db.prepare('SELECT COUNT(*) AS n FROM sales').get()).toMatchObject({ n: 0 });
    expect(journalCount(f)).toBe(0);
    expect(qtyOf(f.db, f.item)).toBe(20);
  });
  it('refuses a sale dated in a closed month', () => {
    const f = fixture();
    closeThrough(f.db, '2026-09-30', 'admin');
    expect(() => postSale(f.db, { date: '2026-09-30', customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 5 }] }, 'admin', AT)).toThrow('Sep 2026 is closed. Ask the admin to reopen it.');
  });
});

describe('voidSale', () => {
  it('ACCEPTANCE: restores stock, reverses the journal, marks the sale void', () => {
    const f = fixture();
    const r = postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 2, unitPrice: 56 }] }, 'admin', AT);
    const saleEntry = lastEntryId(f);
    voidSale(f.db, r.id, 'Customer returned both', 'admin', '2026-10-03T01:00:00.000Z');
    expect(qtyOf(f.db, f.item)).toBe(20);
    expect(getSale(f.db, r.id)).toMatchObject({ status: 'void', voidReason: 'Customer returned both' });
    const rev = journalLines(f, lastEntryId(f));
    expect(rev).toEqual(journalLines(f, saleEntry).map((l) => ({ code: l.code, debit: l.credit, credit: l.debit })));
    expect(plain(f.db.prepare('SELECT source_type, memo, date FROM journal_entries WHERE id = ?').all(lastEntryId(f)))).toEqual([{ source_type: 'sale_void', memo: 'Void SI-000001: Customer returned both', date: '2026-10-03' }]);
    expect(plain(f.db.prepare("SELECT qty_delta, unit_cost, ref_no, note, sale_id FROM movements WHERE type = 'adjust'").all())).toEqual([
      { qty_delta: 2, unit_cost: 50, ref_no: 'SI-000001', note: 'Void SI-000001', sale_id: r.id },
    ]);
    expect(accountBalance(f.db, '1010')).toBe(0);
    expect(() => voidSale(f.db, r.id, 'again', 'admin')).toThrow(/already void/);
    expect(() => voidSale(f.db, r.id, '', 'admin')).toThrow(/already void|reason/);
  });
  it('requires a reason and an open period for both the sale date and today', () => {
    const f = fixture();
    const r = postSale(f.db, { date: D, customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 56 }] }, 'admin', AT);
    expect(() => voidSale(f.db, r.id, '  ', 'admin')).toThrow(/reason/);
    closeThrough(f.db, '2026-10-31', 'admin');
    expect(() => voidSale(f.db, r.id, 'typo', 'admin', '2026-11-05T00:00:00.000Z')).toThrow('Oct 2026 is closed. Ask the admin to reopen it.');
    expect(getSale(f.db, r.id)?.status).toBe('posted');
  });
});

describe('listSales / salesTotals', () => {
  it('filters and totals posted sales only', () => {
    const f = fixture();
    postSale(f.db, { date: '2026-10-01', customerId: null, method: 'cash', lines: [{ itemId: f.item, qty: 1, unitPrice: 56 }] }, 'admin', '2026-10-01T01:00:00.000Z');
    const b = postSale(f.db, { date: '2026-10-02', customerId: f.customer, method: 'credit', lines: [{ itemId: f.item, qty: 2, unitPrice: 56 }] }, 'admin', AT);
    const c = postSale(f.db, { date: '2026-10-03', customerId: null, method: 'gcash', lines: [{ itemId: f.item2, qty: 1, unitPrice: 20 }] }, 'admin', '2026-10-03T01:00:00.000Z');
    voidSale(f.db, c.id, 'dup', 'admin', '2026-10-03T02:00:00.000Z');
    expect(listSales(f.db, {}).map((s) => s.number)).toEqual(['SI-000003', 'SI-000002', 'SI-000001']);
    expect(listSales(f.db, { from: '2026-10-02', to: '2026-10-02' }).map((s) => s.id)).toEqual([b.id]);
    expect(listSales(f.db, { method: 'cash' })).toHaveLength(1);
    expect(listSales(f.db, { status: 'void' }).map((s) => s.id)).toEqual([c.id]);
    expect(listSales(f.db, { customerId: f.customer })).toHaveLength(1);
    expect(salesTotals(f.db, { from: '2026-10-01', to: '2026-10-31' })).toEqual({ count: 2, total: 168, cogs: 150, vat: 18 });
  });
});
