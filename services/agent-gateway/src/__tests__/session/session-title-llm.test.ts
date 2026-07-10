import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/workspace',
  WORKSPACE_ROOTS: ['/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../../v2-runtime/upstream/index.js', () => ({
  runUpstreamGenerate: mocks.runUpstreamGenerate,
}));

import { generateSessionTitleLlm } from '../../session/session-title-llm.js';

function createRoute(overrides?: {
  requestOverrides?: ModelRouteConfig['requestOverrides'];
  upstreamProtocol?: 'chat_completions' | 'responses' | 'anthropic_messages';
  providerType?: 'openai' | 'anthropic';
  model?: string;
  apiBaseUrl?: string;
}): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o-mini',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: 'sk-test',
    maxTokens: 256,
    temperature: 0.5,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: false,
    providerType: overrides?.providerType ?? 'openai',
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

  it('skips the LLM request when the session already has both title and icon', async () => {
    mocks.sqliteGet.mockReturnValue({
      title: '人工标题',
      metadata_json: JSON.stringify({ icon: '🔑' }),
    });

    await generateSessionTitleLlm({
      route: createRoute(),
      userMessage: '帮我修复标题',
      sessionId: 'session-1',
      userId: 'user-1',
    });

    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
    expect(mocks.sqliteRun).not.toHaveBeenCalled();
  });

  it('calls LLM and saves only icon when title exists but icon is missing', async () => {
    mocks.sqliteGet
      .mockReturnValueOnce({ title: '启发式标题', metadata_json: null })
      .mockReturnValue({ metadata_json: null });
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: '启发式标题\n🔧',
      inputTokens: 10,
      outputTokens: 5,
      finishReason: 'stop',
    });

    await generateSessionTitleLlm({
      route: createRoute(),
      userMessage: '帮我修复标题',
      sessionId: 'session-icon-only',
      userId: 'user-1',
    });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    // Title update should NOT be called (title already exists)
    const titleUpdateCall = mocks.sqliteRun.mock.calls.find(
      (call: unknown[]) =>
        typeof call[0] === 'string' && call[0].includes("COALESCE(TRIM(title), '') = ''"),
    );
    expect(titleUpdateCall).toBeUndefined();
    // Icon update SHOULD be called
    const iconUpdateCall = mocks.sqliteRun.mock.calls.find(
      (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('metadata_json'),
    );
    expect(iconUpdateCall).toBeDefined();
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

  it("forwards the route's upstreamProtocol to runUpstreamGenerate", async () => {
    // Regression: prior to forwarding, anthropic / openai-responses providers
    // silently degraded to OpenAI Chat Completions inside session-title.
    mocks.sqliteGet.mockReturnValue({ title: '' });
    mocks.runUpstreamGenerate.mockResolvedValue({
      text: '标题',
      inputTokens: 0,
      outputTokens: 0,
      finishReason: 'stop',
    });

    await generateSessionTitleLlm({
      route: createRoute({
        upstreamProtocol: 'anthropic_messages',
        providerType: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        apiBaseUrl: 'https://api.anthropic.com/v1',
      }),
      userMessage: '修复标题',
      sessionId: 'session-anthropic',
      userId: 'user-1',
    });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { providerType?: string; upstreamProtocol?: string } | undefined;
    expect(callArgs?.providerType).toBe('anthropic');
    expect(callArgs?.upstreamProtocol).toBe('anthropic_messages');
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
