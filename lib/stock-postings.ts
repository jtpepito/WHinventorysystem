import type { DatabaseSync } from 'node:sqlite';
import { type Actor, postRelease, type ReleaseInput } from './inventory';
import { ACC, postJournal } from './ledger';
import { roundMoney } from './money';
import { tx } from './sqlite';
import { isDay, nowIso } from './time';
import { InventoryError } from './inventory';

// Stock that arrives without a purchase (opening balance, CSV import) is the owner's capital.
export function journalForOpening(db: DatabaseSync, o: { date: string; amount: number; refNo: string }, actor: Actor, at = nowIso()): number | null {
  const amount = roundMoney(o.amount);
  if (amount <= 0) return null;
  return postJournal(db, {
    date: o.date, sourceType: 'opening', sourceId: null, memo: `Opening stock ${o.refNo}`,
    lines: [{ account: ACC.inventory, debit: amount }, { account: ACC.capital, credit: amount }],
  }, actor, at);
}

// delta is the signed peso value of a count's variances (Σ variance × avg cost).
export function journalForCount(db: DatabaseSync, c: { date: string; sessionId: number; delta: number }, actor: Actor, at = nowIso()): number | null {
  const delta = roundMoney(c.delta);
  if (delta === 0) return null;
  const amount = Math.abs(delta);
  const lines = delta > 0
    ? [{ account: ACC.inventory, debit: amount }, { account: ACC.shrink, credit: amount }]
    : [{ account: ACC.shrink, debit: amount }, { account: ACC.inventory, credit: amount }];
  return postJournal(db, { date: c.date, sourceType: 'count', sourceId: c.sessionId, memo: `Count #${c.sessionId} variance`, lines }, actor, at);
}

// A release that is not a sale (shop use, samples, write-off): stock out at avg cost, expensed as shrinkage.
export function postStockRelease(db: DatabaseSync, input: ReleaseInput & { date: string }, actor: Actor, at = nowIso()): number[] {
  if (!isDay(input.date)) throw new InventoryError('Pick a valid date.');
  return tx(db, () => {
    const ids = postRelease(db, input, actor, at);
    const cost = ids.reduce((s, id) => {
      const m = db.prepare('SELECT qty_delta, unit_cost FROM movements WHERE id = ?').get(id) as { qty_delta: number; unit_cost: number | null };
      return s + Math.abs(m.qty_delta) * (m.unit_cost ?? 0);
    }, 0);
    const amount = roundMoney(cost);
    if (amount > 0) {
      postJournal(db, {
        date: input.date, sourceType: 'release', sourceId: ids[0], memo: `${input.refNo.trim()} ${input.counterparty.trim()}`,
        lines: [{ account: ACC.shrink, debit: amount }, { account: ACC.inventory, credit: amount }],
      }, actor, at);
    }
    return ids;
  });
}
