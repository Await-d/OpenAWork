import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

const WEB_APP_ROOT = fileURLToPath(new URL('.', import.meta.url));
const GATEWAY_ROOT = fileURLToPath(new URL('../../services/agent-gateway/', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node e2e/mock-openai-upstream.mjs',
      cwd: WEB_APP_ROOT,
      reuseExistingServer: true,
      timeout: 120000,
      url: 'http://127.0.0.1:3312/health',
    },
    {
      command:
        'JWT_SECRET=change-me-in-production-min-32-chars GATEWAY_HOST=127.0.0.1 GATEWAY_PORT=3300 DATABASE_URL=:memory: AI_API_KEY=test-key AI_API_BASE_URL=http://127.0.0.1:3312 AI_DEFAULT_MODEL=gpt-5-live pnpm exec tsx src/index.ts',
      cwd: GATEWAY_ROOT,
      reuseExistingServer: true,
      timeout: 120000,
      url: 'http://127.0.0.1:3300/health',
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 4174',
      cwd: WEB_APP_ROOT,
      reuseExistingServer: true,
      timeout: 120000,
      url: 'http://127.0.0.1:4174',
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
