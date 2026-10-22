import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('encoders see sales, customers and purchases, never finance', async ({ page }) => {
  await login(page, 'encoder');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const shown of ['Sales', 'Customers', 'Purchases', 'Receive']) await expect(nav.getByRole('link', { name: shown, exact: true })).toBeVisible();
  for (const hidden of ['Expenses', 'Finance', 'Reports', 'Settings', 'Dashboard']) await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  await page.goto('/expenses');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
  await page.goto('/finance/journal');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
});

test('admin settings carry business details, VAT, accounts and prices', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/settings');
  await page.getByLabel('Business name').fill('WWJ Trading Corp');
  await page.getByLabel('TIN').fill('123-456-789-000');
  await page.getByRole('button', { name: 'Save business details' }).click();
  await expect(page.getByText('Business details saved.')).toBeVisible();
  await expect(page.getByLabel('Business name')).toHaveValue('WWJ Trading Corp');

  // The sample book has entries, so the VAT switch asks for confirmation.
  await expect(page.getByText(/does not restate history/)).toBeVisible();

  await page.getByLabel('New account code').fill('6700');
  await page.getByLabel('New account name').fill('Marketing');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByText('6700', { exact: true })).toBeVisible();

  const price = page.getByLabel('Sell price for EL-001');
  await price.fill('2,999.50');
  await page.getByRole('button', { name: /^Save \d+ price/ }).click();
  await expect(page.getByText('Saved 1 sell price(s).')).toBeVisible();
  await expect(page.getByLabel('Sell price for EL-001')).toHaveValue('2999.5');
});
