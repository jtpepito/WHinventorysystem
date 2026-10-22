import { describe, expect, it } from 'vitest';
import { getCountSession, postCountSession, saveCountActuals, startCountSession } from '@/lib/count';
import { commitImport } from '@/lib/import';
import { postReceipt } from '@/lib/inventory';
import { accountBalance, seedChart } from '@/lib/ledger';
import { journalForCount, journalForOpening, postStockRelease } from '@/lib/stock-postings';
import { type Fixture, makeDb, plain, qtyOf } from './helpers';

const D = '2026-10-02';
const AT = '2026-10-02T04:00:00.000Z';
const lastEntry = (f: Fixture) =>
  plain(f.db.prepare('SELECT e.source_type, e.memo, a.code, l.debit, l.credit FROM journal_lines l JOIN accounts a ON a.id = l.account_id JOIN journal_entries e ON e.id = l.entry_id WHERE l.entry_id = (SELECT MAX(id) FROM journal_entries) ORDER BY l.id').all());
const entries = (f: Fixture) => (f.db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n;

function stocked() {
  const f = makeDb();
  seedChart(f.db);
  postReceipt(f.db, { supplierId: f.supplier, refNo: 'OB', lines: [{ itemId: f.item, qty: 20, unitCost: 50 }, { itemId: f.item2, qty: 5, unitCost: 10 }] }, 'admin', '2026-09-01T00:00:00.000Z');
  return f;
}

describe('stock postings', () => {
  it('opening stock is capital', () => {
    const f = stocked();
    journalForOpening(f.db, { date: D, amount: 3180, refNo: 'OPENING-2026-10-02' }, 'admin', AT);
    expect(lastEntry(f)).toEqual([
      { source_type: 'opening', memo: 'Opening stock OPENING-2026-10-02', code: '1200', debit: 3180, credit: 0 },
      { source_type: 'opening', memo: 'Opening stock OPENING-2026-10-02', code: '3100', debit: 0, credit: 3180 },
    ]);
    journalForOpening(f.db, { date: D, amount: 0, refNo: 'X' }, 'admin', AT);
    expect(entries(f)).toBe(1);
  });
  it('a count variance posts shrinkage or recovery at avg cost; zero net posts nothing', () => {
    const f = stocked();
    journalForCount(f.db, { date: D, sessionId: 7, delta: -150 }, 'admin', AT);
    expect(lastEntry(f)).toEqual([
      { source_type: 'count', memo: 'Count #7 variance', code: '5200', debit: 150, credit: 0 },
      { source_type: 'count', memo: 'Count #7 variance', code: '1200', debit: 0, credit: 150 },
    ]);
    journalForCount(f.db, { date: D, sessionId: 8, delta: 100 }, 'admin', AT);
    expect(lastEntry(f).map((l) => [l.code, l.debit, l.credit])).toEqual([['1200', 100, 0], ['5200', 0, 100]]);
    journalForCount(f.db, { date: D, sessionId: 9, delta: 0 }, 'admin', AT);
    expect(entries(f)).toBe(2);
  });
  it('postCountSession posts the variance journal itself', () => {
    const f = stocked();
    const id = startCountSession(f.db, { categoryId: f.cat }, AT);
    const lines = getCountSession(f.db, id)!.lines;
    saveCountActuals(f.db, id, [{ lineId: lines.find((l) => l.sku === 'T-001')!.lineId, actual: 17 }, { lineId: lines.find((l) => l.sku === 'T-002')!.lineId, actual: 7 }]);
    postCountSession(f.db, id, 'encoder', '2026-10-02T05:00:00.000Z');
    // −3 × 50 + 2 × 10 = −130 net
    expect(lastEntry(f).map((l) => [l.source_type, l.code, l.debit, l.credit])).toEqual([['count', '5200', 130, 0], ['count', '1200', 0, 130]]);
    expect(accountBalance(f.db, '1200')).toBe(-130);
  });
  it('a non-sale release writes stock off to shrinkage', () => {
    const f = stocked();
    postStockRelease(f.db, { date: D, counterparty: 'Shop use', refNo: 'INT-1', lines: [{ itemId: f.item, qty: 2 }] }, 'encoder', AT);
    expect(qtyOf(f.db, f.item)).toBe(18);
    expect(lastEntry(f)).toEqual([
      { source_type: 'release', memo: 'INT-1 Shop use', code: '5200', debit: 100, credit: 0 },
      { source_type: 'release', memo: 'INT-1 Shop use', code: '1200', debit: 0, credit: 100 },
    ]);
  });
  it('the CSV import posts its opening stock as capital', () => {
    const f = makeDb();
    seedChart(f.db);
    commitImport(f.db, ['SKU,Name,Category,Unit,Qty on hand,Unit cost', 'EL-1,Wire,Electrical,roll,10,2450', 'TL-9,Pliers,Tools,pc,4,182.5'].join('\r\n'), 'admin', AT);
    expect(lastEntry(f).map((l) => [l.source_type, l.code, l.debit, l.credit])).toEqual([['opening', '1200', 25230, 0], ['opening', '3100', 0, 25230]]);
  });
});
