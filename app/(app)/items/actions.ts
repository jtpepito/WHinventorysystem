'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { createItem, updateItem } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { readItemForm } from '@/lib/forms';

export async function createItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  let id: number;
  try {
    id = createItem(getDb(), readItemForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/items/${id}`);
}

export async function updateItemAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const id = Number(fd.get('id'));
  try {
    updateItem(getDb(), id, readItemForm(fd));
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  redirect(`/items/${id}`);
}
