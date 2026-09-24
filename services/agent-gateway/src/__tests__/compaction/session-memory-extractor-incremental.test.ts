/**
 * 增量抽取回归：extractSessionMemory 只应发送 `lastSessionMemoryMessageId`
 * 之后的消息（修复前每次更新都会重发最多约 50k tokens 的已总结历史），
 * 并且水位只推进到**实际发送**的最后一条——超出预算的剩余消息留给下一次
 * 抽取，而不是被跳过。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@openAwork/shared';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  listSessionMessagesV2: vi.fn(),
  readSessionMemoryState: vi.fn(),
  writeSessionMemoryContent: vi.fn(),
  writeLastSessionMemoryMessageId: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = (await (orig() as Promise<UpstreamModule>)) as UpstreamModule;
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

const SESSION_ID = 'sess-memory-incremental';
const USER_ID = 'user-memory-incremental';

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

const ZERO_THRESHOLD_CONFIG = {
  enabled: true,
  initializationThreshold: 0,
  minimumTokensBetweenUpdate: 0,
  toolCallsBetweenUpdates: 0,
};

interface NativeContentBlock {
  type?: string;
  text?: string;
}

interface GenerateInput {
  messages?: Array<{ role: string; content: string | NativeContentBlock[] }>;
}

function firstCallInput(): GenerateInput {
  const call = mocks.runUpstreamGenerate.mock.calls[0];
  return (call?.[0] ?? {}) as GenerateInput;
}

function capturedConversationText(): string {
  return (firstCallInput().messages ?? [])
    .map((message) =>
      typeof message.content === 'string'
        ? message.content
        : message.content.map((block) => block.text ?? '').join('\n'),
    )
    .join('\n---\n');
}

function makeMessage(id: string, role: 'user' | 'assistant', textLength: number): Message {
  return {
    id,
    role,
    content: [{ type: 'text', text: `${id}:${'x'.repeat(textLength)}` }],
    createdAt: Date.now(),
    status: 'final',
  };
}

/** 每条消息 409 字符 ≈ 103 tokens（`estimateMessageTokens` 按 4 字符/token）。 */
function buildFiveMessages(): Message[] {
  return [
    makeMessage('msg-0001', 'user', 400),
    makeMessage('msg-0002', 'assistant', 400),
    makeMessage('msg-0003', 'user', 400),
    makeMessage('msg-0004', 'assistant', 400),
    makeMessage('msg-0005', 'user', 400),
  ];
}

beforeEach(() => {
  mocks.runUpstreamGenerate.mockReset();
  mocks.listSessionMessagesV2.mockReset();
  mocks.readSessionMemoryState.mockReset();
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
  vi.unstubAllEnvs();
});

describe('extractSessionMemory · 默认关闭（对齐参考库）', () => {
  it('未显式开启且无环境变量时不加载消息、不发起上游调用', async () => {
    mocks.listSessionMessagesV2.mockReturnValue(buildFiveMessages());
    mocks.readSessionMemoryState.mockReturnValue({
      content: null,
      lastMessageId: null,
      updatedAt: null,
    });

    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: {
        initializationThreshold: 0,
        minimumTokensBetweenUpdate: 0,
        toolCallsBetweenUpdates: 0,
      },
    });

    expect(result).toEqual({ success: true });
    expect(mocks.listSessionMessagesV2).not.toHaveBeenCalled();
    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
    expect(mocks.writeSessionMemoryContent).not.toHaveBeenCalled();
  });

  it('环境变量 OPENAWORK_ENABLE_SESSION_MEMORY_EXTRACTION=1 时恢复抽取', async () => {
    vi.stubEnv('OPENAWORK_ENABLE_SESSION_MEMORY_EXTRACTION', '1');
    mocks.listSessionMessagesV2.mockReturnValue(buildFiveMessages());
    mocks.readSessionMemoryState.mockReturnValue({
      content: '旧记忆',
      lastMessageId: 'msg-0002',
      updatedAt: 1,
    });

    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: {
        initializationThreshold: 0,
        minimumTokensBetweenUpdate: 0,
        toolCallsBetweenUpdates: 0,
      },
    });

    expect(result).toEqual({ success: true });
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
  });
});

describe('extractSessionMemory · 增量发送', () => {
  it('只发送水位之后的消息，并把水位推进到实际发送的最后一条', async () => {
    mocks.listSessionMessagesV2.mockReturnValue(buildFiveMessages());
    mocks.readSessionMemoryState.mockReturnValue({
      content: '旧记忆',
      lastMessageId: 'msg-0002',
      updatedAt: 1,
    });

    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: ZERO_THRESHOLD_CONFIG,
    });

    expect(result).toEqual({ success: true });
    const conversation = capturedConversationText();
    expect(conversation).toContain('msg-0003:');
    expect(conversation).toContain('msg-0004:');
    expect(conversation).toContain('msg-0005:');
    // 已总结过的前缀不得重发。
    expect(conversation).not.toContain('msg-0001:');
    expect(conversation).not.toContain('msg-0002:');
    expect(mocks.writeLastSessionMemoryMessageId).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      'msg-0005',
    );
  });

  it('增量超过预算时只发送最旧的一段，水位停在实际发送处（剩余留给下一次）', async () => {
    mocks.listSessionMessagesV2.mockReturnValue(buildFiveMessages());
    mocks.readSessionMemoryState.mockReturnValue({
      content: '旧记忆',
      lastMessageId: 'msg-0002',
      updatedAt: 1,
    });

    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: { ...ZERO_THRESHOLD_CONFIG, incrementalTokenBudget: 250 },
    });

    expect(result).toEqual({ success: true });
    const conversation = capturedConversationText();
    expect(conversation).toContain('msg-0003:');
    expect(conversation).toContain('msg-0004:');
    expect(conversation).not.toContain('msg-0005:');
    expect(mocks.writeLastSessionMemoryMessageId).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      'msg-0004',
    );
  });

  it('水位已不在消息列表时退回有界尾部窗口，不重发整段历史', async () => {
    mocks.listSessionMessagesV2.mockReturnValue(buildFiveMessages());
    mocks.readSessionMemoryState.mockReturnValue({
      content: '旧记忆',
      lastMessageId: 'msg-9999',
      updatedAt: 1,
    });

    const result = await extractSessionMemory({
      sessionId: SESSION_ID,
      userId: USER_ID,
      route: ROUTE,
      config: { ...ZERO_THRESHOLD_CONFIG, incrementalTokenBudget: 250 },
    });

    expect(result).toEqual({ success: true });
    const conversation = capturedConversationText();
    expect(conversation).not.toContain('msg-0001:');
    expect(conversation).toContain('msg-0004:');
    expect(conversation).toContain('msg-0005:');
    expect(mocks.writeLastSessionMemoryMessageId).toHaveBeenCalledWith(
      SESSION_ID,
      USER_ID,
      'msg-0005',
    );
  });
});
