import { defineConfig, devices } from '@playwright/test';
import { E2E } from './e2e/creds';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  fullyParallel: false,
  // Server actions on a busy shop PC can take a few seconds; 5s default flaked under load.
  expect: { timeout: 15_000 },
  use: { baseURL: 'http://localhost:3217', trace: 'retain-on-failure', acceptDownloads: true },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node scripts/reset-e2e-db.mjs && npx next build && npx next start -p 3217',
    url: 'http://localhost:3217/login',
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      DB_PATH: 'data/e2e.db',
      ADMIN_PASSWORD: E2E.admin,
      ENCODER_PASSWORD: E2E.encoder,
      SESSION_SECRET: 'e2e-secret-0123456789abcdef0123456789abcdef',
    },
  },
});
