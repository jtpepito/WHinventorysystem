import { expect, test } from '@playwright/test';
import { login } from './helpers';

const ITEM_LABEL = 'E2E-001 — E2E Test Widget';

test('receive → weighted average, release block, count variance, ledger match', async ({ page }) => {
  await login(page, 'admin');

  await page.goto('/items/new');
  await page.getByLabel('SKU').fill('E2E-001');
  await page.getByLabel('Name').fill('E2E Test Widget');
  await page.getByLabel('Category').selectOption({ label: 'Tools' });
  await page.getByLabel('Unit').selectOption({ label: 'pc' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Test Widget' })).toBeVisible();
  const itemUrl = page.url();

  for (const [ref, cost] of [['E2E-R1', '50'], ['E2E-R2', '100']]) {
    await page.goto('/receive');
    await page.getByLabel('Supplier').selectOption({ index: 1 });
    await page.getByLabel('Reference no.').fill(ref);
    await page.getByLabel('Line 1 item').selectOption({ label: ITEM_LABEL });
    await page.getByLabel('Line 1 qty').fill('10');
    await page.getByLabel('Line 1 unit cost').fill(cost);
    await page.getByRole('button', { name: 'Post receipt' }).click();
    await expect(page.getByTestId('form-message')).toContainText(`Received 1 line(s) under ${ref}`);
  }
  await page.goto(itemUrl);
  await expect(page.getByTestId('qty-on-hand')).toHaveText('20');
  await expect(page.getByTestId('avg-cost')).toHaveText('₱75.00');

  await page.goto('/release');
  await page.getByLabel('Destination / customer').fill('E2E Customer');
  await page.getByLabel('Reference no.').fill('E2E-D1');
  await page.getByLabel('Line 1 item').selectOption({ label: ITEM_LABEL });
  await page.getByLabel('Line 1 qty').fill('25');
  await page.getByRole('button', { name: 'Post release' }).click();
  await expect(page.getByTestId('form-message')).toHaveText('Cannot release 25 pc of E2E Test Widget (E2E-001) — only 20 on hand.');
  await expect(page.getByLabel('Destination / customer')).toHaveValue('E2E Customer');

  await page.goto('/count');
  await page.getByLabel('Category').selectOption({ label: 'Tools' });
  await page.getByRole('button', { name: 'Start count' }).click();
  await expect(page).toHaveURL(/\/count\/\d+$/);
  await page.getByLabel('Actual for E2E-001').fill('17');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Post count' }).click();
  await expect(page.getByTestId('form-message')).toContainText('Count posted. 1 adjustment(s) created.');

  await page.goto(itemUrl);
  await expect(page.getByTestId('qty-on-hand')).toHaveText('17');
  const adjust = page.getByTestId('movement-row').filter({ hasText: 'count variance' });
  await expect(adjust).toHaveCount(1);
  await expect(adjust).toContainText('−3');

  await page.goto('/debug');
  await expect(page.getByText('All items match the ledger.')).toBeVisible();
});
