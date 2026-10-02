import { InventoryError } from './inventory';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string } | null;

export function toActionError(e: unknown): ActionResult {
  if (e instanceof InventoryError) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: 'Something went wrong. Nothing was saved.' };
}
