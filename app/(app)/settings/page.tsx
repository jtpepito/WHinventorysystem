import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed, listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listItems } from '@/lib/queries';
import { NamedListEditor } from './named-list-editor';
import { ReorderEditor } from './reorder-editor';
import { SupplierEditor } from './supplier-editor';

export default async function SettingsPage() {
  await requireRole('admin');
  const db = getDb();
  const categories = listNamed(db, 'categories');
  const rows = listItems(db, { status: 'active' }).map(({ id, sku, name, categoryId, unit, qty, reorderPoint }) => ({ id, sku, name, categoryId, unit, qty, reorderPoint }));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <NamedListEditor table="categories" title="Categories" rows={categories} />
        <NamedListEditor table="units" title="Units" rows={listNamed(db, 'units')} />
      </div>
      <div className="mb-6"><SupplierEditor rows={listSuppliers(db)} /></div>
      <ReorderEditor rows={rows} categories={categories.map(({ id, name }) => ({ id, name }))} />
    </>
  );
}
