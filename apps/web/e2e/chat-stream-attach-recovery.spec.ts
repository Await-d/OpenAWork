import { expect, test, type Page } from '@playwright/test';

const SESSION_ID = 'session-attach-e2e';
const GATEWAY_URL = 'http://localhost:3000';
const ACTIVE_STREAM_STORAGE_KEY = 'openAwork-active-stream:tester@openawork.local';
const ACTIVE_STREAM_ANONYMOUS_STORAGE_KEY = 'openAwork-active-stream:anonymous';

async function primeAuthenticatedSession(page: Page): Promise<void> {
  await page.addInitScript(
    ({ gatewayUrl, sessionId, storageKey, anonymousStorageKey }) => {
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

      const snapshot = JSON.stringify({
        clientRequestId: 'req-attach-e2e-1',
        lastSeq: 3,
        sessionId,
        startedAt: Date.now() - 1_000,
        transport: 'attach-sse',
      });
      sessionStorage.setItem(storageKey, snapshot);
      sessionStorage.setItem(anonymousStorageKey, snapshot);
    },
    {
      gatewayUrl: GATEWAY_URL,
      sessionId: SESSION_ID,
      storageKey: ACTIVE_STREAM_STORAGE_KEY,
      anonymousStorageKey: ACTIVE_STREAM_ANONYMOUS_STORAGE_KEY,
    },
  );
}

async function mockChatRefreshRecovery(page: Page): Promise<{ activeUrls: string[] }> {
  const activeUrls: string[] = [];
  let activeCallCount = 0;
  await page.route(`${GATEWAY_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;

    if (pathname === '/settings/providers') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
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
        }),
      });
      return;
    }

    if (pathname === '/settings/model-prices') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{ modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 }],
        }),
      });
      return;
    }

    if (pathname === '/commands') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ commands: [] }),
      });
      return;
    }

    if (pathname === '/capabilities') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ capabilities: [] }),
      });
      return;
    }

    if (pathname === '/sessions') {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          sessions: [
            {
              id: SESSION_ID,
              title: 'Attach recovery e2e',
              updated_at: '2026-04-04T12:00:00.000Z',
            },
          ],
        }),
      });
      return;
    }

    if (pathname === `/sessions/${SESSION_ID}`) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          session: {
            id: SESSION_ID,
            messages: [
              {
                id: 'user-1',
                role: 'user',
                createdAt: 1,
                content: [{ type: 'text', text: '请继续输出当前分析' }],
              },
            ],
            metadata_json: '{}',
            runEvents: [
              {
                type: 'text_delta',
                delta: '已恢复',
                runId: 'run-attach-e2e',
                occurredAt: 10,
              },
            ],
            state_status: 'running',
          },
        }),
      });
      return;
    }

    if (pathname === `/sessions/${SESSION_ID}/stream/active`) {
      activeUrls.push(request.url());
      activeCallCount += 1;
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          active:
            activeCallCount >= 1
              ? {
                  clientRequestId: 'req-attach-e2e-1',
                  heartbeatAtMs: Date.now(),
                  lastSeq: 4,
                  sessionId: SESSION_ID,
                  startedAtMs: Date.now() - 1_000,
                }
              : null,
        }),
      });
      return;
    }

    if (pathname === `/sessions/${SESSION_ID}/stream/attach`) {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: 'retry: 1000\n\n',
        headers: {
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
      return;
    }

    if (
      pathname === `/sessions/${SESSION_ID}/children` ||
      pathname === `/sessions/${SESSION_ID}/tasks` ||
      pathname === `/sessions/${SESSION_ID}/permissions/pending` ||
      pathname === `/sessions/${SESSION_ID}/todo-lanes`
    ) {
      const key = pathname.endsWith('/children')
        ? 'sessions'
        : pathname.endsWith('/tasks')
          ? 'tasks'
          : pathname.endsWith('/permissions/pending')
            ? 'requests'
            : 'main';
      const body =
        key === 'main'
          ? { main: [], temp: [] }
          : key === 'requests'
            ? { requests: [] }
            : { [key]: [] };
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ error: `Unhandled mock path: ${pathname}` }),
    });
  });

  return { activeUrls };
}

test.describe('Chat refresh recovery', () => {
  test('keeps recovered streaming content and stop controls visible after refresh', async ({
    page,
  }) => {
    await primeAuthenticatedSession(page);
    await mockChatRefreshRecovery(page);

    await page.goto(`/chat/${SESSION_ID}`);
    await page.reload();

    await expect(page.getByText('请继续输出当前分析')).toBeVisible();
    await expect(page.getByText('已恢复')).toBeVisible();
    await expect(page.getByText('会话持续运行中')).toBeVisible();
    await expect(page.getByText('当前运行流仍受此页控制')).toBeVisible();
    await expect(page.getByRole('button', { name: '停止' })).toBeVisible();
  });
});
