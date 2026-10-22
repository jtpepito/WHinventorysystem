import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { listNamed, listSuppliers } from '@/lib/catalog';
import { getDb } from '@/lib/db';
import { listAccounts } from '@/lib/ledger';
import { listItems } from '@/lib/queries';
import { businessInfo, vatRegistered } from '@/lib/settings';
import { AccountsEditor } from './accounts-editor';
import { BusinessForm } from './business-form';
import { NamedListEditor } from './named-list-editor';
import { ReorderEditor } from './reorder-editor';
import { SellPriceEditor } from './sell-price-editor';
import { SupplierEditor } from './supplier-editor';
import { VatForm } from './vat-form';

export default async function SettingsPage() {
  await requireRole('admin');
  const db = getDb();
  const categories = listNamed(db, 'categories');
  const items = listItems(db, { status: 'active' });
  const hasEntries = (db.prepare('SELECT COUNT(*) AS n FROM journal_entries').get() as { n: number }).n > 0;
  const cats = categories.map(({ id, name }) => ({ id, name }));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <BusinessForm info={businessInfo(db)} />
        <VatForm registered={vatRegistered(db)} hasEntries={hasEntries} />
      </div>
      <div className="mb-6"><SellPriceEditor rows={items.map(({ id, sku, name, categoryId, unit, avgCost, sellPrice }) => ({ id, sku, name, categoryId, unit, avgCost, sellPrice }))} categories={cats} /></div>
      <div className="mb-6"><AccountsEditor accounts={listAccounts(db)} /></div>
      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <NamedListEditor table="categories" title="Categories" rows={categories} />
        <NamedListEditor table="units" title="Units" rows={listNamed(db, 'units')} />
      </div>
      <div className="mb-6"><SupplierEditor rows={listSuppliers(db)} /></div>
      <ReorderEditor rows={items.map(({ id, sku, name, categoryId, unit, qty, reorderPoint }) => ({ id, sku, name, categoryId, unit, qty, reorderPoint }))} categories={cats} />
    </>
  );
}
