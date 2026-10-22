import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { requireRole } from '@/lib/auth';
import { listCustomers } from '@/lib/customers';
import { getDb } from '@/lib/db';
import { formatPeso } from '@/lib/num';
import { arAging } from '@/lib/receivables';
import { manilaDay, nowIso } from '@/lib/time';
import { cn } from '@/lib/utils';

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole('admin', 'encoder');
  const { q = '' } = await searchParams;
  const db = getDb();
  const customers = listCustomers(db, { q: q.trim() || undefined });
  const owed = new Map(arAging(db, manilaDay(nowIso())).rows.map((r) => [r.customerId, r.total]));
  return (
    <>
      <PageHeader title="Customers" description={`${customers.length} customer(s)`} actions={<Link prefetch={false} href="/customers/new" className={buttonVariants()}>New customer</Link>} />
      <form className="mb-4 flex gap-2" role="search">
        <Input name="q" defaultValue={q} placeholder="Search name" aria-label="Search customers" className="max-w-xs" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Contact</TableHead><TableHead>Terms</TableHead><TableHead className="text-right">Owes</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {customers.map((c) => (
              <TableRow key={c.id} className={cn(!c.active && 'text-muted-foreground')}>
                <TableCell><Link prefetch={false} href={`/customers/${c.id}`} className="hover:underline">{c.name}</Link></TableCell>
                <TableCell>{c.contact}</TableCell>
                <TableCell>{c.termsDays} days</TableCell>
                <TableCell className={cn('text-right tabular-nums', (owed.get(c.id) ?? 0) > 0 && 'text-red-700')}>{owed.get(c.id) ? formatPeso(owed.get(c.id)!) : '—'}</TableCell>
                <TableCell>{c.active ? 'Active' : 'Inactive'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
