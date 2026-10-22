'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { parseSaleLines } from '@/lib/forms';
import { isPayMethod } from '@/lib/ledger';
import { postCustomerPayment, voidCustomerPayment } from '@/lib/receivables';
import { isSaleMethod, postSale, voidSale } from '@/lib/sales';

export async function postSaleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  let id: number;
  try {
    const method = String(fd.get('method') ?? '');
    if (!isSaleMethod(method)) return { ok: false, error: 'Pick a payment method.' };
    const customer = String(fd.get('customerId') ?? '');
    const r = postSale(getDb(), {
      date: String(fd.get('date') ?? ''),
      customerId: customer ? Number(customer) : null,
      method,
      note: String(fd.get('note') ?? ''),
      lines: parseSaleLines(String(fd.get('lines') ?? '[]')),
    }, actor);
    id = r.id;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/sales/${id}?posted=1`);
}

export async function voidSaleAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  const id = Number(fd.get('id'));
  try {
    voidSale(getDb(), id, String(fd.get('reason') ?? ''), actor);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Sale voided. Stock is back on the shelf and the entry has been reversed.' };
}

export async function recordPaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin', 'encoder');
  try {
    const method = String(fd.get('method') ?? '');
    if (!isPayMethod(method)) return { ok: false, error: 'Pick how the customer paid.' };
    const amount = Number(String(fd.get('amount') ?? '').replace(/,/g, ''));
    const r = postCustomerPayment(getDb(), {
      date: String(fd.get('date') ?? ''), saleId: Number(fd.get('saleId')), amount, method,
      refNo: String(fd.get('refNo') ?? ''), note: String(fd.get('note') ?? ''),
    }, actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: `Payment ${r.number} recorded.` };
  } catch (e) {
    return toActionError(e);
  }
}

export async function voidPaymentAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    voidCustomerPayment(getDb(), Number(fd.get('id')), String(fd.get('reason') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Payment voided.' };
  } catch (e) {
    return toActionError(e);
  }
}
