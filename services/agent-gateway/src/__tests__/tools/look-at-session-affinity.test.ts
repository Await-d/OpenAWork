/**
 * 会话亲和：`look_at` 的内层多模态调用必须带上「请求归属会话」的 sessionId，否则上游
 * 拿不到 prompt cache key，OpenCode Go 还会因缺 `x-opencode-session` 直接返回
 * 400 MissingSessionID。
 *
 * 这里锁定两件事：
 * ① `runLookAtTool` 把本次调用创建的 look_at 子会话 id 透传给内层上游调用；
 * ② `requestLookAtText` 支持调用方（GUI 主循环）显式传入会话 id。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  sqliteGet: vi.fn(),
  sqliteRun: vi.fn(),
  listManagedAgentsForUser: vi.fn(() => [] as unknown[]),
  selectDelegatedModelForUser: vi.fn(() => null),
  getReferenceAgentModelEntries: vi.fn(() => [] as unknown[]),
  getProviderConfigForSelection: vi.fn(async () => null),
  resolveModelRoute: vi.fn(),
  resolveModelRouteFromProvider: vi.fn(),
  appendSessionMessageV2: vi.fn(),
  validateWorkspacePath: vi.fn((p: string) => p),
  stat: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  stat: mocks.stat,
  readFile: mocks.readFile,
}));

vi.mock('../../infra/db.js', () => ({
  sqliteGet: mocks.sqliteGet,
  sqliteRun: mocks.sqliteRun,
  WORKSPACE_ROOT: '/tmp/workspace',
  WORKSPACE_ROOTS: ['/tmp/workspace'],
  WORKSPACE_ACCESS_MODE: 'unrestricted' as const,
  WORKSPACE_ACCESS_RESTRICTED: false,
}));

vi.mock('../../agent/agent-catalog.js', () => ({
  listManagedAgentsForUser: mocks.listManagedAgentsForUser,
}));

vi.mock('../../task/task-model-selection.js', () => ({
  selectDelegatedModelForUser: mocks.selectDelegatedModelForUser,
}));

vi.mock('../../task/task-model-reference-snapshot.js', () => ({
  getReferenceAgentModelEntries: mocks.getReferenceAgentModelEntries,
}));

vi.mock('../../provider/provider-config.js', () => ({
  getProviderConfigForSelection: mocks.getProviderConfigForSelection,
}));

vi.mock('../../provider/model-router.js', () => ({
  resolveModelRoute: mocks.resolveModelRoute,
  resolveModelRouteFromProvider: mocks.resolveModelRouteFromProvider,
}));

vi.mock('../../message/message-v2-adapter.js', () => ({
  appendSessionMessageV2: mocks.appendSessionMessageV2,
}));

vi.mock('../../workspace/workspace-paths.js', () => ({
  validateWorkspacePath: mocks.validateWorkspacePath,
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return { ...actual, runUpstreamGenerate: mocks.runUpstreamGenerate };
});

import { requestLookAtText, runLookAtTool } from '../../tools/look-at-tools.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

const TEXT_PATH = '/tmp/workspace/notes.txt';
const PARENT_SESSION_ID = 'parent-session';

interface GenerateInput {
  model?: string;
  sessionId?: string;
}

function sentInput(): GenerateInput {
  const call = mocks.runUpstreamGenerate.mock.calls[0];
  return (call?.[0] ?? {}) as GenerateInput;
}

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 2048,
    temperature: overrides?.temperature ?? 0.2,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

describe('look_at 内层调用的 sessionId 透传', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => {
      if (typeof m === 'function' && 'mockReset' in m) {
        (m as ReturnType<typeof vi.fn>).mockReset();
      }
    });
    mocks.listManagedAgentsForUser.mockReturnValue([]);
    mocks.getReferenceAgentModelEntries.mockReturnValue([]);
    mocks.selectDelegatedModelForUser.mockReturnValue(null);
    mocks.getProviderConfigForSelection.mockResolvedValue(null);
    mocks.validateWorkspacePath.mockImplementation((p: string) => p);
    mocks.resolveModelRoute.mockReturnValue(createRoute());
    mocks.stat.mockResolvedValue({ size: 2048 });
    mocks.readFile.mockResolvedValue(Buffer.from('hello world'));
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({ text: 'ok', inputTokens: 1, outputTokens: 1, finishReason: 'stop' }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runLookAtTool 把 look_at 子会话 id 透传给内层上游调用', async () => {
    await runLookAtTool({
      filePath: TEXT_PATH,
      goal: '总结要点',
      parentSessionId: PARENT_SESSION_ID,
      userId: 'user-1',
    });

    // 子会话 id 由 look_at 内部生成：以落库的用户消息为准反查。
    const appended = mocks.appendSessionMessageV2.mock.calls[0]?.[0] as { sessionId?: string };
    const sent = sentInput();

    expect(typeof appended.sessionId).toBe('string');
    expect(sent.sessionId).toBe(appended.sessionId);
    expect(sent.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(sent.sessionId).not.toBe(PARENT_SESSION_ID);
  });

  it('requestLookAtText 支持调用方显式传入 sessionId', async () => {
    await requestLookAtText({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      imageDataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      model: 'gpt-4o',
      prompt: '看看这张图',
      requestOverrides: {},
      sessionId: 'gui-child-session',
    });

    expect(sentInput().sessionId).toBe('gui-child-session');
  });

  it('未提供 sessionId 时不上送该字段（不编造会话 id）', async () => {
    await requestLookAtText({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      imageDataUrl: 'data:image/png;base64,AAAA',
      mimeType: 'image/png',
      model: 'gpt-4o',
      prompt: '看看这张图',
      requestOverrides: {},
    });

    expect('sessionId' in sentInput()).toBe(false);
  });
});
