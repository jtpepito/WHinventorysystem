import { expect, test } from '@playwright/test';
import { login } from './helpers';

// Each prefetch of a dynamic page is a full server render; 40 rows of links must not fire 80 of them.
test('items list does not prefetch every item card', async ({ page }) => {
  await login(page, 'admin');
  const prefetches: string[] = [];
  page.on('request', (r) => {
    if (/\/items\/\d+\?_rsc=/.test(r.url())) prefetches.push(r.url());
  });
  await page.goto('/items');
  await page.waitForLoadState('networkidle');
  expect(prefetches.length).toBeLessThan(5);
});
