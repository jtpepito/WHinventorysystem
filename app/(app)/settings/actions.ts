'use server';

import { revalidatePath } from 'next/cache';
import { type ActionResult, toActionError } from '@/lib/action-result';
import { requireRole } from '@/lib/auth';
import { addNamed, addSupplier, deleteNamed, deleteSupplier, type NamedTable, renameNamed, setReorderPoints, setSellPrices, updateSupplier } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { parseReorderUpdates, parseSellPriceUpdates } from '@/lib/forms';
import { ACCOUNT_TYPES, type AccountType, addAccount, updateAccount } from '@/lib/ledger';
import { setSetting } from '@/lib/settings';

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

export async function saveSellPricesAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  try {
    const n = setSellPrices(getDb(), parseSellPriceUpdates(String(fd.get('updates') ?? '[]')));
    return done(`Saved ${n} sell price(s).`);
  } catch (e) {
    return toActionError(e);
  }
}

export async function saveBusinessAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const db = getDb();
  const text = (k: string, max: number) => String(fd.get(k) ?? '').trim().slice(0, max);
  setSetting(db, 'business_name', text('name', 120));
  setSetting(db, 'business_address', text('address', 200));
  setSetting(db, 'business_tin', text('tin', 40));
  setSetting(db, 'receipt_footer', text('receiptFooter', 200));
  return done('Business details saved.');
}

// Switching VAT registration applies to new postings only; with entries on the books it asks for a typed confirmation.
export async function saveVatAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const db = getDb();
  const registered = String(fd.get('vatRegistered')) === '1';
  const hasEntries = (db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n > 0;
  if (hasEntries && String(fd.get('confirm') ?? '').trim() !== 'CHANGE') return { ok: false, error: 'Type CHANGE to confirm the VAT change.' };
  setSetting(db, 'vat_registered', registered ? '1' : '0');
  return done(registered ? 'VAT-registered: 12% VAT will be posted on new sales, purchases and expenses.' : 'Non-VAT: new postings carry no VAT.');
}

export async function accountAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const intent = String(fd.get('intent'));
  const id = Number(fd.get('id'));
  try {
    const db = getDb();
    if (intent === 'add') {
      const type = String(fd.get('type')) as AccountType;
      if (!ACCOUNT_TYPES.includes(type)) return { ok: false, error: 'Pick an account type.' };
      addAccount(db, { code: String(fd.get('code') ?? ''), name: String(fd.get('name') ?? ''), type });
      return done('Account added.');
    }
    if (intent === 'rename') { updateAccount(db, id, { name: String(fd.get('name') ?? ''), active: fd.get('active') !== '0' }); return done('Account saved.'); }
    if (intent === 'toggle') { updateAccount(db, id, { name: String(fd.get('name') ?? ''), active: fd.get('active') === '1' }); return done('Account updated.'); }
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
