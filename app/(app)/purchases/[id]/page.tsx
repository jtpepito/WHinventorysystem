import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { getPurchase, listSupplierPayments } from '@/lib/purchases';
import { formatManila, manilaDay, nowIso } from '@/lib/time';
import { SupplierPaymentForm, VoidPurchaseForm, VoidSupplierPaymentButton } from './purchase-actions';

const METHOD: Record<string, string> = { cash: 'Cash', gcash: 'GCash', bank: 'Bank', credit: 'On account' };

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string }> }) {
  const role = await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const { posted } = await searchParams;
  const db = getDb();
  const p = Number.isInteger(id) ? getPurchase(db, id) : null;
  if (!p) notFound();
  const payments = listSupplierPayments(db, { purchaseId: p.id });
  return (
    <>
      <PageHeader
        title={`Purchase ${p.number}`}
        description={`${p.date} · ${p.supplierName} · invoice ${p.refNo} · ${METHOD[p.method]}${p.note ? ` · ${p.note}` : ''}`}
        actions={p.status === 'void' ? <Badge variant="secondary">Void</Badge> : <Badge variant="outline">Posted</Badge>}
      />
      {posted && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Purchase {p.number} posted.</p>}
      {p.status === 'void' && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Voided {p.voidedAt ? formatManila(p.voidedAt) : ''}: {p.voidReason}</p>}
      <div className="mb-6 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit cost (into stock)</TableHead><TableHead className="text-right">Invoice line</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.lines.map((l) => (
              <TableRow key={l.movementId}>
                <TableCell><Link prefetch={false} href={`/items/${l.itemId}`} className="hover:underline"><span className="font-mono text-xs">{l.sku}</span> {l.name}</Link></TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.qty)} {l.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(l.unitCost)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(l.lineTotal)}</TableCell>
              </TableRow>
            ))}
            {p.vatInvoice && (
              <>
                <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">Goods (ex-VAT)</TableCell><TableCell className="text-right tabular-nums">{formatPeso(p.subtotal)}</TableCell></TableRow>
                <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">VAT 12%</TableCell><TableCell className="text-right tabular-nums">{formatPeso(p.vat)}</TableCell></TableRow>
              </>
            )}
            <TableRow className="font-semibold"><TableCell colSpan={3} className="text-right">Invoice total</TableCell><TableCell className="text-right tabular-nums">{formatPeso(p.total)}</TableCell></TableRow>
            {p.method === 'credit' && (
              <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">Paid {formatPeso(p.paid)} · balance</TableCell><TableCell className="text-right font-semibold tabular-nums text-red-700" data-testid="balance">{formatPeso(p.balance)}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {payments.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Payments</h2>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {payments.map((s) => (
                  <TableRow key={s.id} className={s.status === 'void' ? 'text-muted-foreground line-through' : ''}>
                    <TableCell className="font-mono text-xs">{s.number}</TableCell><TableCell>{s.date}</TableCell><TableCell className="capitalize">{s.method}</TableCell><TableCell>{s.refNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(s.amount)}</TableCell>
                    <TableCell>{s.status === 'posted' && role === 'admin' && p.status === 'posted' && <VoidSupplierPaymentButton paymentId={s.id} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
      {p.status === 'posted' && role === 'admin' && (
        <div className="flex flex-wrap items-start gap-3">
          {p.method === 'credit' && <SupplierPaymentForm purchaseId={p.id} balance={p.balance} today={manilaDay(nowIso())} />}
          <VoidPurchaseForm purchaseId={p.id} />
        </div>
      )}
    </>
  );
}
