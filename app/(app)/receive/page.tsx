import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { ReceiveForm } from './receive-form';

export default async function ReceivePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  await requireRole('admin', 'encoder');
  const { denied } = await searchParams;
  const db = getDb();
  const items = listItems(db, { status: 'active' }).map(({ id, sku, name, unit, qty, avgCost }) => ({ id, sku, name, unit, qty, avgCost }));
  return (
    <>
      {/* Middleware sends encoders here with ?denied=1 when they open an admin-only page. */}
      {denied && (
        <p role="status" className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          That page is for admins only.
        </p>
      )}
      <PageHeader title="Receive stock" description="Posting adds to on-hand qty and updates the weighted-average cost." />
      <ReceiveForm items={items} suppliers={listSuppliers(db).map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
