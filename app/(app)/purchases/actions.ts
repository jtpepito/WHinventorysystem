'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { isPayMethod } from '@/lib/ledger';
import { postSupplierPayment, voidPurchase, voidSupplierPayment } from '@/lib/purchases';

export async function recordSupplierPaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    const method = String(fd.get('method') ?? '');
    if (!isPayMethod(method)) return { ok: false, error: 'Pick how it was paid.' };
    const r = postSupplierPayment(getDb(), {
      date: String(fd.get('date') ?? ''), purchaseId: Number(fd.get('purchaseId')), amount: Number(String(fd.get('amount') ?? '').replace(/,/g, '')), method,
      refNo: String(fd.get('refNo') ?? ''), note: String(fd.get('note') ?? ''),
    }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Payment ${r.number} recorded.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidPurchaseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    voidPurchase(getDb(), Number(fd.get('id')), String(fd.get('reason') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Purchase voided. The goods are off the shelf and the entry has been reversed.' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidSupplierPaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    voidSupplierPayment(getDb(), Number(fd.get('id')), String(fd.get('reason') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Payment voided.' };
  } catch (e) {
    return toActionError(e);
  }
}
