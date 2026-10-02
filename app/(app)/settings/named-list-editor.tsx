'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { Named, NamedTable } from '@/lib/catalog';
import { namedListAction } from './actions';

export function NamedListEditor({ table, title, rows }: { table: NamedTable; title: string; rows: Named[] }) {
  const [state, action, pending] = useActionState(namedListAction, null);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <form key={`${r.id}:${r.name}`} action={action} className="flex items-center gap-2">
            <input type="hidden" name="table" value={table} />
            <input type="hidden" name="id" value={r.id} />
            <Input name="name" defaultValue={r.name} aria-label={`${title}: ${r.name}`} />
            <span className="w-16 shrink-0 text-right text-xs text-muted-foreground">{r.inUse} items</span>
            <Button type="submit" name="intent" value="rename" variant="outline" size="sm" disabled={pending}>Save</Button>
            <Button
              type="submit" name="intent" value="delete" variant="ghost" size="sm"
              disabled={pending || r.inUse > 0}
              title={r.inUse > 0 ? 'In use by items' : undefined}
            >
              Delete
            </Button>
          </form>
        ))}
        <form action={action} className="flex gap-2 pt-2">
          <input type="hidden" name="table" value={table} />
          <Input name="name" placeholder={`New ${table === 'categories' ? 'category' : 'unit'}`} aria-label={`New ${title}`} />
          <Button type="submit" name="intent" value="add" size="sm" disabled={pending}>Add</Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
