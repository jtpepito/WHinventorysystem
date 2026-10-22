'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AccountRow } from '@/lib/ledger';
import { cn } from '@/lib/utils';
import { accountAction } from './actions';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

export function AccountsEditor({ accounts }: { accounts: AccountRow[] }) {
  const [state, action, pending] = useActionState(accountAction, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Chart of accounts</CardTitle>
        <CardDescription>System accounts can be renamed but not switched off. Add expense accounts to match how you track spending.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="max-h-[28rem] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Code</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={`${a.id}:${a.name}:${a.active}`} className={cn(!a.active && 'text-muted-foreground')}>
                  <TableCell className="font-mono text-xs">{a.code}</TableCell>
                  <TableCell>
                    <form action={action} id={`acc-${a.id}`} className="flex gap-2">
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="active" value={a.active ? '1' : '0'} />
                      <Input name="name" defaultValue={a.name} aria-label={`Account ${a.code} name`} />
                      <Button type="submit" name="intent" value="rename" variant="outline" size="sm" disabled={pending}>Save</Button>
                    </form>
                  </TableCell>
                  <TableCell className="capitalize">{a.type}</TableCell>
                  <TableCell>{a.system ? 'System' : a.active ? 'Active' : 'Inactive'}</TableCell>
                  <TableCell>
                    {!a.system && (
                      <form action={action}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="name" value={a.name} />
                        <input type="hidden" name="active" value={a.active ? '0' : '1'} />
                        <Button type="submit" name="intent" value="toggle" variant="ghost" size="sm" disabled={pending}>{a.active ? 'Deactivate' : 'Activate'}</Button>
                      </form>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <form action={action} className="grid gap-2 sm:grid-cols-[8rem_1fr_10rem_auto]">
          <Input name="code" placeholder="6700" aria-label="New account code" maxLength={4} />
          <Input name="name" placeholder="Marketing" aria-label="New account name" />
          <NativeSelect name="type" defaultValue="expense" aria-label="New account type">
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </NativeSelect>
          <Button type="submit" name="intent" value="add" size="sm" disabled={pending}>Add account</Button>
        </form>
        <FormMessage state={state} />
      </CardContent>
    </Card>
  );
}
