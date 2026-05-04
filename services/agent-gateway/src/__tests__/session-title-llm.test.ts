import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../model-router.js';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../v2-runtime/upstream/index.js', () => ({
  runUpstreamGenerate: mocks.runUpstreamGenerate,
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
    mocks.runUpstreamGenerate.mockReset();
  });

  afterEach(() => {
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

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('calls upstream and updates the session title when title is empty', async () => {
    mocks.sqliteGet.mockReturnValue({ title: '' });
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: '升级后的标题',
      inputTokens: 10,
      outputTokens: 5,
      finishReason: 'stop',
    });

    await generateSessionTitleLlm({
      route: createRoute(),
      userMessage: '帮我修复标题',
      sessionId: 'session-2',
      userId: 'user-2',
    });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRun).toHaveBeenCalledWith(
      expect.stringContaining("AND COALESCE(TRIM(title), '') = ''"),
      ['升级后的标题', 'session-2', 'user-2'],
    );
  });

  it('swallows upstream errors and keeps the heuristic title', async () => {
    mocks.sqliteGet.mockReturnValue({ title: '' });
    mocks.runUpstreamGenerate.mockRejectedValue(new Error('upstream blew up'));

    await expect(
      generateSessionTitleLlm({
        route: createRoute(),
        userMessage: '帮我修复标题',
        sessionId: 'session-3',
        userId: 'user-3',
      }),
    ).resolves.toBeUndefined();

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });
});
