import { PageHeader } from '@/components/page-header';
import { requireRole } from '@/lib/auth';
import { CustomerForm } from '../customer-form';

export default async function NewCustomerPage() {
  await requireRole('admin', 'encoder');
  return (
    <>
      <PageHeader title="New customer" />
      <CustomerForm initial={{ name: '', contact: '', termsDays: '30', active: true }} />
    </>
  );
}
