import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

const sessionId = 'session-visual-thinking';
const trace = JSON.stringify({
  type: 'assistant_trace',
  payload: {
    reasoningBlocks: ['## 先比较约束\n确认边界与风险，再输出结论\n最后再校验一次表达语气。'],
    text: '最终答复：建议先收集约束，再分步执行。',
    toolCalls: [],
  },
});

await page.addInitScript(() => {
  localStorage.setItem(
    'auth-store',
    JSON.stringify({
      state: {
        accessToken: 'test-token',
        refreshToken: null,
        tokenExpiresAt: Date.now() + 3600_000,
        email: 'qa@example.com',
        gatewayUrl: 'http://127.0.0.1:3301',
        webAccessEnabled: false,
        webPort: 3000,
      },
      version: 0,
    }),
  );
  localStorage.setItem('telemetry_consent_shown', '1');
  localStorage.setItem('onboarded', '1');
  localStorage.setItem('preferred-theme', 'dark');
});

await page.route('http://127.0.0.1:3301/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const fulfillJson = (body) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });

  if (path === '/sessions') {
    return fulfillJson({
      sessions: [{ id: sessionId, title: 'Thinking visual review', updatedAt: Date.now() }],
    });
  }

  if (path === '/commands') {
    return fulfillJson({ commands: [] });
  }

  if (path === '/capabilities') {
    return fulfillJson({ capabilities: [] });
  }

  if (path === '/settings/providers') {
    return fulfillJson({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          defaultModels: [
            {
              id: 'gpt-5.4',
              label: 'GPT-5.4',
              enabled: true,
              supportsThinking: true,
              contextWindow: 128000,
            },
          ],
        },
      ],
    });
  }

  if (path === '/settings/model-prices') {
    return fulfillJson({ prices: [] });
  }

  if (path === '/settings/companion') {
    return fulfillJson({
      buddyEnabled: false,
      mute: false,
      narrationEnabled: false,
      lowDistraction: true,
    });
  }

  if (path.endsWith('/questions/pending') || path.endsWith('/permissions/pending')) {
    return fulfillJson([]);
  }

  if (path.endsWith('/artifacts')) {
    return fulfillJson({ items: [], total: 0 });
  }

  if (path === `/sessions/${sessionId}`) {
    return fulfillJson({
      session: {
        id: sessionId,
        title: 'Thinking visual review',
        state_status: 'idle',
        messages: [
          {
            id: 'assistant-thinking-1',
            role: 'assistant',
            content: trace,
            createdAt: 1,
            status: 'completed',
            providerId: 'openai',
            model: 'gpt-5.4',
          },
        ],
        runEvents: [],
      },
    });
  }

  return fulfillJson({});
});

await page.goto(`http://127.0.0.1:4173/chat/${sessionId}`, { waitUntil: 'networkidle' });

await page.screenshot({ path: '/tmp/openawork-thinking-strip.png', fullPage: true });
const summaryText = await page
  .locator('[data-testid="chat-markdown-thinking-summary"]')
  .textContent();

console.log(JSON.stringify({ summaryText }));

await browser.close();
