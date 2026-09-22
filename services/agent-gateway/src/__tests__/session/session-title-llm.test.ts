import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
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

import {
  generateSessionTitleLlm,
  TITLE_LLM_MAX_OUTPUT_TOKENS,
} from '../../session/session-title-llm.js';

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

/**
 * 有状态的假会话行：写入后的 title / metadata 对后续读取可见，
 * 避免无状态 mock 下「写后状态」不可见。
 */
function installSessionState(initial?: { title?: string; icon?: string }): {
  title: string;
  metadata_json: string | null;
} {
  const state: { title: string; metadata_json: string | null } = {
    title: initial?.title ?? '',
    metadata_json: initial?.icon ? JSON.stringify({ icon: initial.icon }) : null,
  };
  mocks.sqliteGet.mockImplementation(() => ({ ...state }));
  mocks.sqliteRun.mockImplementation((sql: unknown, params: unknown) => {
    if (typeof sql !== 'string') return;
    const values = Array.isArray(params) ? params : [];
    if (sql.includes('SET title =')) {
      state.title = String(values[0] ?? '');
    }
    if (sql.includes('SET metadata_json =')) {
      state.metadata_json = String(values[0] ?? '');
    }
  });
  return state;
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
    mocks.sqliteGet.mockReturnValue({ title: '启发式标题', metadata_json: null });
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: '启发式标题\n🔧',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
      }),
    );

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
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: '升级后的标题',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
      }),
    );

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
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: '标题',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
      }),
    );

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
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.sqliteGet.mockReturnValue({ title: '' });
    mocks.runUpstreamGenerate.mockReturnValue(Effect.fail(new Error('upstream blew up')));

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
    warn.mockRestore();
  });

  it('forwards a budget large enough for reasoning models', async () => {
    installSessionState();
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: '标题够长了\n🔍',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
      }),
    );

    await generateSessionTitleLlm({
      route: createRoute(),
      userMessage: '帮我修复标题',
      sessionId: 'session-budget',
      userId: 'user-1',
    });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as
      { maxOutputTokens?: number } | undefined;
    expect(TITLE_LLM_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(256);
    expect(callArgs?.maxOutputTokens).toBe(TITLE_LLM_MAX_OUTPUT_TOKENS);
  });
});
