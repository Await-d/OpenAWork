/**
 * 团队用量统计补全：`requestWorkflowLlmCompletion` 在收到 `usageContext` 时，
 * 必须把这次非流式调用的 usage 作为 `team_usage` team-event 发出，让团队度量面板
 * 能按层（reception/pm1/pm2）聚合 token / 费用 / 调用次数。
 *
 * 背景：reception 路由/改写、PM1 spec/plan/tasks、PM2 constitution/quality-review
 * 都走这个非流式 caller（不经 stream.ts），此前 usage 被直接丢弃，导致这几层在
 * 度量界面里完全统计不到——「每次使用都没正确统计」的根因。
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
  publishTeamEvent: vi.fn(),
  persistTeamUsageRecord: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return {
    ...actual,
    runUpstreamGenerate: mocks.runUpstreamGenerate,
  };
});

vi.mock('../../handoff/bus/team-events-bus.js', async (orig) => {
  type BusModule = typeof BusActual;
  const actual = await (orig() as Promise<BusModule>);
  return {
    ...actual,
    publishTeamEvent: mocks.publishTeamEvent,
  };
});

// 隔离 DB：本测试只关心"是否发出 team_usage 事件"，落库由 stream-team-events 测试覆盖。
vi.mock('../../team/team-usage-records-store.js', async (orig) => {
  type RecordsModule = typeof RecordsActual;
  const actual = await (orig() as Promise<RecordsModule>);
  return {
    ...actual,
    persistTeamUsageRecord: mocks.persistTeamUsageRecord,
  };
});

import { requestWorkflowLlmCompletion } from '../../routes/workflow-llm.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';
import type * as BusActual from '../../handoff/bus/team-events-bus.js';
import type * as RecordsActual from '../../team/team-usage-records-store.js';

const BASE_INPUT = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o',
  prompt: 'hello',
  temperature: 0.2,
  timeoutMs: 0,
};

beforeEach(() => {
  mocks.runUpstreamGenerate.mockReset();
  mocks.publishTeamEvent.mockReset();
  mocks.persistTeamUsageRecord.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('requestWorkflowLlmCompletion · team_usage 事件', () => {
  it('提供 usageContext.layer 时发出 team_usage 事件（含 token + 估算成本）', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1000,
        outputTokens: 500,
        finishReason: 'stop',
        raw: {},
      }),
    );

    const text = await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      usageContext: {
        userId: 'u-1',
        sessionId: 's-1',
        layer: 'pm1',
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
      },
    });

    expect(text).toBe('ok');
    expect(mocks.publishTeamEvent).toHaveBeenCalledTimes(1);
    const envelope = mocks.publishTeamEvent.mock.calls[0]?.[0] as {
      layer?: string;
      userId?: string;
      payload?: Record<string, unknown>;
    };
    expect(envelope.layer).toBe('pm1');
    expect(envelope.userId).toBe('u-1');
    expect(envelope.payload?.['__teamEventKind']).toBe('team_usage');
    expect(envelope.payload?.['inputTokens']).toBe(1000);
    expect(envelope.payload?.['outputTokens']).toBe(500);
    // 成本 = (1000*3 + 500*15) / 1e6 = 0.0105
    expect(envelope.payload?.['costUsd']).toBeCloseTo(0.0105, 6);
  });

  it('未提供 usageContext 时不发任何 team 事件（chat 端不受影响）', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
        raw: {},
      }),
    );

    await requestWorkflowLlmCompletion(BASE_INPUT);
    expect(mocks.publishTeamEvent).not.toHaveBeenCalled();
  });

  it('usageContext.layer 为空时不发事件', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 10,
        outputTokens: 5,
        finishReason: 'stop',
        raw: {},
      }),
    );

    await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      usageContext: { userId: 'u-1', sessionId: 's-1', layer: null },
    });
    expect(mocks.publishTeamEvent).not.toHaveBeenCalled();
  });

  it('prompt 与响应都为空时不发事件（避免噪声）', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: '',
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
        raw: {},
      }),
    );

    await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      prompt: '',
      usageContext: { userId: 'u-1', sessionId: 's-1', layer: 'pm2' },
    });
    expect(mocks.publishTeamEvent).not.toHaveBeenCalled();
  });

  it('provider 不回 usage（token=0）时按文本长度估算，仍发出事件', async () => {
    // 响应有文本但 usage 缺失（常见于 OpenAI 兼容中转 / 自建 provider）。
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'x'.repeat(40), // ~10 tokens
        inputTokens: 0,
        outputTokens: 0,
        finishReason: 'stop',
        raw: {},
      }),
    );

    await requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      prompt: 'y'.repeat(80), // ~20 tokens
      usageContext: { userId: 'u-1', sessionId: 's-1', layer: 'pm1' },
    });

    expect(mocks.publishTeamEvent).toHaveBeenCalledTimes(1);
    const envelope = mocks.publishTeamEvent.mock.calls[0]?.[0] as {
      payload?: Record<string, unknown>;
    };
    // 估算口径 ~4 字符/token：input=80/4=20，output=40/4=10。
    expect(envelope.payload?.['inputTokens']).toBe(20);
    expect(envelope.payload?.['outputTokens']).toBe(10);
  });
});
