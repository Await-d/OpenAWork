/**
 * 会话亲和：`requestWorkflowLlmCompletion` 必须把「请求归属会话」的 sessionId 透传给
 * `runUpstreamGenerate`，否则上游既拿不到 prompt cache key，OpenCode Go 还会因缺
 * `x-opencode-session` 直接返回 400 MissingSessionID。
 *
 * 优先级：显式 `sessionId` > `usageContext.sessionId`（reception / pm1 / pm2 这类团队
 * 辅助调用只有后者）；两者都缺时不得凭空编造会话 id。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return {
    ...actual,
    runUpstreamGenerate: mocks.runUpstreamGenerate,
  };
});

import { requestWorkflowLlmCompletion } from '../../routes/workflow-llm.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

const BASE_INPUT = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  prompt: 'hello',
  temperature: 0.2,
  timeoutMs: 0,
};

interface GenerateInput {
  model?: string;
  sessionId?: string;
}

function firstCallInput(): GenerateInput {
  const call = mocks.runUpstreamGenerate.mock.calls[0];
  return (call?.[0] ?? {}) as GenerateInput;
}

beforeEach(() => {
  mocks.runUpstreamGenerate.mockReset();
  mocks.runUpstreamGenerate.mockReturnValue(
    Effect.succeed({
      text: 'ok',
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

describe('requestWorkflowLlmCompletion · sessionId 透传', () => {
  it('显式 sessionId 透传给 runUpstreamGenerate', async () => {
    await requestWorkflowLlmCompletion({ ...BASE_INPUT, sessionId: 'sess-explicit' });

    expect(firstCallInput().model).toBe('gpt-4o');
    expect(firstCallInput().sessionId).toBe('sess-explicit');
  });

  it('显式 sessionId 优先于 usageContext.sessionId', async () => {
    await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      sessionId: 'sess-explicit',
      usageContext: { userId: 'u-1', sessionId: 'sess-usage', layer: undefined },
    });

    expect(firstCallInput().sessionId).toBe('sess-explicit');
  });

  it('只提供 usageContext.sessionId 时兜底透传', async () => {
    await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      usageContext: { userId: 'u-1', sessionId: 'sess-usage', layer: undefined },
    });

    expect(firstCallInput().sessionId).toBe('sess-usage');
  });

  it('没有会话上下文时不编造 sessionId', async () => {
    await requestWorkflowLlmCompletion({ ...BASE_INPUT });

    expect('sessionId' in firstCallInput()).toBe(false);
  });
});
