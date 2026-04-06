import { expect, test, type Page } from '@playwright/test';

const GATEWAY_URL = 'http://localhost:3000';

interface MockRouteResponse {
  body: unknown;
  status?: number;
}

type MockRouteMap = Record<string, MockRouteResponse>;

async function primeAuthenticatedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ gatewayUrl }) => {
      localStorage.setItem(
        'auth-store',
        JSON.stringify({
          state: {
            accessToken: 'token-123',
            refreshToken: 'refresh-123',
            tokenExpiresAt: Date.now() + 60 * 60 * 1000,
            email: 'tester@openawork.local',
            gatewayUrl,
            webAccessEnabled: false,
            webPort: 3000,
          },
          version: 0,
        }),
      );
      localStorage.setItem('onboarded', '1');
      localStorage.setItem('telemetry_consent_shown', '1');
    },
    { gatewayUrl: GATEWAY_URL },
  );
}

async function mockSettingsUsageRequests(page: Page, overrides: MockRouteMap = {}): Promise<void> {
  const defaultResponses: MockRouteMap = {
    '/settings/providers': {
      body: {
        providers: [
          {
            id: 'openai',
            name: 'OpenAI',
            type: 'openai',
            enabled: true,
            defaultModels: [{ id: 'gpt-5', label: 'GPT-5', enabled: true }],
          },
        ],
        activeSelection: {
          chat: { providerId: 'openai', modelId: 'gpt-5' },
          fast: { providerId: 'openai', modelId: 'gpt-5' },
        },
      },
    },
    '/settings/mcp-servers': { body: { servers: [] } },
    '/usage/records': {
      body: {
        records: [
          {
            month: '2026-03',
            totalCostUsd: 8.5,
            totalInputTokens: 1500,
            totalOutputTokens: 3400,
            byProvider: { openai: 8.5 },
          },
        ],
        budgetUsd: 10,
      },
    },
    '/usage/breakdown': {
      body: {
        monthlyCostUsd: 8.5,
        breakdown: [{ modelName: 'gpt-5', inputCost: 2.5, outputCost: 6, totalCost: 8.5 }],
      },
    },
    '/settings/permissions': { body: { decisions: [] } },
    '/settings/dev-logs': { body: { logs: [] } },
    '/settings/mcp-status': { body: { servers: [] } },
    '/settings/workers': { body: { workers: [] } },
    '/settings/diagnostics': { body: { diagnostics: [] } },
    '/settings/model-prices': {
      body: { models: [{ modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 }] },
    },
    '/desktop-automation/status': { body: { enabled: false } },
    '/ssh/connections': { body: { connections: [] } },
    '/channels': { body: { channels: [] } },
  };

  await page.route(`${GATEWAY_URL}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    const response = overrides[pathname] ?? defaultResponses[pathname];

    if (response) {
      await route.fulfill({
        status: response.status ?? 200,
        contentType: 'application/json',
        body: JSON.stringify(response.body),
      });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `Unhandled mock path: ${pathname}` }),
    });
  });
}

test.describe('Settings usage', () => {
  test('Given usage data When visiting settings usage Then shows budget summary and model prices', async ({
    page,
  }) => {
    await primeAuthenticatedSession(page);
    await mockSettingsUsageRequests(page);

    await page.goto('/settings/usage');

    await expect(page).toHaveURL(/\/settings\/usage$/);
    await expect(page.getByText('接近预算：$8.5000 / $10.0000')).toBeVisible();
    await page.getByText('gpt-5').first().scrollIntoViewIfNeeded();
    await expect(page.getByText('gpt-5').first()).toBeVisible();
    await expect(page.getByText('OpenAI').first()).toBeVisible();
    await expect(page.getByText('$1.25').first()).toBeVisible();
    await expect(page.getByText('$5.00').first()).toBeVisible();
  });

  test('Given usage records API failure When visiting settings usage Then shows explicit error state', async ({
    page,
  }) => {
    await primeAuthenticatedSession(page);
    await mockSettingsUsageRequests(page, {
      '/usage/records': {
        status: 503,
        body: { error: '用量服务暂不可用' },
      },
    });

    await page.goto('/settings/usage');

    const failureNotice = page.getByRole('alert').first();
    await expect(failureNotice).toContainText('用量记录加载失败');
    await expect(failureNotice).toContainText('用量服务暂不可用');
    await expect(page.getByText('暂无用量数据。')).toHaveCount(0);
  });
});
