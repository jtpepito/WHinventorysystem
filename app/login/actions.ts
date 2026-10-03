'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sessionSecret } from '@/lib/auth';
import { roleForPassword } from '@/lib/passwords';
import { homeFor, SESSION_COOKIE, SESSION_TTL_MS, signSession } from '@/lib/session';

export async function loginAction(_prev: { error: string } | null, formData: FormData): Promise<{ error: string } | null> {
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
  if (!role) return { error: 'Wrong password.' };
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
