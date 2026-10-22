import { expect, type Page, test } from '@playwright/test';
import { E2E } from './creds';

// Each attempt waits for its own server response: checking the message early would read the
// previous attempt's text and let the next submit fire while an action is still pending.
async function attempt(page: Page, password: string): Promise<string> {
  await page.getByLabel('Password').fill(password);
  await Promise.all([page.waitForResponse((r) => r.request().method() === 'POST'), page.getByRole('button', { name: 'Sign in' }).click()]);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  return (await page.getByTestId('form-message').textContent()) ?? '';
}

// Runs last (files run alphabetically): it locks this client out of login for a minute.
test('five wrong passwords lock the login, even for the right password', async ({ page }) => {
  await page.goto('/login');
  let locked = false;
  // roles.spec already spent one wrong attempt from this client; count to the lock regardless.
  for (let i = 0; i < 5 && !locked; i++) {
    const message = await attempt(page, `wrong-${i}`);
    expect(message).toMatch(/Wrong password\.|Too many wrong passwords/);
    locked = message.startsWith('Too many');
  }
  const message = await attempt(page, E2E.admin);
  expect(message).toMatch(/^Too many wrong passwords\. Try again in \d+ (seconds?|minutes?)\.$/);
  await expect(page).toHaveURL(/\/login$/);
});
