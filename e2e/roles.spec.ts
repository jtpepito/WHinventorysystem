import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('wrong password is rejected', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('form-message')).toHaveText('Wrong password.');
});

test('pages render in the app font, not the browser serif fallback', async ({ page }) => {
  await page.goto('/login');
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(family).toMatch(/Geist/);
});

test('signed-out visitors are sent to login', async ({ page }) => {
  await page.goto('/items');
  await expect(page).toHaveURL(/\/login$/);
});

test('encoder cannot see reports or edit items', async ({ page }) => {
  await login(page, 'encoder');
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Receive' })).toBeVisible();
  for (const hidden of ['Dashboard', 'Reports', 'Settings', 'Ledger check']) {
    await expect(nav.getByRole('link', { name: hidden })).toHaveCount(0);
  }
  await page.goto('/reports');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
  await expect(page.getByText('That page is for admins only.')).toBeVisible();
  const csv = await page.request.get('/reports/csv/low-stock', { maxRedirects: 0 });
  expect(csv.status()).toBe(307);

  await page.goto('/items');
  await expect(page.getByRole('link', { name: 'New item' })).toHaveCount(0);
  await page.getByRole('link', { name: 'EL-001' }).click();
  await expect(page.getByRole('heading', { name: /THHN Wire 2\.0/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await page.goto('/items/1/edit');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
  await page.goto('/items/new');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
});

test('admin reaches every page', async ({ page }) => {
  await login(page, 'admin');
  for (const p of ['/dashboard', '/items', '/receive', '/release', '/count', '/movements', '/reports', '/settings', '/debug']) {
    await page.goto(p);
    await expect(page).toHaveURL(new RegExp(`${p}$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});
