'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { addNamed, addSupplier, deleteNamed, deleteSupplier, type NamedTable, renameNamed, setReorderPoints, updateSupplier } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { parseReorderUpdates } from '@/lib/forms';

const done = (message: string): ActionResult => {
  revalidatePath('/', 'layout');
  return { ok: true, message };
};

export async function namedListAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const table = String(fd.get('table')) as NamedTable;
  if (table !== 'categories' && table !== 'units') return { ok: false, error: 'Unknown list.' };
  const intent = String(fd.get('intent'));
  const name = String(fd.get('name') ?? '');
  const id = Number(fd.get('id'));
  try {
    const db = getDb();
    if (intent === 'add') { addNamed(db, table, name); return done('Added.'); }
    if (intent === 'rename') { renameNamed(db, table, id, name); return done('Saved.'); }
    if (intent === 'delete') { deleteNamed(db, table, id); return done('Deleted.'); }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function supplierAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const intent = String(fd.get('intent'));
  const id = Number(fd.get('id'));
  const name = String(fd.get('name') ?? '');
  const contact = String(fd.get('contact') ?? '');
  try {
    const db = getDb();
    if (intent === 'add') { addSupplier(db, name, contact); return done('Supplier added.'); }
    if (intent === 'save') { updateSupplier(db, id, name, contact); return done('Supplier saved.'); }
    if (intent === 'delete') { deleteSupplier(db, id); return done('Supplier deleted.'); }
    return { ok: false, error: 'Unknown action.' };
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveReorderPointsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  try {
    const n = setReorderPoints(getDb(), parseReorderUpdates(String(fd.get('updates') ?? '[]')));
    return done(`Saved ${n} reorder point(s).`);
  } catch (e) {
    return toActionError(e);
  }
}
