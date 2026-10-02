import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { currentRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const role = await currentRole();
  if (!role) redirect('/login');
  return (
    <div className="min-h-screen md:flex">
      <Nav role={role} />
      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
