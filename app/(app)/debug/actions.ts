'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { rebuildCachedQty } from '@/lib/inventory';

export async function rebuildAction(): Promise<void> {
  await requireRole('admin');
  const fixed = rebuildCachedQty(getDb());
  revalidatePath('/', 'layout');
  redirect(`/debug?rebuilt=${fixed}`);
}
