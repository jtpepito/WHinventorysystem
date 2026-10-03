import { expect, test } from '@playwright/test';
import { E2E } from './creds';

// Runs last (files run alphabetically): it locks this client out of login for a minute.
test('five wrong passwords lock the login, even for the right password', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel('Password');
  const signIn = page.getByRole('button', { name: 'Sign in' });
  const message = page.getByTestId('form-message');
  // roles.spec already spent one wrong attempt from this client; count to the lock regardless.
  for (let i = 0; i < 5; i++) {
    await password.fill(`wrong-${i}`);
    await signIn.click();
    await expect(message).toHaveText(/Wrong password\.|Too many wrong passwords/);
    if ((await message.textContent())?.startsWith('Too many')) break;
  }
  await password.fill(E2E.admin);
  await signIn.click();
  await expect(message).toHaveText(/^Too many wrong passwords\. Try again in \d+ (seconds?|minutes?)\.$/);
  await expect(page).toHaveURL(/\/login$/);
});
