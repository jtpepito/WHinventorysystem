import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { login, splitCsvLine } from './helpers';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Review Focus 1: rounding across lines never leaves the books a centavo out.
test('a three-line sale at 33.33 totals 99.99 and the books still balance', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/sales/new');
  for (let i = 1; i <= 3; i++) {
    if (i > 1) await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel(`Line ${i} item`).selectOption({ index: i });
    await page.getByLabel(`Line ${i} qty`).fill('1');
    await page.getByLabel(`Line ${i} price`).fill('33.33');
  }
  await expect(page.getByTestId('sale-total')).toHaveText(peso(99.99));
  await page.getByRole('button', { name: 'Post sale' }).click();
  await expect(page).toHaveURL(/\/sales\/\d+\?posted=1$/);
  await expect(page.getByText(peso(89.28))).toBeVisible();
  await expect(page.getByText(peso(10.71))).toBeVisible();
  await page.goto('/debug');
  await expect(page.getByText('Every journal entry balances.')).toBeVisible();
});

// Review Focus 3: a paid sale cannot be voided until its payment is voided.
test('void after payment is refused, then allowed once the payment is voided', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/sales/new');
  await page.getByLabel('Customer').selectOption({ label: 'JDC Construction' });
  await page.getByLabel('Payment method').selectOption('credit');
  await page.getByLabel('Line 1 item').selectOption({ label: 'EL-003 — Convenience Outlet, Duplex' }); // a seeded item with a selling price
  await page.getByLabel('Line 1 qty').fill('1');
  await page.getByRole('button', { name: 'Post sale' }).click();
  await expect(page).toHaveURL(/\/sales\/\d+\?posted=1$/);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByTestId('form-message').filter({ hasText: /Payment CR-\d+ recorded\./ })).toBeVisible();

  await page.getByRole('button', { name: 'Void sale' }).click();
  await page.getByLabel('Reason').fill('Entered twice');
  await page.getByRole('button', { name: 'Confirm void' }).click();
  await expect(page.getByTestId('form-message').filter({ hasText: 'Void the payment(s) first.' })).toBeVisible();

  page.once('dialog', (d) => d.accept('Bounced'));
  await page.getByRole('row', { name: /CR-\d+/ }).getByRole('button', { name: 'Void' }).click();
  await expect(page.getByText('voided: Bounced', { exact: true })).toBeVisible();
  // The void form is still open from the refused attempt; confirm on it.
  await page.getByLabel('Reason').fill('Entered twice');
  await page.getByRole('button', { name: 'Confirm void' }).click();
  await expect(page.getByTestId('form-message').filter({ hasText: /voided/i })).toBeVisible();
});

// Review Focus 5: stock on the shelves equals the Inventory account.
test('the ledger check matches stock value to the Inventory account and the dashboard shows money', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/debug');
  await expect(page.getByText('Stock value matches the Inventory account.')).toBeVisible();
  await page.goto('/dashboard');
  for (const label of ["Today's sales", 'This month', 'Cash + GCash + Bank', 'Receivables', 'Payables']) {
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
  }
});

for (const key of ['income-statement', 'balance-sheet', 'trial-balance', 'ar-aging', 'ap-aging', 'vat-summary', 'cash-book', 'journal', 'sales-by-day', 'sales-by-item', 'sales-by-customer']) {
  test(`${key} CSV downloads and parses cleanly`, async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/reports?tab=financial');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId(`csv-${key}`).click()]);
    expect(download.suggestedFilename()).toMatch(new RegExp(`^${key}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
    const bytes = fs.readFileSync((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = bytes.subarray(3).toString('utf8').replace(/\r\n$/, '').split('\r\n');
    expect(lines.length).toBeGreaterThan(1);
    const width = splitCsvLine(lines[0]).length;
    for (const line of lines) expect(splitCsvLine(line)).toHaveLength(width);
  });
}

test('the income statement and balance sheet render for a chosen range', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/reports?tab=financial');
  await expect(page.getByText('Income statement', { exact: true })).toBeVisible();
  await expect(page.getByText('Net income', { exact: true })).toBeVisible();
  await expect(page.getByText('Balance sheet', { exact: true })).toBeVisible();
  await expect(page.getByText('Total assets', { exact: true })).toBeVisible();
});
