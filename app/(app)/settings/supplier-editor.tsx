'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Supplier } from '@/lib/catalog';
import { supplierAction } from './actions';

export function SupplierEditor({ rows }: { rows: Supplier[] }) {
  const [state, action, pending] = useActionState(supplierAction, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Suppliers</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((s) => (
          <form key={`${s.id}:${s.name}:${s.contact}`} action={action} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
            <input type="hidden" name="id" value={s.id} />
            <Input name="name" defaultValue={s.name} aria-label={`Supplier name: ${s.name}`} />
            <Input name="contact" defaultValue={s.contact} aria-label={`Contact for ${s.name}`} />
            <Button type="submit" name="intent" value="save" variant="outline" size="sm" disabled={pending}>Save</Button>
            <Button
              type="submit" name="intent" value="delete" variant="ghost" size="sm" disabled={pending}
              onClick={(e) => { if (!confirm(`Delete ${s.name}? Past movements keep the name.`)) e.preventDefault(); }}
            >
              Delete
            </Button>
          </form>
        ))}
        <form action={action} className="grid gap-2 pt-2 sm:grid-cols-[1fr_1fr_auto]">
          <Input name="name" placeholder="New supplier name" aria-label="New supplier name" />
          <Input name="contact" placeholder="Contact (phone / person)" aria-label="New supplier contact" />
          <Button type="submit" name="intent" value="add" size="sm" disabled={pending}>Add</Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
