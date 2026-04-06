import { expect, test } from '@playwright/test';

const SESSION_ID = 'session-1';
const GATEWAY_URL = 'http://localhost:3000';

test.describe('Chat todo lanes', () => {
  test.beforeEach(async ({ page }) => {
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

    await page.route(`${GATEWAY_URL}/**`, async (route) => {
      const url = new URL(route.request().url());
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
                title: 'Todo lane verification',
                updated_at: '2026-03-26T12:00:00.000Z',
              },
            ],
          }),
        });
        return;
      }

      if (pathname === `/sessions/${SESSION_ID}/recovery`) {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            recovery: {
              activeStream: null,
              children: [],
              pendingPermissions: [],
              pendingQuestions: [],
              ratings: [],
              session: {
                id: SESSION_ID,
                messages: [
                  {
                    id: 'assistant-1',
                    role: 'assistant',
                    createdAt: 1,
                    content: [{ type: 'text', text: 'todo lanes e2e' }],
                  },
                ],
                metadata_json: '{}',
              },
              tasks: [],
              todoLanes: {
                main: [{ content: '整理 provider 映射', status: 'in_progress', priority: 'high' }],
                temp: [{ content: '补齐聊天面板展示', status: 'pending', priority: 'medium' }],
              },
            },
          }),
        });
        return;
      }

      if (
        pathname === `/sessions/${SESSION_ID}/children` ||
        pathname === `/sessions/${SESSION_ID}/tasks` ||
        pathname === `/sessions/${SESSION_ID}/permissions/pending`
      ) {
        const key = pathname.endsWith('/children')
          ? 'sessions'
          : pathname.endsWith('/tasks')
            ? 'tasks'
            : 'requests';
        const emptyBody = key === 'requests' ? { requests: [] } : { [key]: [] };
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(emptyBody),
        });
        return;
      }

      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unhandled mock path: ${pathname}` }),
      });
    });
  });

  test('shows main and temp todos in chat inline bar and history panel', async ({ page }) => {
    await page.goto(`/chat/${SESSION_ID}`);

    await expect(page.getByTestId('chat-todo-bar')).toBeVisible();
    await expect(page.getByTestId('chat-todo-bar')).toContainText('主待办');
    await expect(page.getByTestId('chat-todo-bar')).toContainText('临时待办');
    await expect(page.getByTestId('chat-todo-bar')).toContainText('整理 provider 映射');

    await page.getByTestId('chat-todo-toggle').click();
    await expect(page.getByTestId('chat-todo-bar')).toContainText('补齐聊天面板展示');
    await page.screenshot({ path: 'test-results/chat-todo-inline.png', fullPage: true });

    await page.getByTestId('chat-controls-bar').getByRole('button', { name: '展开面板' }).click();
    await expect(page.getByTestId('chat-todo-bar')).toBeVisible();
    await page.getByRole('tab', { name: '历史' }).click();
    const historyPanel = page.getByTestId('chat-right-panel-body-history');
    await expect(historyPanel.getByText('主待办')).toBeVisible();
    await expect(historyPanel.getByText('临时待办')).toBeVisible();
    await expect(historyPanel.getByText('补齐聊天面板展示')).toBeVisible();
    await page.screenshot({ path: 'test-results/chat-todo-history.png', fullPage: true });
  });
});
