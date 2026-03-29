import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.route('http://localhost:3000/**', async (route) => {
  const url = new URL(route.request().url());
  const path = url.pathname;
  const method = route.request().method();

  const fulfillJson = async (data) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  };

  if (path === '/settings/providers') {
    await fulfillJson({
      providers: [
        {
          id: 'openai',
          name: 'OpenAI',
          type: 'openai',
          enabled: true,
          defaultModels: [{ id: 'gpt-5', label: 'GPT-5', enabled: true, supportsThinking: true }],
        },
      ],
      activeSelection: {
        chat: { providerId: 'openai', modelId: 'gpt-5' },
        fast: { providerId: 'openai', modelId: 'gpt-5' },
      },
      defaultThinking: {
        chat: { enabled: true, effort: 'high' },
        fast: { enabled: false, effort: 'medium' },
      },
    });
    return;
  }

  if (path === '/settings/model-prices') {
    await fulfillJson({ models: [{ modelName: 'gpt-5', inputPer1m: 1.25, outputPer1m: 5 }] });
    return;
  }

  if (path === '/commands') {
    await fulfillJson({ commands: [] });
    return;
  }

  if (path === '/capabilities') {
    await fulfillJson({ capabilities: [] });
    return;
  }

  if (path === '/sessions' && method === 'GET') {
    await fulfillJson({
      sessions: [{ id: 'session-1', title: '打字机验证', updatedAt: Date.now() }],
    });
    return;
  }

  if (path === '/sessions/session-1' && method === 'GET') {
    await fulfillJson({
      session: {
        id: 'session-1',
        title: '打字机验证',
        state_status: 'idle',
        metadata_json: JSON.stringify({
          providerId: 'openai',
          modelId: 'gpt-5',
          dialogueMode: 'clarify',
          yoloMode: false,
          webSearchEnabled: false,
          thinkingEnabled: false,
          reasoningEffort: 'medium',
        }),
        messages: [],
      },
    });
    return;
  }

  if (path === '/sessions/session-1/children') {
    await fulfillJson({ sessions: [] });
    return;
  }

  if (path === '/sessions/session-1/tasks') {
    await fulfillJson({ tasks: [] });
    return;
  }

  if (path === '/sessions/session-1/todos') {
    await fulfillJson({ todos: [] });
    return;
  }

  if (path === '/sessions/session-1/todo-lanes') {
    await fulfillJson({ main: [], temp: [] });
    return;
  }

  if (path === '/sessions/session-1/permissions/pending') {
    await fulfillJson({ requests: [] });
    return;
  }

  if (path === '/sessions/session-1' && method === 'PATCH') {
    await fulfillJson({ ok: true });
    return;
  }

  if (path === '/sessions/session-1/stream/stop') {
    await fulfillJson({ stopped: true });
    return;
  }

  if (path === '/sessions/session-1/messages/truncate') {
    await fulfillJson({ messages: [] });
    return;
  }

  await fulfillJson({});
});

await page.addInitScript(() => {
  localStorage.setItem('theme', 'dark');
  localStorage.setItem('onboarded', '1');
  localStorage.setItem('telemetry_consent_shown', '1');
  localStorage.setItem(
    'auth-store',
    JSON.stringify({
      state: {
        accessToken: 'token-123',
        refreshToken: null,
        tokenExpiresAt: Date.now() + 60 * 60 * 1000,
        email: 'hephaestus@example.com',
        gatewayUrl: 'http://localhost:3000',
        webAccessEnabled: false,
        webPort: 3000,
      },
      version: 0,
    }),
  );

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.onopen = null;
      this.onmessage = null;
      this.onerror = null;
      this.onclose = null;

      setTimeout(() => {
        this.readyState = MockWebSocket.OPEN;
        this.onopen?.({});
      }, 20);
    }

    send() {
      const delta = '第一句，节奏放慢一些。第二句，继续推进。最后一句，完成收尾。';

      setTimeout(() => {
        if (this.readyState !== MockWebSocket.OPEN) {
          return;
        }

        this.onmessage?.({ data: JSON.stringify({ type: 'text_delta', delta }) });
      }, 120);

      setTimeout(() => {
        if (this.readyState !== MockWebSocket.OPEN) {
          return;
        }

        this.onmessage?.({ data: JSON.stringify({ type: 'done', stopReason: 'end_turn' }) });
        this.readyState = MockWebSocket.CLOSED;
        this.onclose?.({});
      }, 2200);
    }

    close() {
      this.readyState = MockWebSocket.CLOSED;
      this.onclose?.({});
    }

    addEventListener(type, listener) {
      if (type === 'open') this.onopen = listener;
      if (type === 'message') this.onmessage = listener;
      if (type === 'error') this.onerror = listener;
      if (type === 'close') this.onclose = listener;
    }

    removeEventListener() {}
  }

  window.WebSocket = MockWebSocket;
});

await page.goto('http://127.0.0.1:4173/chat/session-1', { waitUntil: 'networkidle' });
await page.locator('textarea').waitFor({ state: 'visible' });
await page.locator('textarea').fill('请验证打字机效果');
await page.locator('button.btn-accent').click();

const assistantGroup = page.locator('[data-chat-group-root="true"][data-role="assistant"]').last();
const samples = [];

for (let index = 0; index < 14; index += 1) {
  await page.waitForTimeout(110);
  const text = (await assistantGroup.innerText()).replace(/\s+/gu, ' ').trim();
  samples.push({ index, text });
}

const uniqueTexts = samples
  .map((sample) => sample.text)
  .filter((text, index, collection) => collection.indexOf(text) === index);

console.log(
  JSON.stringify(
    { sampleCount: samples.length, uniqueCount: uniqueTexts.length, samples },
    null,
    2,
  ),
);

await browser.close();
