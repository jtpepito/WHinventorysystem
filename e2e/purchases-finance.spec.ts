import { expect, test } from '@playwright/test';
import { login } from './helpers';

const peso = (n: number) => `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test('encoder receives on account with a VAT invoice; admin pays it', async ({ page }) => {
  await login(page, 'encoder');
  await page.goto('/receive');
  await page.getByLabel('Supplier', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Supplier invoice no.').fill(`INV-E2E-${Date.now()}`);
  await page.getByLabel('Payment method').selectOption('credit');
  await page.getByLabel('VAT invoice').check();
  await page.getByLabel('Line 1 item').selectOption({ label: 'PL-001 — PPR Pipe 20mm x 4m' });
  await page.getByLabel('Line 1 qty').fill('5');
  await page.getByLabel('Line 1 unit cost').fill('224');
  await page.getByRole('button', { name: 'Post receipt' }).click();
  await expect(page.getByTestId('form-message')).toContainText(/Received 1 line\(s\) under INV-E2E-\d+ \(PUR-\d+\)\./);
  await page.goto('/purchases');
  await page.locator('a[href^="/purchases/"]').first().click();
  await expect(page.getByTestId('balance')).toHaveText(peso(1120));
  await expect(page.getByText('VAT 12%')).toBeVisible();
  const url = page.url();

  await login(page, 'admin');
  await page.goto(url);
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Method').selectOption('bank');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByTestId('form-message').filter({ hasText: /Payment PV-\d+ recorded\./ })).toBeVisible();
  await expect(page.getByTestId('balance')).toHaveText(peso(0));
});

test('admin records an expense and sees it in the ledger; manual journals respect the controlled accounts', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/expenses/new');
  await page.getByLabel('Account').selectOption({ label: '6100 Rent' });
  await page.getByLabel('Payee').fill('E2E Landlord');
  await page.getByLabel('Amount').fill('11200');
  await page.getByLabel('VAT invoice').check();
  await page.getByLabel('Paid by').selectOption('bank');
  await page.getByRole('button', { name: 'Save expense' }).click();
  await expect(page).toHaveURL(/\/expenses\?posted=EXP-\d+$/);
  await expect(page.getByText('E2E Landlord')).toBeVisible();
  await page.goto('/finance/ledger/6100');
  await expect(page.getByText(/EXP-\d+ Rent — E2E Landlord/).first()).toBeVisible();

  await page.goto('/finance/journal/new');
  await page.getByLabel('Date').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Memo').fill('Deposit cash to bank');
  await page.getByLabel('Line 1 account').selectOption({ label: '1030 Bank' });
  await page.getByLabel('Line 1 debit').fill('5000');
  await page.getByLabel('Line 2 account').selectOption({ label: '1010 Cash on hand' });
  await page.getByLabel('Line 2 credit').fill('5000');
  await page.getByRole('button', { name: 'Post entry' }).click();
  await expect(page).toHaveURL(/\/finance\/journal\?posted=JE-\d+$/);
  await expect(page.getByText('Deposit cash to bank').first()).toBeVisible();

  await page.goto('/finance/journal/new');
  await page.getByLabel('Memo').fill('Sneaky stock bump');
  await page.getByLabel('Line 1 account').selectOption({ label: '1200 Inventory' });
  await page.getByLabel('Line 1 debit').fill('1');
  await page.getByLabel('Line 2 account').selectOption({ label: '3100 Owner\'s capital' });
  await page.getByLabel('Line 2 credit').fill('1');
  await page.getByRole('button', { name: 'Post entry' }).click();
  await expect(page.getByTestId('form-message')).toContainText('use those screens');
});

test('closing a month blocks postings dated in it until it is reopened with a reason', async ({ page }) => {
  await login(page, 'admin');
  const today = new Date();
  const lastMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const inLastMonth = `${lastMonthEnd.slice(0, 7)}-15`;
  await page.goto('/finance/periods');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: `Close through ${lastMonthEnd}` }).click();
  await expect(page.getByText(`Closed through ${lastMonthEnd}`).first()).toBeVisible();

  await page.goto('/sales/new');
  await page.getByLabel('Date').fill(inLastMonth);
  await page.getByLabel('Line 1 item').selectOption({ index: 1 });
  await page.getByLabel('Line 1 qty').fill('1');
  await page.getByRole('button', { name: 'Post sale' }).click();
  await expect(page.getByTestId('form-message')).toContainText('is closed. Ask the admin to reopen it.');

  await page.goto('/finance/periods');
  await page.getByLabel('Reason for reopening').fill('E2E: found an unposted invoice');
  await page.getByRole('button', { name: 'Reopen everything' }).click();
  await expect(page.getByText('E2E: found an unposted invoice')).toBeVisible();
  await expect(page.getByText('All months are open.').first()).toBeVisible();
});

test('the journal lists a sale by its number', async ({ page }) => {
  await login(page, 'admin');
  await page.goto('/sales');
  const number = (await page.locator('td a[href^="/sales/"]').first().textContent()) ?? '';
  expect(number).toMatch(/^SI-/);
  await page.goto('/finance/journal');
  await page.getByLabel('Search memo').fill(number);
  await page.getByRole('button', { name: 'Filter' }).click();
  await expect(page.getByText(number).first()).toBeVisible();
});
