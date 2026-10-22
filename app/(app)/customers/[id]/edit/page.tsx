import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { getCustomer } from '@/lib/customers';
import { getDb } from '@/lib/db';
import { CustomerForm } from '../../customer-form';

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('admin', 'encoder');
  const id = Number((await params).id);
  const c = Number.isInteger(id) ? getCustomer(getDb(), id) : null;
  if (!c) notFound();
  return (
    <>
      <PageHeader title={`Edit ${c.name}`} />
      <CustomerForm initial={{ id: c.id, name: c.name, contact: c.contact, termsDays: String(c.termsDays), active: c.active }} />
    </>
  );
}
