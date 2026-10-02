import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { type Role, SESSION_COOKIE, verifySession } from './session';

export function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  return s;
}

export async function currentRole(): Promise<Role | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySession(token, sessionSecret(), Date.now()) : null;
}

// Call at the top of every server action, page and route handler that needs a role.
export async function requireRole(...allowed: Role[]): Promise<Role> {
  const role = await currentRole();
  if (!role) redirect('/login');
  if (!allowed.includes(role)) throw new Error('Not allowed');
  return role;
}
