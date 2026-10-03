import { InventoryError } from './inventory';

// confirmRef: the post was held only because this reference was used before; resubmitting with
// confirmRef set to the same value posts it anyway.
export type ActionResult = { ok: true; message: string } | { ok: false; error: string; confirmRef?: string } | null;

export function toActionError(e: unknown): ActionResult {
  if (e instanceof InventoryError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: 'Something went wrong. Nothing was saved.' };
}
