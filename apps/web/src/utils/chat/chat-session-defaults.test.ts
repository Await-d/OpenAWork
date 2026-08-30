import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSavedChatSessionMetadata,
  loadSavedChatSessionDefaultsResult,
} from './chat-session-defaults.js';

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

  it.each(['none', 'max'] as const)('保留 OpenAI 思考等级 %s', async (effort) => {
    globalThis.fetch = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          activeSelection: {
            chat: { providerId: 'openai', modelId: effort === 'none' ? 'gpt-5.1' : 'gpt-5.6-sol' },
          },
          defaultThinking: {
            chat: { enabled: true, effort },
          },
          providers: [
            {
              id: 'openai',
              name: 'OpenAI',
              type: 'cloud',
              enabled: true,
              defaultModels: [
                {
                  id: effort === 'none' ? 'gpt-5.1' : 'gpt-5.6-sol',
                  label: effort === 'none' ? 'GPT-5.1' : 'GPT-5.6 Sol',
                  enabled: true,
                },
              ],
            },
          ],
        }),
      } as unknown as Response;
    }) as typeof fetch;

    const result = await loadSavedChatSessionDefaultsResult('https://gw.test', 'token-1');

    expect(result).toMatchObject({
      ok: true,
      data: {
        defaults: {
          thinkingEnabled: true,
          reasoningEffort: effort,
        },
      },
    });
  });
});

describe('buildSavedChatSessionMetadata', () => {
  it('会把默认 chat 选型标记为 defaults 来源', () => {
    expect(
      buildSavedChatSessionMetadata({
        providerId: 'openai',
        modelId: 'gpt-5.4',
        thinkingEnabled: true,
        reasoningEffort: 'high',
      }),
    ).toMatchObject({
      providerId: 'openai',
      modelId: 'gpt-5.4',
      modelSelectionSource: 'defaults',
    });
  });
});
