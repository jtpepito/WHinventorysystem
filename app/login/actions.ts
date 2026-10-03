'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/lib/auth';
import { createLoginGate } from '@/lib/login-throttle';
import { roleForPassword } from '@/lib/passwords';
import { homeFor, SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/lib/session';

// One gate per server process (globalThis survives dev hot reloads).
const g = globalThis as unknown as { __loginGate?: ReturnType<typeof createLoginGate> };
const gate = (g.__loginGate ??= createLoginGate());

// Next fills x-forwarded-for with the socket address unless the client already sent one,
// so this can be faked; the gate's shop-wide limit covers that case.
async function clientKey(): Promise<string> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

export async function loginAction(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
  const client = await clientKey();
  const blocked = gate.check(client, Date.now());
  if (blocked) return { error: blocked };
  let role;
  try {
    role = roleForPassword(String(formData.get('password') ?? ''), {
      admin: process.env.ADMIN_PASSWORD,
      encoder: process.env.ENCODER_PASSWORD,
    });
  } catch (e) {
    // Misconfigured passwords: tell whoever is setting the app up, instead of a blank error page.
    return { error: (e as Error).message };
  }
  if (!role) {
    gate.recordFailure(client, Date.now());
    return { error: gate.check(client, Date.now()) ?? 'Wrong password.' };
  }
  gate.recordSuccess(client);
  (await cookies()).set(SESSION_COOKIE, await signSession(role, sessionSecret(), Date.now()), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
  redirect(homeFor(role));
}

export async function logoutAction(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect('/login');
}
