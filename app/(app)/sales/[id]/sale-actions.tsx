'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordPaymentAction, voidPaymentAction, voidSaleAction } from '../actions';

export function PaymentForm({ saleId, balance, today }: { saleId: number; balance: number; today: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(recordPaymentAction, null);
  // After a payment settles the balance the page re-renders without a balance; keep the confirmation visible.
  if (state?.ok) return <FormMessage state={state} />;
  if (balance <= 0) return null;
  if (!open) return <Button variant="outline" onClick={() => setOpen(true)}>Record payment</Button>;
  return (
    <form action={action} className="grid gap-3 rounded-md border p-4 sm:grid-cols-[8rem_9rem_9rem_1fr_auto] sm:items-end">
      <input type="hidden" name="saleId" value={saleId} />
      <div className="space-y-1"><Label htmlFor="pay-amount">Amount</Label><Input id="pay-amount" name="amount" inputMode="decimal" defaultValue={String(balance)} required /></div>
      <div className="space-y-1">
        <Label htmlFor="pay-method">Method</Label>
        <NativeSelect id="pay-method" name="method" defaultValue="cash"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option></NativeSelect>
      </div>
      <div className="space-y-1"><Label htmlFor="pay-date">Date</Label><Input id="pay-date" name="date" type="date" defaultValue={today} max={today} required /></div>
      <div className="space-y-1"><Label htmlFor="pay-ref">Reference</Label><Input id="pay-ref" name="refNo" placeholder="OR / ref no." maxLength={60} /></div>
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save payment'}</Button>
      <div className="sm:col-span-5"><FormMessage state={state} /></div>
    </form>
  );
}

export function VoidSaleForm({ saleId }: { saleId: number }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(voidSaleAction, null);
  if (state?.ok) return <FormMessage state={state} />;
  if (!open) return <Button variant="ghost" className="text-red-700" onClick={() => setOpen(true)}>Void sale</Button>;
  return (
    <form action={action} className="flex flex-wrap items-end gap-3 rounded-md border border-red-200 p-4">
      <input type="hidden" name="id" value={saleId} />
      <div className="min-w-64 flex-1 space-y-1"><Label htmlFor="void-reason">Reason</Label><Input id="void-reason" name="reason" required minLength={3} maxLength={200} /></div>
      <Button type="submit" variant="destructive" disabled={pending}>{pending ? 'Voiding…' : 'Confirm void'}</Button>
      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}

export function VoidPaymentButton({ paymentId }: { paymentId: number }) {
  const [state, action, pending] = useActionState(voidPaymentAction, null);
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
