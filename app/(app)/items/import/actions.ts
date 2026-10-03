'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { commitImport, type ImportPlan, planImport } from '@/lib/import';

const MAX_BYTES = 512 * 1024;

export type PreviewState = { plan: ImportPlan; text: string; fileName: string } | { error: string } | null;

// Reads and checks the file only; nothing is saved.
export async function previewImportAction(_prev: PreviewState, fd: FormData): Promise<PreviewState> {
  await requireRole('admin');
  const file = fd.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a CSV file first.' };
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 512 KB. Split it into smaller files.' };
  if (!/\.csv$/i.test(file.name)) return { error: 'Save the sheet as CSV first (in Excel: File → Save As → CSV UTF-8), then upload that.' };
  const text = await file.text();
  return { plan: planImport(getDb(), text), text, fileName: file.name };
}

// Re-checks the same text and imports it all, or nothing.
export async function importAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const actor = await requireRole('admin');
  let result: ReturnType<typeof commitImport>;
  try {
    result = commitImport(getDb(), String(fd.get('csv') ?? ''), actor);
  } catch (e) {
    return toActionError(e);
  }
  revalidatePath('/', 'layout');
  const params = new URLSearchParams({ imported: String(result.items), stocked: String(result.stocked) });
  if (result.refNo) params.set('ref', result.refNo);
  redirect(`/items?${params}`);
}
