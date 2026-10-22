'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/native-select';
import { saveVatAction } from './actions';

export function VatForm({ registered, hasEntries }: { registered: boolean; hasEntries: boolean }) {
  const [state, action, pending] = useActionState(saveVatAction, null);
  const [value, setValue] = useState(registered ? '1' : '0');
  const changed = value !== (registered ? '1' : '0');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">VAT</CardTitle>
        <CardDescription>VAT-registered shops post 12% VAT on sales, purchases and expenses; prices are VAT-inclusive.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="vatRegistered">Registration</Label>
            <NativeSelect id="vatRegistered" name="vatRegistered" value={value} onChange={(e) => setValue(e.target.value)} className="w-64">
              <option value="1">VAT-registered (12%)</option>
              <option value="0">Non-VAT</option>
            </NativeSelect>
          </div>
          {hasEntries && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>There are already entries on the books. Changing this applies to new postings only; it does not restate history, and past reports keep their VAT as posted.</p>
              {changed && (
                <div className="space-y-1">
                  <Label htmlFor="vat-confirm">Type CHANGE to confirm</Label>
                  <Input id="vat-confirm" name="confirm" className="w-40 bg-white" autoComplete="off" />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || !changed}>{pending ? 'Saving…' : 'Save VAT setting'}</Button>
            <FormMessage state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
