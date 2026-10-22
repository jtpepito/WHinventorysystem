'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { closePeriodAction, reopenPeriodAction } from '../actions';

export function CloseForm({ through }: { through: string }) {
  const [state, action, pending] = useActionState(closePeriodAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="through" value={through} />
      <Button type="submit" disabled={pending} onClick={(e) => { if (!confirm(`Close the books through ${through}? Nothing dated on or before that day can be posted until an admin reopens it.`)) e.preventDefault(); }}>
        {pending ? 'Closing…' : `Close through ${through}`}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}

export function ReopenForm({ options }: { options: string[] }) {
  const [state, action, pending] = useActionState(reopenPeriodAction, null);
  return (
    <form action={action} className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">Reopening lets past months change again. Say why; it goes in the log.</p>
      <div className="space-y-1"><Label htmlFor="reopen-reason">Reason for reopening</Label><Input id="reopen-reason" name="reason" required minLength={5} maxLength={200} className="max-w-md bg-white" /></div>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => <Button key={o} type="submit" name="through" value={o} variant="outline" disabled={pending}>Reopen back to {o}</Button>)}
        <Button type="submit" name="through" value="" variant="destructive" disabled={pending}>Reopen everything</Button>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
