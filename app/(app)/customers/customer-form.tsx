'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createCustomerAction, updateCustomerAction } from './actions';

export type CustomerFormValues = { id?: number; name: string; contact: string; termsDays: string; active: boolean };

export function CustomerForm({ initial }: { initial: CustomerFormValues }) {
  const [state, action, pending] = useActionState(initial.id ? updateCustomerAction : createCustomerAction, null);
  const [v, setV] = useState(initial);
  const set = (patch: Partial<CustomerFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  return (
    <form action={action} className="max-w-xl space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" value={v.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} /></div>
      <div className="space-y-2"><Label htmlFor="contact">Contact</Label><Input id="contact" name="contact" value={v.contact} onChange={(e) => set({ contact: e.target.value })} maxLength={200} placeholder="Phone, person, address" /></div>
      <div className="space-y-2"><Label htmlFor="termsDays">Credit terms (days)</Label><Input id="termsDays" name="termsDays" inputMode="numeric" value={v.termsDays} onChange={(e) => set({ termsDays: e.target.value })} className="w-32" /></div>
      {initial.id && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
      )}
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save customer'}</Button>
    </form>
  );
}
