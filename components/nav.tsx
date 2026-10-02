'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logoutAction } from '@/app/login/actions';
import { Button } from '@/components/ui/button';
import { canAccess, type Role } from '@/lib/session';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/items', label: 'Items' },
  { href: '/receive', label: 'Receive' },
  { href: '/release', label: 'Release' },
  { href: '/count', label: 'Count' },
  { href: '/movements', label: 'Movements' },
  { href: '/reports', label: 'Reports' },
  { href: '/settings', label: 'Settings' },
  { href: '/debug', label: 'Ledger check' },
];

export function Nav({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <aside className="border-b bg-muted/40 md:min-h-screen md:w-56 md:shrink-0 md:border-b-0 md:border-r">
      <div className="px-4 py-3">
        <p className="font-semibold">Inventory</p>
        <p className="text-xs text-muted-foreground">Signed in as {role === 'admin' ? 'Admin' : 'Encoder'}</p>
      </div>
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
        {LINKS.filter((l) => canAccess(role, l.href)).map((l) => {
          const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? 'page' : undefined}
              className={cn('whitespace-nowrap rounded-md px-3 py-2 text-sm hover:bg-accent', active && 'bg-accent font-medium')}
            >
              {l.label}
            </Link>
          );
        })}
        <form action={logoutAction} className="md:mt-4">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start">Log out</Button>
        </form>
      </nav>
    </aside>
  );
}
