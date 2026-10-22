import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requireRole } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { ACC, accountBalance } from '@/lib/ledger';
import { formatPeso } from '@/lib/num';
import { lockedThrough } from '@/lib/settings';

const LINKS = [
  { href: '/finance/journal', title: 'General journal', text: 'Every entry the system has posted, with its source document.' },
  { href: '/finance/journal/new', title: 'Manual entry', text: 'Capital, drawings, cash to bank, VAT remittance.' },
  { href: '/finance/accounts', title: 'Accounts & ledgers', text: 'Balances by account; click through to a running ledger.' },
  { href: '/finance/periods', title: 'Month-end close', text: 'Lock finished months so reports stop changing.' },
  { href: '/reports', title: 'Reports', text: 'Income statement, balance sheet, aging, VAT, cash book.' },
];

export default async function FinancePage() {
  await requireRole('admin');
  const db = getDb();
  const tiles = [
    { label: 'Cash on hand', value: accountBalance(db, ACC.cash) }, { label: 'GCash', value: accountBalance(db, ACC.gcash) }, { label: 'Bank', value: accountBalance(db, ACC.bank) },
    { label: 'Customers owe', value: accountBalance(db, ACC.ar) }, { label: 'Owed to suppliers', value: accountBalance(db, ACC.ap) },
    { label: 'VAT payable (net)', value: Math.max(0, accountBalance(db, ACC.outputVat) - accountBalance(db, ACC.inputVat)) },
  ];
  const lock = lockedThrough(db);
  return (
    <>
      <PageHeader title="Finance" description={lock ? `Books closed through ${lock}.` : 'All months are open.'} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Card key={t.label}><CardHeader className="pb-1"><CardTitle className="text-sm font-normal text-muted-foreground">{t.label}</CardTitle></CardHeader><CardContent className="text-xl font-semibold tabular-nums">{formatPeso(t.value)}</CardContent></Card>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {LINKS.map((l) => (
          <Link key={l.href} prefetch={false} href={l.href} className="rounded-md border p-4 hover:bg-accent/50">
            <p className="font-medium">{l.title}</p><p className="text-sm text-muted-foreground">{l.text}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
