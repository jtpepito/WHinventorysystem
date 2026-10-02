import { redirect } from 'next/navigation';
import { currentRole } from '@/lib/auth';
import { homeFor } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const role = await currentRole();
  redirect(role ? homeFor(role) : '/login');
}
