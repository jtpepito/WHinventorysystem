import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers';

// Buttons are disabled while a post is in flight, so act only once the form is idle again —
// as a person would. The warning text repeats exactly, so it can't be used to detect the response.
async function idle(page: Page, button: string) {
  await expect(page.getByRole('button', { name: button })).toBeEnabled();
}

async function submitAndWait(page: Page, action: () => Promise<void>, button: string) {
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), action()]);
  await idle(page, button);
}

test('a repeated receipt reference warns once and can be posted anyway', async ({ page }) => {
  await login(page, 'admin');
  const fill = async (ref: string) => {
    await page.getByLabel('Supplier').selectOption({ index: 1 });
    await page.getByLabel('Reference no.').fill(ref);
    await page.getByLabel('Line 1 item').selectOption({ index: 1 });
    await page.getByLabel('Line 1 qty').fill('1');
    await page.getByLabel('Line 1 unit cost').fill('10');
  };
  const postReceipt = page.getByRole('button', { name: 'Post receipt' });
  const postAnyway = page.getByRole('button', { name: 'Post anyway' });
  const message = page.getByTestId('form-message');

  // Unique per run, so repeats don't collide with references left by an earlier run.
  const ref = `DUP-${Date.now()}`;
  await page.goto('/receive');
  await fill(ref);
  await submitAndWait(page, () => postReceipt.click(), 'Post receipt');
  await expect(message).toHaveText(`Received 1 line(s) under ${ref}.`);

  await fill(ref.toLowerCase());
  await submitAndWait(page, () => postReceipt.click(), 'Post receipt');
  await expect(message).toContainText(`Reference ${ref} from`);
  await expect(message).toContainText("Check this isn't the same delivery entered twice.");
  await expect(postAnyway).toBeVisible();

  // Enter submits with the form's first submit button; that must be the main one, so Enter
  // can't skip the warning. (Checked structurally: a key press 7 ms after a re-render is racy in tests.)
  const firstSubmit = await page.getByLabel('Reference no.').evaluate((el) => (el as HTMLInputElement).form?.querySelector('[type=submit]')?.textContent?.trim());
  expect(firstSubmit).toBe('Post receipt');

  // Editing the reference withdraws the override.
  await page.getByLabel('Reference no.').fill(`${ref.toLowerCase()}x`);
  await expect(postAnyway).toHaveCount(0);
  await page.getByLabel('Reference no.').fill(ref.toLowerCase());
  await expect(postAnyway).toBeVisible();
  await submitAndWait(page, () => postAnyway.click(), 'Post receipt');
  await expect(message).toHaveText(`Received 1 line(s) under ${ref.toLowerCase()}.`);
});

test('a repeated release reference warns too', async ({ page }) => {
  await login(page, 'encoder');
  const ref = `DUP-DR-${Date.now()}`;
  const fill = async () => {
    await page.getByLabel('Destination / customer').fill('Walk-in');
    await page.getByLabel('Reference no.').fill(ref);
    await page.getByLabel('Line 1 item').selectOption({ index: 1 });
    await page.getByLabel('Line 1 qty').fill('1');
  };
  const postRelease = page.getByRole('button', { name: 'Post release' });
  const message = page.getByTestId('form-message');
  await page.goto('/release');
  await fill();
  await submitAndWait(page, () => postRelease.click(), 'Post release');
  await expect(message).toHaveText(`Released 1 line(s) under ${ref}.`);
  await fill();
  await submitAndWait(page, () => postRelease.click(), 'Post release');
  await expect(message).toContainText(`Reference ${ref} was already used for a release to Walk-in`);
  await submitAndWait(page, () => page.getByRole('button', { name: 'Post anyway' }).click(), 'Post release');
  await expect(message).toHaveText(`Released 1 line(s) under ${ref}.`);
});
