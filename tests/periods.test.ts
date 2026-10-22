import { describe, expect, it } from 'vitest';
import { getCountSession, postCountSession, saveCountActuals, startCountSession } from '@/lib/count';
import { postReceipt } from '@/lib/inventory';
import { postJournal, seedChart } from '@/lib/ledger';
import { assertOpen, closeThrough, listPeriods, monthLabel, reopen } from '@/lib/periods';
import { lockedThrough } from '@/lib/settings';
import { makeDb, plain } from './helpers';

describe('period lock', () => {
  it('is open everywhere on a fresh book', () => {
    const { db } = makeDb();
    expect(() => assertOpen(db, '2020-01-01')).not.toThrow();
    expect(monthLabel('2026-10-15')).toBe('Oct 2026');
  });
  it('closes through a month end and refuses postings on or before it', () => {
    const { db } = makeDb();
    closeThrough(db, '2026-09-30', 'admin');
    expect(lockedThrough(db)).toBe('2026-09-30');
    expect(() => assertOpen(db, '2026-09-30')).toThrow('Sep 2026 is closed. Ask the admin to reopen it.');
    expect(() => assertOpen(db, '2026-07-04')).toThrow('Jul 2026 is closed. Ask the admin to reopen it.');
    expect(() => assertOpen(db, '2026-10-01')).not.toThrow();
    expect(() => closeThrough(db, '2026-10-15', 'admin')).toThrow(/month end/);
    expect(() => closeThrough(db, '2026-08-31', 'admin')).toThrow(/already closed through/);
    expect(plain(db.prepare('SELECT action, through, reason FROM period_log').all())).toEqual([{ action: 'close', through: '2026-09-30', reason: '' }]);
  });
  it('reopens only with a reason and logs it', () => {
    const { db } = makeDb();
    closeThrough(db, '2026-09-30', 'admin');
    expect(() => reopen(db, null, 'x', 'admin')).toThrow(/reason/);
    reopen(db, '2026-08-31', 'Found an unposted invoice', 'admin');
    expect(lockedThrough(db)).toBe('2026-08-31');
    expect(() => assertOpen(db, '2026-09-30')).not.toThrow();
    reopen(db, null, 'Starting over', 'admin');
    expect(lockedThrough(db)).toBeNull();
    expect(plain(db.prepare("SELECT action, through, reason FROM period_log WHERE action = 'reopen'").all())).toEqual([
      { action: 'reopen', through: '2026-08-31', reason: 'Found an unposted invoice' },
      { action: 'reopen', through: null, reason: 'Starting over' },
    ]);
  });
  it('blocks stock postings, journal entries and counts dated inside the lock', () => {
    const f = makeDb();
    seedChart(f.db);
    closeThrough(f.db, '2026-09-30', 'admin');
    const line = [{ itemId: f.item, qty: 1, unitCost: 1 }];
    expect(() => postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: line }, 'admin', '2026-09-10T00:00:00.000Z')).toThrow(/Sep 2026 is closed/);
    postReceipt(f.db, { supplierId: f.supplier, refNo: 'R', lines: line }, 'admin', '2026-10-02T00:00:00.000Z');
    expect(() => postJournal(f.db, { date: '2026-09-30', sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '1010', debit: 1 }, { account: '3100', credit: 1 }] }, 'admin')).toThrow(/closed/);
    const id = startCountSession(f.db, { categoryId: f.cat }, '2026-10-02T00:00:00.000Z');
    saveCountActuals(f.db, id, [{ lineId: getCountSession(f.db, id)!.lines[0].lineId, actual: 0 }]);
    expect(() => postCountSession(f.db, id, 'admin', '2026-09-15T00:00:00.000Z')).toThrow(/Sep 2026 is closed/);
  });
  it('lists months with closed flags and document totals', () => {
    const { db } = makeDb();
    seedChart(db);
    postJournal(db, { date: '2026-08-15', sourceType: 'manual', sourceId: null, memo: '', lines: [{ account: '1010', debit: 1 }, { account: '3100', credit: 1 }] }, 'admin');
    closeThrough(db, '2026-08-31', 'admin');
    const months = listPeriods(db, '2026-10-02T04:00:00.000Z');
    expect(months.map((m) => [m.month, m.closed])).toEqual([['2026-10', false], ['2026-09', false], ['2026-08', true]]);
    expect(months[0]).toMatchObject({ sales: 0, purchases: 0, expenses: 0 });
  });
});
