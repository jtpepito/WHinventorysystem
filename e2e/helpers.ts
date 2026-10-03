import { expect, type Page } from '@playwright/test';
import { E2E } from './creds';

export async function login(page: Page, who: 'admin' | 'encoder') {
  await page.goto('/login');
  await page.getByLabel('Password').fill(E2E[who]);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(who === 'admin' ? /\/dashboard/ : /\/receive/);
}

// Quote-aware CSV line splitter (enough for checking column counts).
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
