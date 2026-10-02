'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReleaseLines } from '@/lib/forms';
import { postRelease } from '@/lib/inventory';

export async function releaseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const lines = parseReleaseLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    postRelease(getDb(), { counterparty: String(fd.get('counterparty') ?? ''), refNo, note: String(fd.get('note') ?? ''), lines }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Released ${lines.length} line(s) under ${refNo.trim()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
