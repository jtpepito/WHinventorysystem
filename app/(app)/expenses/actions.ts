'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { postExpense, voidExpense } from '@/lib/expenses';
import { isPayMethod } from '@/lib/ledger';

export async function postExpenseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  let number: string;
  try {
    const method = String(fd.get('method') ?? '');
    if (!isPayMethod(method)) return { ok: false, error: 'Pick how it was paid.' };
    const r = postExpense(getDb(), {
      date: String(fd.get('date') ?? ''), accountCode: String(fd.get('accountCode') ?? ''), payee: String(fd.get('payee') ?? ''),
      amount: Number(String(fd.get('amount') ?? '').replace(/,/g, '')), vatInvoice: fd.get('vatInvoice') === 'on', method,
      refNo: String(fd.get('refNo') ?? ''), note: String(fd.get('note') ?? ''),
    }, actor);
    number = r.number;
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/expenses?posted=${number}`);
}

export async function voidExpenseAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  try {
    voidExpense(getDb(), Number(fd.get('id')), String(fd.get('reason') ?? ''), actor);
    revalidatePath('/', 'layout');
    return { ok: true, message: 'Expense voided.' };
  } catch (e) {
    return toActionError(e);
  }
}
