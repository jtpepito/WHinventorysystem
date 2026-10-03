import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('an item with stock history has its unit locked, other fields still save', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/items');
  await page.getByRole('link', { name: 'EL-002' }).click();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Unit')).toBeDisabled();
  await expect(page.getByText('Locked: this item already has stock history in roll.')).toBeVisible();
  await page.getByLabel('Name').fill('THHN Wire 3.5mm² (150m) — black');
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'THHN Wire 3.5mm² (150m) — black' })).toBeVisible();
  await expect(page.getByText('EL-002 · Electrical · per roll')).toBeVisible();
});

test('a new item with no history can still change unit', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/items/new');
  const sku = `U-${Date.now()}`;
  await page.getByLabel('SKU').fill(sku);
  await page.getByLabel('Name').fill('Unit test item');
  await page.getByLabel('Category').selectOption({ label: 'Tools' });
  await page.getByLabel('Unit').selectOption({ label: 'pc' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByRole('heading', { name: 'Unit test item' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByLabel('Unit')).toBeEnabled();
  await page.getByLabel('Unit').selectOption({ label: 'box' });
  await page.getByRole('button', { name: 'Save item' }).click();
  await expect(page.getByText(`${sku.toUpperCase()} · Tools · per box`)).toBeVisible();
});
