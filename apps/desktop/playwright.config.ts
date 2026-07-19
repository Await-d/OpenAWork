import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'http://127.0.0.1:1420',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm vite:dev',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: !process.env['CI'],
    timeout: 30000,
  },
});
