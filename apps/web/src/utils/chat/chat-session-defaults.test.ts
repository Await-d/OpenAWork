import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadSavedChatSessionDefaultsResult } from './chat-session-defaults.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('loadSavedChatSessionDefaultsResult', () => {
  it('成功时返回整理后的 provider defaults', async () => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          activeSelection: {
            chat: { providerId: 'openai', modelId: 'gpt-4o' },
          },
          defaultThinking: {
            chat: { enabled: true, effort: 'high' },
          },
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              type: 'cloud',
              enabled: true,
              defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await loadSavedChatSessionDefaultsResult('https://gw.test', 'token-1');

    expect(result).toMatchObject({
      ok: true,
      retryable: false,
      data: {
        defaults: {
          providerId: 'openai',
          modelId: 'gpt-4o',
          thinkingEnabled: true,
          reasoningEffort: 'high',
        },
      },
    });
  });
});
