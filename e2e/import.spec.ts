import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { login } from './helpers';

const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });

test('admin previews a CSV, sees row problems, fixes the file and imports with opening stock', async ({ page }) => {
  await login(page, 'admin');
  const run = Date.now().toString().slice(-6);
  const [a, b] = [`IMP-${run}-A`, `IMP-${run}-B`];
  const category = `Imported ${run}`;

  await page.goto('/items');
  await page.getByRole('link', { name: 'Import from CSV' }).click();
  await expect(page).toHaveURL(/\/items\/import$/);

  const [template] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download the template' }).click()]);
  expect(fs.readFileSync((await template.path())!, 'utf8')).toContain('SKU,Name,Category,Unit,Reorder point,Qty on hand,Unit cost');

  // A file with a problem: preview only, nothing saved, no import button.
  await page.getByLabel('CSV file').setInputFiles(file('stock.csv', `SKU,Name,Category,Unit,Qty on hand,Unit cost\r\n${a},Wire,${category},roll,10,2450\r\n${b},Switch,${category},pc,5,\r\n`));
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('import-summary')).toContainText('1 row has problems');
  await expect(page.getByText('Unit cost is required when there is stock.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Import \d+ items?$/ })).toHaveCount(0);

  // Fixed file: preview shows what will be created, then import.
  await page.getByLabel('CSV file').setInputFiles(file('stock.csv', `SKU,Name,Category,Unit,Qty on hand,Unit cost,Reorder point\r\n${a},Wire,${category},roll,10,2450,2\r\n${b},Switch,${category},pc,5,65,1\r\n`));
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('import-summary')).toContainText('2 items ready to import');
  await expect(page.getByTestId('import-summary')).toContainText(`New category: ${category}`);
  await page.getByRole('button', { name: 'Import 2 items' }).click();

  await expect(page).toHaveURL(/\/items\?imported=2/);
  await expect(page.getByTestId('form-message')).toContainText('Imported 2 items. Opening stock for 2 posted under OPENING-');
  await page.getByRole('link', { name: a }).click();
  await expect(page.getByTestId('qty-on-hand')).toHaveText('10');
  await expect(page.getByTestId('avg-cost')).toHaveText('₱2,450.00');
  await expect(page.getByTestId('movement-row')).toContainText('Opening balance');
});

test('encoders cannot reach the import', async ({ page }) => {
  await login(page, 'encoder');
  await page.goto('/items');
  await expect(page.getByRole('link', { name: 'Import from CSV' })).toHaveCount(0);
  await page.goto('/items/import');
  await expect(page).toHaveURL(/\/receive\?denied=1$/);
});
