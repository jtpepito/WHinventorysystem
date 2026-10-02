import type { ActionResult } from '@/lib/action-result';
import { cn } from '@/lib/utils';

export function FormMessage({ state }: { state: ActionResult }) {
  if (!state) return null;
  return (
    <p
      data-testid="form-message"
      role={state.ok ? 'status' : 'alert'}
      className={cn('rounded-md border px-3 py-2 text-sm', state.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900')}
    >
      {state.ok ? state.message : state.error}
    </p>
  );
}
