import { expect, test } from '@playwright/test';

const GATEWAY_URL = 'http://127.0.0.1:3300';

async function loginAndPrepareSession(
  request: import('@playwright/test').APIRequestContext,
): Promise<{
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}> {
  const loginResponse = await request.post(`${GATEWAY_URL}/auth/login`, {
    data: {
      email: 'admin@openAwork.local',
      password: 'admin123456',
    },
  });
  expect(loginResponse.ok()).toBeTruthy();
  const loginPayload = (await loginResponse.json()) as {
    accessToken: string;
    refreshToken: string;
  };

  const providerResponse = await request.put(`${GATEWAY_URL}/settings/providers`, {
    data: {
      providers: [
        {
          id: 'openai-live',
          type: 'openai',
          name: 'OpenAI Live',
          enabled: true,
          baseUrl: 'http://127.0.0.1:3312',
          apiKey: 'test-key',
          defaultModels: [{ id: 'gpt-5-live', label: 'GPT-5 Live', enabled: true }],
        },
      ],
      activeSelection: {
        chat: { providerId: 'openai-live', modelId: 'gpt-5-live' },
        fast: { providerId: 'openai-live', modelId: 'gpt-5-live' },
      },
    },
    headers: {
      Authorization: `Bearer ${loginPayload.accessToken}`,
    },
  });
  expect(providerResponse.ok()).toBeTruthy();

  const sessionResponse = await request.post(`${GATEWAY_URL}/sessions`, {
    data: { metadata: {} },
    headers: {
      Authorization: `Bearer ${loginPayload.accessToken}`,
    },
  });
  expect(sessionResponse.ok()).toBeTruthy();
  const sessionPayload = (await sessionResponse.json()) as { sessionId: string };

  return {
    accessToken: loginPayload.accessToken,
    refreshToken: loginPayload.refreshToken,
    sessionId: sessionPayload.sessionId,
  };
}

test.describe.serial('Chat attach live recovery', () => {
  test('refreshes during a real gateway stream and settles into the final assistant message', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request);

    await page.addInitScript(
      ({ accessToken, refreshToken, gatewayUrl }) => {
        localStorage.setItem(
          'auth-store',
          JSON.stringify({
            state: {
              accessToken,
              refreshToken,
              tokenExpiresAt: Date.now() + 60 * 60 * 1000,
              email: 'admin@openawork.local',
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
      {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        gatewayUrl: GATEWAY_URL,
      },
    );

    await page.goto(`/chat/${auth.sessionId}`);

    const composer = page.getByRole('textbox', {
      name: '发送消息…（Enter 发送，Shift+Enter 换行）',
    });
    await composer.fill('请执行真实 gateway 刷新恢复验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('实时续流第一段')).toBeVisible({ timeout: 10_000 });
    await page.reload();

    await expect(page.getByText('请执行真实 gateway 刷新恢复验证')).toBeVisible();
    await expect(page.getByText('实时续流第一段')).toBeVisible();
    await expect(page.getByText('会话持续运行中')).toBeVisible();

    await expect(page.locator('body')).toContainText('实时续流第一段实时续流第二段', {
      timeout: 15_000,
    });
    await expect(page.getByText('会话持续运行中')).toHaveCount(0);
    await expect(page.getByText('当前运行流仍受此页控制')).toHaveCount(0);
  });

  test('can stop the recovered stream after refresh and settles into cancelled state', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request);

    await page.addInitScript(
      ({ accessToken, refreshToken, gatewayUrl }) => {
        localStorage.setItem(
          'auth-store',
          JSON.stringify({
            state: {
              accessToken,
              refreshToken,
              tokenExpiresAt: Date.now() + 60 * 60 * 1000,
              email: 'admin@openawork.local',
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
      {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        gatewayUrl: GATEWAY_URL,
      },
    );

    await page.goto(`/chat/${auth.sessionId}`);

    const composer = page.getByRole('textbox', {
      name: '发送消息…（Enter 发送，Shift+Enter 换行）',
    });
    await composer.fill('请执行真实 gateway 刷新后停止验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('实时续流第一段')).toBeVisible({ timeout: 10_000 });
    await page.reload();

    await expect(page.getByText('请执行真实 gateway 刷新后停止验证')).toBeVisible();
    await expect(page.getByText('实时续流第一段')).toBeVisible();
    await expect(page.getByText('当前运行流仍受此页控制')).toBeVisible();

    await page.getByRole('button', { name: '停止' }).click();

    await expect(page.getByRole('button', { name: '停止' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('当前运行流仍受此页控制')).toHaveCount(0);
    await expect(page.getByText('会话持续运行中')).toHaveCount(0);

    await page.waitForTimeout(7000);
    await expect(page.getByText('实时续流第二段')).toHaveCount(0);
  });
});
