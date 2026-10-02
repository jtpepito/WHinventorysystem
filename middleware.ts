import { NextResponse, type NextRequest } from 'next/server';
import { canAccess, homeFor, SESSION_COOKIE, verifySession } from '@/lib/session';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login') return NextResponse.next();
  const secret = process.env.SESSION_SECRET ?? '';
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const role = token && secret.length >= 32 ? await verifySession(token, secret, Date.now()) : null;
  if (!role) return NextResponse.redirect(new URL('/login', req.url));
  if (pathname === '/') return NextResponse.redirect(new URL(homeFor(role), req.url));
  if (!canAccess(role, pathname)) return NextResponse.redirect(new URL(`${homeFor(role)}?denied=1`, req.url));
  return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
