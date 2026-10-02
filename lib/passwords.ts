import { createHash, timingSafeEqual } from 'node:crypto';
import type { Role } from './session';

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

export function roleForPassword(input: string, cfg: { admin?: string; encoder?: string }): Role | null {
  if (!cfg.admin || !cfg.encoder) throw new Error('ADMIN_PASSWORD and ENCODER_PASSWORD must both be set.');
  if (cfg.admin === cfg.encoder) throw new Error('ADMIN_PASSWORD and ENCODER_PASSWORD must be different.');
  if (!input) return null;
  const d = digest(input);
  const isAdmin = timingSafeEqual(d, digest(cfg.admin));
  const isEncoder = timingSafeEqual(d, digest(cfg.encoder));
  return isAdmin ? 'admin' : isEncoder ? 'encoder' : null;
}
