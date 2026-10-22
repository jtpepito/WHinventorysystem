'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseReceiptLines } from '@/lib/forms';
import { duplicateRefWarning } from '@/lib/inventory';
import { isPurchaseMethod, postPurchase } from '@/lib/purchases';

export async function receiveAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const db = getDb();
    const lines = parseReceiptLines(String(fd.get('lines') ?? '[]'));
    const refNo = String(fd.get('refNo') ?? '');
    const supplierId = Number(fd.get('supplierId'));
    const method = String(fd.get('method') ?? 'cash');
    if (!isPurchaseMethod(method)) return { ok: false, error: 'Pick how it was paid.' };
    // Hold a repeated supplier invoice once; "Post anyway" resubmits with confirmRef equal to this exact reference.
    if (String(fd.get('confirmRef') ?? '') !== refNo.trim()) {
      const warning = duplicateRefWarning(db, { type: 'receive', refNo, supplierId });
      if (warning) return { ok: false, error: warning, confirmRef: refNo.trim() };
    }
    const r = postPurchase(db, {
      date: String(fd.get('date') ?? ''), supplierId, refNo, method, vatInvoice: fd.get('vatInvoice') === 'on', note: String(fd.get('note') ?? ''), lines,
    }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Received ${lines.length} line(s) under ${refNo.trim()} (${r.number}).` };
  } catch (e) {
    return toActionError(e);
  }
}
