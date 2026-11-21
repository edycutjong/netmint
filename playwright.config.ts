import { defineConfig, devices } from '@playwright/test';

// E2E runs against the DEPLOYED app by default: the judged flow must work on the live URL, with the real CMC key behind it.
// Override with E2E_BASE_URL (for example a Vercel preview, or http://localhost:3000 after `npm run build && npm start`).
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://netmint.edycu.dev',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
