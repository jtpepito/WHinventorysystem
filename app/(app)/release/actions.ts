'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReleaseLines } from '@/lib/forms';
import { duplicateRefWarning, postRelease } from '@/lib/inventory';

export async function releaseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const db = getDb();
    const lines = parseReleaseLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    // Hold a repeated reference once; "Post anyway" resubmits with confirmRef equal to this exact reference.
    if (String(fd.get('confirmRef') ?? '') !== refNo.trim()) {
      const warning = duplicateRefWarning(db, { type: 'release', refNo });
      if (warning) return { ok: false, error: warning, confirmRef: refNo.trim() };
    }
    postRelease(db, { counterparty: String(fd.get('counterparty') ?? ''), refNo, note: String(fd.get('note') ?? ''), lines }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Released ${lines.length} line(s) under ${refNo.trim()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
