import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Anthropic from '../anthropic-messages.js';
import { LLMEvent } from '../../schema/index.js';

const decode = Schema.decodeUnknownSync(Anthropic.protocol.stream.event);

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Anthropic.protocol.stream.initial();
  const events: LLMEvent[] = [];
  for (const frame of frames) {
    const [next, emitted] = await Effect.runPromise(
      Anthropic.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    events.push(...emitted);
  }
  return { state, events };
};

const messageStart = {
  type: 'message_start',
  message: { usage: { input_tokens: 10, output_tokens: 1 } },
};

/** `onHalt` 返回 Effect（对齐 opencode 参考库）；测试里统一 await 取事件。 */
const haltEvents = async (
  state: Parameters<NonNullable<typeof Anthropic.protocol.stream.onHalt>>[0],
) => {
  const onHalt = Anthropic.protocol.stream.onHalt;
  return onHalt ? await Effect.runPromise(onHalt(state)) : [];
};

describe('Anthropic Messages 流式恢复', () => {
  it('单个 message_delta 只记录终止原因，finish 由 message_stop 发一次', async () => {
    const { state, events } = await runFrames([
      messageStart,
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ]);

    expect(events.filter(LLMEvent.is.finish)).toHaveLength(1);
    expect(events.find(LLMEvent.is.finish)?.reason).toBe('stop');
    expect(await haltEvents(state)).toEqual([]);
  });

  it('重复的 message_delta / message_stop 不会重复发出 finish', async () => {
    const { events } = await runFrames([
      messageStart,
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
      { type: 'message_stop' },
      { type: 'message_stop' },
    ]);

    expect(events.filter(LLMEvent.is.finish)).toHaveLength(1);
  });

  it('仅带 usage 的 message_delta 不会提前结束回合', async () => {
    const { events } = await runFrames([
      messageStart,
      { type: 'message_delta', delta: {}, usage: { output_tokens: 4 } },
    ]);

    expect(events.filter(LLMEvent.is.finish)).toHaveLength(0);
  });

  it('缺失 content_block_stop 时在 message_stop 补发工具调用', async () => {
    const { state, events } = await runFrames([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'bash' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"command":"ls"' },
      },
      { type: 'message_delta', delta: { stop_reason: 'max_tokens' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ]);

    const calls = events.filter(LLMEvent.is.toolCall);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('bash');
    expect(calls[0]?.input).toEqual({ command: 'ls' });
    expect(events.filter(LLMEvent.is.finish)).toHaveLength(1);
    expect(events.find(LLMEvent.is.finish)?.reason).toBe('length');
    expect(await haltEvents(state)).toEqual([]);
  });

  it('缺失 message_stop 时由 onHalt 兜底补一次 finish', async () => {
    const { state, events } = await runFrames([
      messageStart,
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    ]);

    expect(events.filter(LLMEvent.is.finish)).toHaveLength(0);
    const halted = await haltEvents(state);
    expect(halted.filter(LLMEvent.is.finish)).toHaveLength(1);
    expect(halted.find(LLMEvent.is.finish)?.reason).toBe('stop');
  });

  it('redacted_thinking 块以元数据形式保留', async () => {
    const { events } = await runFrames([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'redacted_thinking', data: 'opaque-payload' },
      },
    ]);

    const start = events.find(LLMEvent.is.reasoningStart);
    expect(start?.providerMetadata?.anthropic).toEqual({ redactedData: 'opaque-payload' });
  });

  it('孤立 input_json_delta 被忽略而不是中断整轮', async () => {
    const { events } = await runFrames([
      messageStart,
      {
        type: 'content_block_delta',
        index: 3,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
    ]);

    expect(events).toEqual([]);
  });

  it('content_block_start 携带的完整 input 会被采用', async () => {
    const { events } = await runFrames([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'toolu_9', name: 'bash', input: { command: 'ls' } },
      },
      { type: 'message_stop' },
    ]);

    expect(events.find(LLMEvent.is.toolCall)?.input).toEqual({ command: 'ls' });
  });

  it('content_block_start 携带的 thinking 签名会挂到 reasoningEnd', async () => {
    const { events } = await runFrames([
      messageStart,
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: 'hmm', signature: 'sig-start' },
      },
      { type: 'content_block_stop', index: 0 },
    ]);

    expect(events.find(LLMEvent.is.reasoningEnd)?.providerMetadata?.anthropic).toEqual({
      signature: 'sig-start',
    });
  });

  it('model_context_window_exceeded 归一为 length', async () => {
    const { events } = await runFrames([
      messageStart,
      {
        type: 'message_delta',
        delta: { stop_reason: 'model_context_window_exceeded' },
        usage: { output_tokens: 5 },
      },
      { type: 'message_stop' },
    ]);

    const finished = events.find(LLMEvent.is.finish);
    expect(finished?.reason).toBe('length');
    expect(finished?.reasonRaw).toBe('model_context_window_exceeded');
  });

  it('overloaded_error 映射为可重试的 provider-error', async () => {
    const { events } = await runFrames([
      messageStart,
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('overloaded_error: Overloaded');
    expect(error?.retryable).toBe(true);
  });

  it('完全没有终止原因时不发 finish（保持不完整语义）', async () => {
    const { state, events } = await runFrames([messageStart]);

    expect(events.filter(LLMEvent.is.finish)).toHaveLength(0);
    expect(await haltEvents(state)).toEqual([]);
  });
});
