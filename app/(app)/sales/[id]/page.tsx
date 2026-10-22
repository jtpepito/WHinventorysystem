import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { formatPeso, formatQty } from '@/lib/num';
import { listCustomerPayments } from '@/lib/receivables';
import { getSale, SALE_METHOD_LABEL as METHOD_LABEL } from '@/lib/sales';
import { vatRegistered } from '@/lib/settings';
import { formatManila, manilaDay, nowIso } from '@/lib/time';
import { PaymentForm, VoidPaymentButton, VoidSaleForm } from './sale-actions';

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string }> }) {
  const role = await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const { posted } = await searchParams;
  const db = getDb();
  const sale = Number.isInteger(id) ? getSale(db, id) : null;
  if (!sale) notFound();
  const payments = listCustomerPayments(db, { saleId: sale.id });
  const isVat = vatRegistered(db);
  return (
    <>
      <PageHeader
        title={`Sale ${sale.number}`}
        description={`${sale.date} · ${sale.customerName} · ${METHOD_LABEL[sale.method]}${sale.note ? ` · ${sale.note}` : ''}`}
        actions={
          <>
            {sale.status === 'void' ? <Badge variant="secondary">Void</Badge> : <Badge variant="outline">Posted</Badge>}
            <Link prefetch={false} href={`/sales/${sale.id}/print`} className={buttonVariants({ variant: 'outline' })}>Print receipt</Link>
          </>
        }
      />
      {posted && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">Sale {sale.number} posted.</p>}
      {sale.status === 'void' && <p data-testid="form-message" role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Voided {sale.voidedAt ? formatManila(sale.voidedAt) : ''}: {sale.voidReason}</p>}

      <div className="mb-6 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Item</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Price</TableHead><TableHead className="text-right">Line total</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {sale.lines.map((l) => (
              <TableRow key={l.id}>
                <TableCell><Link prefetch={false} href={`/items/${l.itemId}`} className="hover:underline"><span className="font-mono text-xs">{l.sku}</span> {l.name}</Link></TableCell>
                <TableCell className="text-right tabular-nums">{formatQty(l.qty)} {l.unit}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(l.unitPrice)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPeso(l.lineTotal)}</TableCell>
              </TableRow>
            ))}
            {isVat && (
              <>
                <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">Subtotal (ex-VAT)</TableCell><TableCell className="text-right tabular-nums">{formatPeso(sale.subtotal)}</TableCell></TableRow>
                <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">VAT 12%</TableCell><TableCell className="text-right tabular-nums">{formatPeso(sale.vat)}</TableCell></TableRow>
              </>
            )}
            <TableRow className="font-semibold"><TableCell colSpan={3} className="text-right">Total</TableCell><TableCell className="text-right tabular-nums">{formatPeso(sale.total)}</TableCell></TableRow>
            {sale.method === 'credit' && (
              <TableRow><TableCell colSpan={3} className="text-right text-muted-foreground">Paid {formatPeso(sale.paid)} · balance</TableCell><TableCell className="text-right font-semibold tabular-nums text-red-700" data-testid="balance">{formatPeso(sale.balance)}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {role === 'admin' && <p className="mb-4 text-xs text-muted-foreground">Cost of goods {formatPeso(sale.cogs)} · gross profit {formatPeso(sale.subtotal - sale.cogs)}{sale.journalEntryId && <> · <Link prefetch={false} href={`/finance/journal?entry=${sale.journalEntryId}`} className="underline">journal entry</Link></>}</p>}

      {payments.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">Payments</h2>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Method</TableHead><TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id} className={p.status === 'void' ? 'text-muted-foreground line-through' : ''}>
                    <TableCell className="font-mono text-xs">{p.number}</TableCell><TableCell>{p.date}</TableCell><TableCell className="capitalize">{p.method}</TableCell><TableCell>{p.refNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPeso(p.amount)}</TableCell>
                    <TableCell>{p.status === 'posted' && role === 'admin' && sale.status === 'posted' && <VoidPaymentButton paymentId={p.id} />}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {sale.status === 'posted' && (
        <div className="flex flex-wrap items-start gap-3">
          {sale.method === 'credit' && sale.balance > 0 && <PaymentForm saleId={sale.id} balance={sale.balance} today={manilaDay(nowIso())} />}
          {role === 'admin' && <VoidSaleForm saleId={sale.id} />}
        </div>
      )}
    </>
  );
}
