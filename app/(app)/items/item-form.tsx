'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createItemAction, updateItemAction } from './actions';

type Option = { id: number; name: string };
export type ItemFormValues = { id?: number; sku: string; name: string; categoryId: string; unitId: string; reorderPoint: string; active: boolean };

export function ItemForm({ initial, categories, units }: { initial: ItemFormValues; categories: Option[]; units: Option[] }) {
  const [state, action, pending] = useActionState(initial.id ? updateItemAction : createItemAction, null);
  const [v, setV] = useState(initial);
  const set = (patch: Partial<ItemFormValues>) => setV((cur) => ({ ...cur, ...patch }));
  return (
    <form action={action} className="max-w-xl space-y-4">
      {initial.id && <input type="hidden" name="id" value={initial.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="sku">SKU</Label>
          <Input id="sku" name="sku" value={v.sku} onChange={(e) => set({ sku: e.target.value })} required maxLength={32} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reorderPoint">Reorder point</Label>
          <Input id="reorderPoint" name="reorderPoint" inputMode="decimal" value={v.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" value={v.name} onChange={(e) => set({ name: e.target.value })} required maxLength={120} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="categoryId">Category</Label>
          <NativeSelect id="categoryId" name="categoryId" value={v.categoryId} onChange={(e) => set({ categoryId: e.target.value })} required>
            <option value="" disabled>Pick a category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitId">Unit</Label>
          <NativeSelect id="unitId" name="unitId" value={v.unitId} onChange={(e) => set({ unitId: e.target.value })} required>
            <option value="" disabled>Pick a unit…</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </NativeSelect>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" checked={v.active} onChange={(e) => set({ active: e.target.checked })} /> Active
      </label>
      <p className="text-xs text-muted-foreground">Quantity and cost change only through receive, release and count.</p>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save item'}</Button>
    </form>
  );
}
