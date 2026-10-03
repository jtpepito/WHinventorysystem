import { Button } from '@/components/ui/button';
import type { ActionResult } from '@/lib/action-result';

// Shown after a post was held for a repeated reference, only while the reference field still holds that
// same reference (editing it withdraws the override).
export function PostAnywayButton({ state, refNo, pending }: { state: ActionResult; refNo: string; pending: boolean }) {
  if (!state || state.ok || state.confirmRef === undefined || state.confirmRef !== refNo.trim()) return null;
  return (
    <Button type="submit" name="confirmRef" value={state.confirmRef} variant="outline" disabled={pending}>
      Post anyway
    </Button>
  );
}
