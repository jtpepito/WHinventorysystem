'use client';

import { useActionState } from 'react';
import { FormMessage } from '@/components/form-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { BusinessInfo } from '@/lib/settings';
import { saveBusinessAction } from './actions';

export function BusinessForm({ info }: { info: BusinessInfo }) {
  const [state, action, pending] = useActionState(saveBusinessAction, null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Business details</CardTitle>
        <CardDescription>Printed on sales receipts.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="biz-name">Business name</Label><Input id="biz-name" name="name" defaultValue={info.name} maxLength={120} /></div>
          <div className="space-y-1"><Label htmlFor="biz-tin">TIN</Label><Input id="biz-tin" name="tin" defaultValue={info.tin} maxLength={40} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="biz-address">Address</Label><Input id="biz-address" name="address" defaultValue={info.address} maxLength={200} /></div>
          <div className="space-y-1 sm:col-span-2"><Label htmlFor="biz-footer">Receipt footer</Label><Input id="biz-footer" name="receiptFooter" defaultValue={info.receiptFooter} maxLength={200} /></div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save business details'}</Button>
            <FormMessage state={state} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
