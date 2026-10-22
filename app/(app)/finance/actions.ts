'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { InventoryError } from '@/lib/errors';
import { type JournalLineInput, postManualJournal } from '@/lib/ledger';
import { parseNumberInput } from '@/lib/num';
import { closeThrough, reopen } from '@/lib/periods';

function parseJournalLines(raw: string): JournalLineInput[] {
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) throw new InventoryError('Could not read the lines. Reload the page and try again.');
  return rows.flatMap((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const account = String(row.account ?? '').trim();
    const debitRaw = String(row.debit ?? '').trim();
    const creditRaw = String(row.credit ?? '').trim();
    if (!account && !debitRaw && !creditRaw) return [];
    if (!account) throw new InventoryError(`Line ${i + 1}: pick an account.`);
    const debit = debitRaw ? parseNumberInput(debitRaw) : 0;
    const credit = creditRaw ? parseNumberInput(creditRaw) : 0;
    if (debit === null || credit === null) throw new InventoryError(`Line ${i + 1}: enter a valid amount.`);
    return [{ account, debit, credit }];
  });
}

export async function postJournalAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  let entryNo: string;
  try {
    const db = getDb();
    const id = postManualJournal(db, { date: String(fd.get('date') ?? ''), memo: String(fd.get('memo') ?? ''), lines: parseJournalLines(String(fd.get('lines') ?? '[]')) }, actor);
    entryNo = (db.prepare('SELECT entry_no AS n FROM journal_entries WHERE id = ?').get(id) as { n: string }).n;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/finance/journal?posted=${entryNo}`);
}

export async function closePeriodAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    closeThrough(getDb(), String(fd.get('through') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Closed through ${String(fd.get('through'))}.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function reopenPeriodAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    const through = String(fd.get('through') ?? '').trim();
    reopen(getDb(), through || null, String(fd.get('reason') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: through ? `Reopened back to ${through}.` : 'All months are open.' };
  } catch (e) {
    return toActionError(e);
  }
}
