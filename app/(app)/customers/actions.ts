'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { createCustomer, updateCustomer } from '@/lib/customers';
import { getDb } from '@/lib/db';

function read(fd: FormData) {
  const terms = String(fd.get('termsDays') ?? '').trim();
  return { name: String(fd.get('name') ?? ''), contact: String(fd.get('contact') ?? ''), termsDays: terms === '' ? 30 : Number(terms) };
}

export async function createCustomerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin', 'encoder');
  let id: number;
  try {
    id = createCustomer(getDb(), read(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/customers/${id}`);
}

export async function updateCustomerAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin', 'encoder');
  const id = Number(fd.get('id'));
  try {
    updateCustomer(getDb(), id, { ...read(fd), active: fd.get('active') === 'on' });
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/customers/${id}`);
}
