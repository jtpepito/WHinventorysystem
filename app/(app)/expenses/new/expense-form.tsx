'use client';

import { useActionState, useState } from 'react';
import { FormMessage } from '@/components/form-message';
import { NativeSelect } from '@/components/native-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { vatSplit } from '@/lib/money';
import { formatPeso, parseNumberInput } from '@/lib/num';
import { postExpenseAction } from '../actions';

export function ExpenseForm({ accounts, today, vatRegistered }: { accounts: { code: string; name: string }[]; today: string; vatRegistered: boolean }) {
  const [state, action, pending] = useActionState(postExpenseAction, null);
  const [amount, setAmount] = useState('');
  const [vatInvoice, setVatInvoice] = useState(false);
  const n = parseNumberInput(amount) ?? 0;
  const { net, vat } = vatSplit(n, vatRegistered && vatInvoice);
  return (
    <form action={action} className="max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="accountCode">Account</Label>
          <NativeSelect id="accountCode" name="accountCode" defaultValue="" required>
            <option value="" disabled>Pick an expense account…</option>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
          </NativeSelect>
        </div>
        <div className="space-y-2"><Label htmlFor="date">Date</Label><Input id="date" name="date" type="date" defaultValue={today} max={today} required /></div>
        <div className="space-y-2"><Label htmlFor="payee">Payee</Label><Input id="payee" name="payee" maxLength={120} placeholder="Who was paid" /></div>
        <div className="space-y-2"><Label htmlFor="amount">Amount</Label><Input id="amount" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div className="space-y-2">
          <Label htmlFor="method">Paid by</Label>
          <NativeSelect id="method" name="method" defaultValue="cash"><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank">Bank</option></NativeSelect>
        </div>
        <div className="space-y-2"><Label htmlFor="refNo">Reference</Label><Input id="refNo" name="refNo" maxLength={60} placeholder="OR / invoice no." /></div>
        {vatRegistered && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="vatInvoice" checked={vatInvoice} onChange={(e) => setVatInvoice(e.target.checked)} /> VAT invoice
            <span className="text-xs text-muted-foreground">
              {vatInvoice && n > 0 ? `expense ${formatPeso(net)} + input VAT ${formatPeso(vat)}` : '(tick when the receipt is a VAT invoice; the 12% becomes recoverable input VAT)'}
            </span>
          </label>
        )}
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="note">Note</Label><Input id="note" name="note" maxLength={200} /></div>
      </div>
      <FormMessage state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save expense'}</Button>
    </form>
  );
}
