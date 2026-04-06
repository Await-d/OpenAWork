import { expect, test } from '@playwright/test';

const GATEWAY_URL = 'http://127.0.0.1:3300';

async function loginAndPrepareSession(
  request: import('@playwright/test').APIRequestContext,
  options?: {
    modelId?: string;
    modelLabel?: string;
    providerBaseUrl?: string;
    providerId?: string;
    providerName?: string;
    providerType?: 'custom' | 'openai';
  },
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

  const providerId = options?.providerId ?? 'openai-live';
  const providerType = options?.providerType ?? 'openai';
  const providerName = options?.providerName ?? 'OpenAI Live';
  const providerBaseUrl = options?.providerBaseUrl ?? 'http://127.0.0.1:3312';
  const modelId = options?.modelId ?? 'gpt-5-live';
  const modelLabel = options?.modelLabel ?? 'GPT-5 Live';

  const providerResponse = await request.put(`${GATEWAY_URL}/settings/providers`, {
    data: {
      providers: [
        {
          id: providerId,
          type: providerType,
          name: providerName,
          enabled: true,
          baseUrl: providerBaseUrl,
          apiKey: 'test-key',
          defaultModels: [{ id: modelId, label: modelLabel, enabled: true }],
        },
      ],
      activeSelection: {
        chat: { providerId, modelId },
        fast: { providerId, modelId },
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
    await expect(page.locator('body')).toContainText(/当前运行流仍受此页控制|当前页未接管原始请求/);

    const stopResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/stream/stop') || response.url().includes('/stream/stop-active'),
    );
    await page.getByRole('button', { name: '停止' }).click();
    const stopResponse = await stopResponsePromise;
    expect(stopResponse.ok()).toBeTruthy();
    const stopPayload = (await stopResponse.json()) as { stopped?: boolean };
    expect(stopPayload.stopped).toBe(true);

    await expect(page.getByRole('button', { name: '停止' })).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('当前运行流仍受此页控制')).toHaveCount(0);
    await expect(page.getByText('会话持续运行中')).toHaveCount(0);

    await page.waitForTimeout(7000);
    await expect(page.getByText('实时续流第二段')).toHaveCount(0);
  });

  test('refreshes during a permission pause, preserves paused state, then resumes after approval', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request, {
      providerId: 'custom-permission-live',
      providerType: 'custom',
      providerName: 'Custom Permission Live',
      modelId: 'mock-chat-tools',
      modelLabel: 'Mock Chat Tools',
    });

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
    await composer.fill('请执行真实 gateway 权限暂停恢复验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('权限请求')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('等待权限 · bash')).toBeVisible();
    await expect(page.getByRole('button', { name: '本次会话同意' })).toBeVisible();

    await page.reload();

    await expect(page.getByText('请执行真实 gateway 权限暂停恢复验证')).toBeVisible();
    await expect(page.getByText('权限请求')).toBeVisible();
    await expect(page.getByText('等待权限 · bash')).toBeVisible();
    await expect(page.getByRole('button', { name: '本次会话同意' })).toBeVisible();

    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/permissions/reply'),
    );
    await page.getByRole('button', { name: '本次会话同意' }).click();
    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBeTruthy();

    await expect(page.getByText('权限请求')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText('会话等待处理')).toHaveCount(0);
    await expect(page.locator('body')).toContainText('审批恢复后继续执行', {
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /bash TOOL pwd 等待权限/u })).toHaveCount(0);
  });

  test('refreshes during a permission pause, then rejects and returns to idle', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request, {
      providerId: 'custom-permission-live-reject',
      providerType: 'custom',
      providerName: 'Custom Permission Live Reject',
      modelId: 'mock-chat-tools-reject',
      modelLabel: 'Mock Chat Tools Reject',
    });

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
    await composer.fill('请执行真实 gateway 权限拒绝验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('权限请求')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '拒绝' })).toBeVisible();

    await page.reload();

    await expect(page.getByText('权限请求')).toBeVisible();
    await expect(page.getByRole('button', { name: '拒绝' })).toBeVisible();

    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/permissions/reply'),
    );
    await page.getByRole('button', { name: '拒绝' }).click();
    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBeTruthy();

    await expect(page.getByText('权限请求')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator('body')).not.toContainText('会话等待处理');
    await expect(page.locator('body')).toContainText('已拒绝');
  });

  test('refreshes during a question pause, preserves waiting state, then resumes after answer', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request, {
      providerId: 'custom-question-live',
      providerType: 'custom',
      providerName: 'Custom Question Live',
      modelId: 'mock-chat-questions',
      modelLabel: 'Mock Chat Questions',
    });

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
    await composer.fill('请执行真实 gateway 提问暂停恢复验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('会话等待回答')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText('请选择要查看的目录');
    await expect(page.getByRole('button', { name: /workspace/ })).toBeVisible();

    await page.reload();

    await expect(page.getByText('请执行真实 gateway 提问暂停恢复验证')).toBeVisible();
    await expect(page.getByText('会话等待回答')).toBeVisible();
    await expect(page.locator('body')).toContainText('请选择要查看的目录');

    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/questions/reply'),
    );
    await page.getByRole('button', { name: /workspace/ }).click();
    await page.getByRole('button', { name: '提交回答' }).click();
    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBeTruthy();

    await expect(page.getByText('会话等待回答')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: '提交回答' })).toHaveCount(0);
    await expect(page.locator('body')).toContainText('回答恢复后继续执行', {
      timeout: 15_000,
    });
  });

  test('refreshes during a question pause, then dismisses and returns to idle', async ({
    page,
    request,
  }) => {
    const auth = await loginAndPrepareSession(request, {
      providerId: 'custom-question-live-dismiss',
      providerType: 'custom',
      providerName: 'Custom Question Live Dismiss',
      modelId: 'mock-chat-questions-dismiss',
      modelLabel: 'Mock Chat Questions Dismiss',
    });

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
    await composer.fill('请执行真实 gateway 提问关闭验证');
    await page.getByRole('button', { name: '发送' }).click();

    await expect(page.getByText('会话等待回答')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('body')).toContainText('请选择要查看的目录');

    await page.reload();

    await expect(page.getByText('会话等待回答')).toBeVisible();
    await expect(page.locator('body')).toContainText('请选择要查看的目录');

    const replyResponsePromise = page.waitForResponse((response) =>
      response.url().includes('/questions/reply'),
    );
    await page.getByRole('button', { name: '暂不回答' }).click();
    const replyResponse = await replyResponsePromise;
    expect(replyResponse.ok()).toBeTruthy();

    await expect(page.getByText('会话等待回答')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole('button', { name: '提交回答' })).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('会话等待处理');
    await expect(page.locator('body')).toContainText('已忽略，等待进一步处理。');
  });
});
