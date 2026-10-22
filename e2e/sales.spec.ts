import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function onHand(page: Page, sku: string): Promise<number> {
  await page.goto('/items?q=' + sku);
  await page.getByRole('link', { name: sku, exact: true }).click();
  const text = await page.getByTestId('qty-on-hand').textContent();
  return Number((text ?? '0').replace(/,/g, ''));
}

async function fillSale(page: Page, opts: { customer?: string; method: string; item: string; qty: string }) {
  await page.goto('/sales/new');
  if (opts.customer) await page.getByLabel('Customer').selectOption({ label: opts.customer });
  await page.getByLabel('Payment method').selectOption(opts.method);
  await page.getByLabel('Line 1 item').selectOption({ label: opts.item });
  await page.getByLabel('Line 1 qty').fill(opts.qty);
}

test('admin posts a cash sale, sees stock and the journal move, prints and voids it', async ({ page }) => {
  await login(page, 'admin');
  const before = await onHand(page, 'EL-003');
  await fillSale(page, { method: 'cash', item: 'EL-003 — Convenience Outlet, Duplex', qty: '2' });
  const price = Number(await page.getByLabel('Line 1 price').inputValue());
  expect(price).toBeGreaterThan(0);
  await expect(page.getByTestId('sale-total')).toHaveText(peso(2 * price));
  await page.getByRole('button', { name: 'Post sale' }).click();
  await expect(page).toHaveURL(/\/sales\/\d+\?posted=1$/);
  await expect(page.getByTestId('form-message')).toContainText(/Sale SI-\d+ posted\./);
  const number = (await page.getByRole('heading', { level: 1 }).textContent())?.match(/SI-\d+/)?.[0] ?? '';
  expect(number).toMatch(/^SI-/);
  await expect(page.getByText('Void sale')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Print receipt' }).click();
  await expect(page.getByText('VAT-inclusive')).toBeVisible();
  await expect(page.getByText(number)).toBeVisible();
  await page.goBack();

  expect(await onHand(page, 'EL-003')).toBe(before - 2);

  await page.goto(`/sales`);
  await page.getByRole('link', { name: number }).click();
  await page.getByRole('button', { name: 'Void sale' }).click();
  await page.getByLabel('Reason').fill('Customer changed their mind');
  await page.getByRole('button', { name: 'Confirm void' }).click();
  await expect(page.getByTestId('form-message')).toContainText(/voided/i);
  await expect(page.getByText('Void', { exact: true })).toBeVisible();
  expect(await onHand(page, 'EL-003')).toBe(before);
});

test('encoder posts an on-account sale and records a partial payment', async ({ page }) => {
  await login(page, 'encoder');
  await fillSale(page, { customer: 'Reyes Builders', method: 'credit', item: 'PL-001 — PPR Pipe 20mm x 4m', qty: '3' });
  const total = (await page.getByTestId('sale-total').textContent()) ?? '';
  await page.getByRole('button', { name: 'Post sale' }).click();
  await expect(page).toHaveURL(/\/sales\/\d+\?posted=1$/);
  await expect(page.getByTestId('balance')).toHaveText(total);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('100');
  await page.getByLabel('Method').selectOption('gcash');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByTestId('form-message').filter({ hasText: /Payment CR-\d+ recorded\./ })).toBeVisible();
  const numeric = Number(total.replace(/[₱,]/g, ''));
  await expect(page.getByTestId('balance')).toHaveText(peso(numeric - 100));
  await expect(page.getByText('Void sale')).toHaveCount(0);
});

test('customer card shows the open balance', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/customers');
  await page.getByRole('link', { name: 'Reyes Builders' }).click();
  await expect(page.getByRole('heading', { name: 'Reyes Builders' })).toBeVisible();
  await expect(page.getByTestId('customer-balance')).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await page.getByLabel('Credit terms (days)').fill('45');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByText('45 days')).toBeVisible();
});
