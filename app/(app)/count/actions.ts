'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { discardCountSession, postCountSession, refreshExpected, saveCountActuals, startCountSession } from '@/lib/count';
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
  let discarded = false;
  try {
    const db = getDb();
    const save = () => saveCountActuals(db, sessionId, parseCountEntries(String(fd.get('actuals') ?? '[]')));
    if (intent === 'discard') {
      // No save first: a half-typed bad number must not block throwing the sheet away.
      discardCountSession(db, sessionId);
      discarded = true;
      result = null;
    } else if (intent === 'refresh') {
      save();
      const n = refreshExpected(db, sessionId);
      result = { ok: true, message: n ? `Updated expected qty for ${n} item(s). Re-check them before posting.` : 'Expected quantities are already current.' };
    } else if (intent === 'post') {
      save();
      posted = postCountSession(db, sessionId, actor).adjustments;
      result = null;
    } else {
      save();
      result = { ok: true, message: 'Progress saved.' };
    }
  } catch (e) {
    result = toActionError(e);
  }
  revalidatePath('/', 'layout');
  // redirect() throws, so it must stay outside the try/catch above.
  if (posted !== null) redirect(`/count/${sessionId}?posted=${posted}`);
  if (discarded) redirect('/count?discarded=1');
  return result;
}
