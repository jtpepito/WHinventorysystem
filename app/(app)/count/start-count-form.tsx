'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { startCountAction } from './actions';

export function StartCountForm({ categories }: { categories: { id: number; name: string }[] }) {
  const [state, action, pending] = useActionState(startCountAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="categoryId">Category</Label>
        <NativeSelect id="categoryId" name="categoryId" defaultValue="" className="w-56">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </NativeSelect>
      </div>
      <Button type="submit" disabled={pending}>{pending ? 'Starting…' : 'Start count'}</Button>
      <div className="basis-full"><FormMessage state={state} /></div>
    </form>
  );
}
