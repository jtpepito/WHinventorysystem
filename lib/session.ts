// Web Crypto only, so this file also runs in edge middleware.
export type Role = 'admin' | 'encoder';
export const SESSION_COOKIE = 'inv_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(data: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data))));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSession(role: Role, secret: string, nowMs: number): Promise<string> {
  const payload = `${role}.${nowMs + SESSION_TTL_MS}`;
  return `${payload}.${await hmac(payload, secret)}`;
}

export async function verifySession(token: string, secret: string, nowMs: number): Promise<Role | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [role, exp, sig] = parts;
  if (role !== 'admin' && role !== 'encoder') return null;
  const expMs = Number(exp);
  if (!Number.isSafeInteger(expMs) || expMs <= nowMs) return null;
  if (!safeEqual(sig, await hmac(`${role}.${exp}`, secret))) return null;
  return role;
}

const ENCODER_PREFIXES = ['/receive', '/release', '/count', '/items', '/movements'];

export function canAccess(role: Role, pathname: string): boolean {
  if (role === 'admin') return true;
  if (pathname === '/items/new' || /^\/items\/[^/]+\/edit\/?$/.test(pathname)) return false;
  return ENCODER_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function homeFor(role: Role): string {
  return role === 'admin' ? '/dashboard' : '/receive';
}
