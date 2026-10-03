import { expect, test } from '@playwright/test';
import { login } from './helpers';

test('an open count can be discarded and disappears from the list', async ({ page }) => {
  await login(page, 'encoder');
  await page.goto('/count');
  await page.getByLabel('Category').selectOption({ label: 'Paint' });
  await page.getByRole('button', { name: 'Start count' }).click();
  await expect(page).toHaveURL(/\/count\/\d+$/);
  await page.getByLabel('Actual for PT-001').fill('1');

  // Cancelling the confirmation keeps the count.
  page.once('dialog', (d) => d.dismiss());
  await page.getByRole('button', { name: 'Discard count' }).click();
  await expect(page).toHaveURL(/\/count\/\d+$/);

  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Discard count' }).click();
  await expect(page).toHaveURL(/\/count\?discarded=1$/);
  await expect(page.getByTestId('form-message')).toHaveText('Count discarded. Nothing was posted.');
  await expect(page.getByText('Open', { exact: true })).toHaveCount(0);
});
