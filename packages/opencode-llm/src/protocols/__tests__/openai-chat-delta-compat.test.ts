import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Chat from '../openai-chat.js';
import { LLMRequest } from '../../schema/index.js';

/**
 * OpenAI Chat delta 兼容字段的对齐验证（对齐 opencode 参考库）。
 *
 * 回归背景：移植版曾使用严格 `Schema.Struct` 且只声明 `content` /
 * `reasoning_content` / `tool_calls`，导致：
 *   - `delta.refusal`（拒绝文本）被静默丢弃 → 可见正文为空；
 *   - `delta.reasoning` / `reasoning_text` / `reasoning_details` 被丢弃
 *     → 非 DeepSeek 命名的思维链丢失；
 *   - `choice.usage` 被丢弃 → 用量统计缺失。
 */

const makeRequest = () =>
  new LLMRequest({
    model: Chat.route.model({ id: 'deepseek-v4.1-flash' }),
    system: [],
    messages: [],
    tools: [],
  });

const decode = Schema.decodeUnknownSync(Chat.protocol.stream.event);

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Chat.protocol.stream.initial(makeRequest());
  const allEvents: Array<Record<string, unknown>> = [];
  for (const frame of frames) {
    const [next, events] = await Effect.runPromise(
      Chat.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    allEvents.push(...(events as Array<Record<string, unknown>>));
  }
  allEvents.push(
    ...((Chat.protocol.stream.onHalt
      ? await Effect.runPromise(Chat.protocol.stream.onHalt(state))
      : []) as Array<Record<string, unknown>>),
  );
  return allEvents;
};

const chunk = (
  delta: Record<string, unknown>,
  finish: string | null = null,
  extra: Record<string, unknown> = {},
) => ({
  id: 'compat',
  choices: [{ index: 0, delta, finish_reason: finish, ...extra }],
});

const collect = (events: ReadonlyArray<{ type?: unknown; text?: unknown }>, type: string) =>
  events
    .filter((event) => event.type === type)
    .map((event) => String(event.text ?? ''))
    .join('');

describe('OpenAI Chat delta 兼容字段对齐', () => {
  it('refusal 作为正文渲染（否则整轮回答会表现为正文为空）', async () => {
    const events = await runFrames([chunk({ refusal: '无法提供该内容。' }, 'stop')]);

    expect(collect(events, 'text-delta')).toBe('无法提供该内容。');
  });

  it('兼容 reasoning / reasoning_text 字段名变体', async () => {
    const byReasoning = await runFrames([chunk({ reasoning: '使用 reasoning 字段' }, 'stop')]);
    expect(collect(byReasoning, 'reasoning-delta')).toBe('使用 reasoning 字段');

    const byReasoningText = await runFrames([
      chunk({ reasoning_text: '使用 reasoning_text 字段' }, 'stop'),
    ]);
    expect(collect(byReasoningText, 'reasoning-delta')).toBe('使用 reasoning_text 字段');
  });

  it('从 reasoning_details 提取 reasoning.text / reasoning.summary', async () => {
    const events = await runFrames([
      chunk(
        {
          reasoning_details: [
            { type: 'reasoning.text', text: '结构化思考一' },
            { type: 'reasoning.summary', summary: '结构化摘要二' },
          ],
        },
        'stop',
      ),
    ]);

    expect(collect(events, 'reasoning-delta')).toBe('结构化思考一结构化摘要二');
  });

  it('思维链是响应级通道：正文出现不会关闭思维链块', async () => {
    const events = await runFrames([
      chunk({ reasoning_content: '前段思考' }),
      chunk({ content: '正文' }),
      chunk({ reasoning_content: '后段思考' }, 'stop'),
    ]);

    expect(collect(events, 'reasoning-delta')).toBe('前段思考后段思考');
    expect(collect(events, 'text-delta')).toBe('正文');
    // 只应在回合结束时关闭一次（1 个 reasoning-end），而不是正文出现时反复开关。
    const reasoningEnds = events.filter((event) => event.type === 'reasoning-end');
    expect(reasoningEnds).toHaveLength(1);
  });

  it('choice.usage 与顶层 usage 等价（Moonshot 类网关）', async () => {
    const events = await runFrames([
      chunk({}, 'stop', {
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      }),
    ]);

    const finish = events.find((event) => event.type === 'finish') as
      | { usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number } }
      | undefined;
    expect(finish?.usage?.inputTokens).toBe(11);
    expect(finish?.usage?.outputTokens).toBe(7);
    expect(finish?.usage?.reasoningTokens).toBe(3);
  });

  it('content 数组形态仍按正文拼接（既有行为保持）', async () => {
    const events = await runFrames([
      chunk(
        {
          content: [
            { type: 'text', text: '数组' },
            { type: 'text', text: '正文' },
          ],
        },
        'stop',
      ),
    ]);

    expect(collect(events, 'text-delta')).toBe('数组正文');
  });
});

/**
 * 终态语义对齐（对齐 opencode 参考库的 finish 处理）。
 */
describe('OpenAI Chat 终态语义对齐', () => {
  it('未知 finish_reason 视为上游异常（不再静默折叠为正常结束）', async () => {
    await expect(
      runFrames([chunk({ content: '部分内容' }, 'some_relay_specific_reason')]),
    ).rejects.toThrow(/finish_reason/);
  });

  it('error / network_error 同样按上游异常处理', async () => {
    await expect(runFrames([chunk({}, 'error')])).rejects.toThrow(/finish_reason/);
    await expect(runFrames([chunk({}, 'network_error')])).rejects.toThrow(/finish_reason/);
  });

  it('流在终态事件前结束（无 finish_reason）时以 incomplete-stream 失败', async () => {
    // 对齐 opencode：`onHalt` 返回 Effect，可让整条流失败（触发上层重试），
    // 而不是把截断的响应当成正常收尾。
    await expect(runFrames([chunk({ content: '被截断的正文' })])).rejects.toThrow(
      /without finish_reason/,
    );
  });

  it('finish_reason 之后仍收到内容视为异常', async () => {
    await expect(runFrames([chunk({}, 'stop'), chunk({ content: '迟到内容' })])).rejects.toThrow(
      /after the finish reason/,
    );
  });

  it('stop / end 都归一化为正常结束', async () => {
    const byStop = await runFrames([chunk({ content: '一' }, 'stop')]);
    const byEnd = await runFrames([chunk({ content: '二' }, 'end')]);

    expect(collect(byStop, 'text-delta')).toBe('一');
    expect(collect(byEnd, 'text-delta')).toBe('二');
    expect(byStop.some((event) => event.type === 'provider-error')).toBe(false);
    expect(byEnd.some((event) => event.type === 'provider-error')).toBe(false);
  });
});
