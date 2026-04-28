import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../model-router.js';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
}));

import { generateSessionTitleLlm } from '../session-title-llm.js';

function createRoute(overrides?: {
  requestOverrides?: ModelRouteConfig['requestOverrides'];
  upstreamProtocol?: 'chat_completions' | 'responses';
}): ModelRouteConfig {
  return {
    model: 'gpt-4o-mini',
    apiBaseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    maxTokens: 256,
    temperature: 0.5,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: false,
    providerType: 'openai',
  };
}

describe('generateSessionTitleLlm', () => {
  beforeEach(() => {
    mocks.sqliteGet.mockReset();
    mocks.sqliteRun.mockReset();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips the LLM request when the session already has a title', async () => {
    mocks.sqliteGet.mockReturnValue({ title: '人工标题' });

    await generateSessionTitleLlm({
      route: createRoute(),
      userMessage: '帮我修复标题',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('forces title requests to stay non-streaming and only updates empty titles', async () => {
    mocks.sqliteGet.mockReturnValue({ title: '' });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '升级后的标题' } }],
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    await generateSessionTitleLlm({
      route: createRoute({
        requestOverrides: {
          body: {
            stream: true,
            stream_options: { include_usage: true },
          },
        },
      }),
      userMessage: '帮我修复标题',
      sessionId: 'session-2',
      userId: 'user-2',
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] ?? [];
    const body = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
    expect(body['stream']).toBe(false);
    expect(body).not.toHaveProperty('stream_options');

    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining("AND COALESCE(TRIM(title), '') = ''"),
      ['升级后的标题', 'session-2', 'user-2'],
    );
  });

  it('swallows SSE-like JSON parse failures and keeps the heuristic title', async () => {
    mocks.sqliteGet.mockReturnValue({ title: '' });
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"标题"}}]}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      generateSessionTitleLlm({
        route: createRoute(),
        userMessage: '帮我修复标题',
        sessionId: 'session-3',
        userId: 'user-3',
      }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });
});
