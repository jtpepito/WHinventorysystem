'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { voidExpenseAction } from './actions';

export function VoidExpenseButton({ expenseId }: { expenseId: number }) {
  const [state, action, pending] = useActionState(voidExpenseAction, null);
  if (state?.ok) return <span className="text-xs text-muted-foreground">voided</span>;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const reason = prompt('Reason for voiding this expense?');
        if (!reason || reason.trim().length < 3) { e.preventDefault(); return; }
        (e.currentTarget.elements.namedItem('reason') as HTMLInputElement).value = reason;
      }}
    >
      <input type="hidden" name="id" value={expenseId} />
      <input type="hidden" name="reason" value="" />
      <Button type="submit" variant="ghost" size="sm" className="text-red-700" disabled={pending}>Void</Button>
      {state && !state.ok && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
