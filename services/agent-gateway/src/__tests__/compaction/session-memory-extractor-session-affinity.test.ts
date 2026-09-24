/**
 * 会话亲和：session memory 抽取是非流式辅助调用，必须带上所属会话的 sessionId，
 * 否则上游拿不到 prompt cache key，OpenCode Go 还会因缺 `x-opencode-session`
 * 直接返回 400 MissingSessionID。
 *
 * 抽取阈值置 0 让 `shouldExtractSessionMemory` 立即放行——本用例只关心 sessionId
 * 透传，触发条件本身由既有测试覆盖。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  listSessionMessagesV2: vi.fn(() => [] as unknown[]),
  readSessionMemoryState: vi.fn(() => ({ content: null, lastMessageId: null })),
  writeSessionMemoryContent: vi.fn(),
  writeLastSessionMemoryMessageId: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return { ...actual, runUpstreamGenerate: mocks.runUpstreamGenerate };
});

vi.mock('../../message/message-v2-adapter.js', () => ({
  listSessionMessagesV2: mocks.listSessionMessagesV2,
}));

vi.mock('../../compaction/session-memory-store.js', () => ({
  readSessionMemoryState: mocks.readSessionMemoryState,
  writeSessionMemoryContent: mocks.writeSessionMemoryContent,
  writeLastSessionMemoryMessageId: mocks.writeLastSessionMemoryMessageId,
}));

import { extractSessionMemory } from '../../compaction/session-memory-extractor.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

const SESSION_ID = 'sess-memory-1';
const USER_ID = 'user-1';

const ROUTE: ModelRouteConfig = {
  model: 'gpt-4o',
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  supportsThinking: false,
  providerType: 'openai',
};

interface GenerateInput {
  model?: string;
  sessionId?: string;
  messages?: unknown[];
}

function firstCallInput(): GenerateInput {
  const call = mocks.runUpstreamGenerate.mock.calls[0];
  return (call?.[0] ?? {}) as GenerateInput;
}

beforeEach(() => {
  mocks.runUpstreamGenerate.mockReset();
  mocks.listSessionMessagesV2.mockReset();
  mocks.listSessionMessagesV2.mockReturnValue([]);
  mocks.readSessionMemoryState.mockReset();
  mocks.readSessionMemoryState.mockReturnValue({ content: null, lastMessageId: null });
  mocks.writeSessionMemoryContent.mockReset();
  mocks.writeLastSessionMemoryMessageId.mockReset();
  mocks.runUpstreamGenerate.mockReturnValue(
    Effect.succeed({
      text: 'updated memory',
      inputTokens: 1,
      outputTokens: 1,
      finishReason: 'stop',
      raw: {},
    }),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('extractSessionMemory · sessionId 透传', () => {
  it('把所属会话 id 透传给 runUpstreamGenerate', async () => {
    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: { enabled: true, initializationThreshold: 0 },
    });

    expect(result).toEqual({ success: true });
    expect(firstCallInput().sessionId).toBe(SESSION_ID);
    expect(firstCallInput().model).toBe('gpt-4o');
    expect(firstCallInput().messages).not.toHaveLength(0);
    expect(mocks.writeSessionMemoryContent).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      'updated memory',
    );
  });
});
