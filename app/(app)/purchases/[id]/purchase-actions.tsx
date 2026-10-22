'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordSupplierPaymentAction, voidPurchaseAction, voidSupplierPaymentAction } from '../actions';

export function SupplierPaymentForm({ purchaseId, balance, today }: { purchaseId: number; balance: number; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordSupplierPaymentAction, null);
  // After a payment settles the balance the page re-renders without a balance; keep the confirmation visible.
  if (state?.ok) return <FormMessage state={state} />;
  if (balance <= 0) return null;
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Record payment</Button>;
  return (
    <form action={action} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[8rem_9rem_9rem_1fr_auto] sm:items-end">
      <input type="hidden" name="purchaseId" value={purchaseId} />
      <div className="space-y-1"><Label htmlFor="sp-amount">Amount</Label><Input id="sp-amount" name="amount" inputMode="decimal" defaultValue={String(balance)} required /></div>
      <div className="space-y-1">
        <Label htmlFor="sp-method">Method</Label>
        <NativeSelect id="sp-method" name="method" defaultValue="bank"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option></NativeSelect>
      </div>
      <div className="space-y-1"><Label htmlFor="sp-date">Date</Label><Input id="sp-date" name="date" type="date" defaultValue={today} max={today} required /></div>
      <div className="space-y-1"><Label htmlFor="sp-ref">Reference</Label><Input id="sp-ref" name="refNo" placeholder="Cheque / ref no." maxLength={60} /></div>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save payment'}</Button>
      <div className="sm:col-span-5"><FormMessage state={state} /></div>
    </form>
  );
}

export function VoidPurchaseForm({ purchaseId }: { purchaseId: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidPurchaseAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  if (!open) return <Button variant="ghost" className="text-red-700" onClick={() => setOpen(true)}>Void purchase</Button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-md border border-red-200 p-4">
      <input type="hidden" name="id" value={purchaseId} />
      <div className="min-w-64 flex-1 space-y-1"><Label htmlFor="void-reason">Reason</Label><Input id="void-reason" name="reason" required minLength={3} maxLength={200} /></div>
      <Button type="submit" variant="destructive" disabled={pending}>{pending ? 'Voiding…' : 'Confirm void'}</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function VoidSupplierPaymentButton({ paymentId }: { paymentId: number }) {
  const [state, action, pending] = useActionState(voidSupplierPaymentAction, null);
  if (state?.ok) return <span className="text-xs text-muted-foreground">voided</span>;
  return (
    <form
      action={action}
      onSubmit={(e) => {
        const reason = prompt('Reason for voiding this payment?');
        if (!reason || reason.trim().length < 3) { e.preventDefault(); return; }
        (e.currentTarget.elements.namedItem('reason') as HTMLInputElement).value = reason;
      }}
    >
      <input type="hidden" name="id" value={paymentId} />
      <input type="hidden" name="reason" value="" />
      <Button type="submit" variant="ghost" size="sm" className="text-red-700" disabled={pending}>Void</Button>
      {state && !state.ok && <span className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
