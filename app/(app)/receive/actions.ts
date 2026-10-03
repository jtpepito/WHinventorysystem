'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReceiptLines } from '@/lib/forms';
import { duplicateRefWarning, postReceipt } from '@/lib/inventory';

export async function receiveAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const db = getDb();
    const lines = parseReceiptLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    const supplierId = Number(fd.get('supplierId'));
    // Hold a repeated reference once; "Post anyway" resubmits with confirmRef equal to this exact reference.
    if (String(fd.get('confirmRef') ?? '') !== refNo.trim()) {
      const warning = duplicateRefWarning(db, { type: 'receive', refNo, supplierId });
      if (warning) return { ok: false, error: warning, confirmRef: refNo.trim() };
    }
    postReceipt(db, { supplierId, refNo, note: String(fd.get('note') ?? ''), lines }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Received ${lines.length} line(s) under ${refNo.trim()}.` };
  } catch (e) {
    return toActionError(e);
  }
}
