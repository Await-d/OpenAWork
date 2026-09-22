import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8, toUtf8 } from '@smithy/util-utf8';
import { Effect, Schema, Stream } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Bedrock from '../bedrock-converse.js';
import * as BedrockEventStream from '../bedrock-event-stream.js';
import { BedrockCache } from '../utils/bedrock-cache.js';
import { LLMEvent } from '../../schema/index.js';

const codec = new EventStreamCodec(toUtf8, fromUtf8);
const utf8 = new TextEncoder();
const decode = Schema.decodeUnknownSync(Bedrock.protocol.stream.event);

const runEvent = async (raw: Record<string, unknown>) => {
  const [next, events] = await Effect.runPromise(
    Bedrock.protocol.stream.step(Bedrock.protocol.stream.initial(), decode(raw)),
  );
  return { state: next, events };
};

const frame = (headers: Record<string, string>, body: Record<string, unknown> | undefined) =>
  codec.encode({
    headers: Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, { type: 'string' as const, value }]),
    ),
    body: body === undefined ? new Uint8Array() : utf8.encode(JSON.stringify(body)),
  });

const framing = BedrockEventStream.framing('bedrock-converse');

const collectFrames = (bytes: Uint8Array) =>
  Effect.runPromise(Stream.runCollect(framing.frame(Stream.fromIterable([bytes]))));

/** `onHalt` 返回 Effect（对齐 opencode 参考库）；测试里统一 await 取事件。 */
const haltEvents = async (
  state: Parameters<NonNullable<typeof Bedrock.protocol.stream.onHalt>>[0],
) => {
  const onHalt = Bedrock.protocol.stream.onHalt;
  return onHalt ? await Effect.runPromise(onHalt(state)) : [];
};

describe('Bedrock Converse 流式恢复', () => {
  it('只有 metadata 的流不会伪造 stop 完成', async () => {
    const { state } = await runEvent({
      metadata: { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } },
    });

    expect(await haltEvents(state)).toEqual([]);
  });

  it('message_stop + metadata 会发一次 finish 并带上 usage', async () => {
    let state = Bedrock.protocol.stream.initial();
    for (const raw of [
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } } },
    ]) {
      const [next] = await Effect.runPromise(Bedrock.protocol.stream.step(state, decode(raw)));
      state = next;
    }

    const events = await haltEvents(state);
    const finish = events.find(LLMEvent.is.finish);
    expect(finish?.reason).toBe('stop');
    expect(finish?.usage?.totalTokens).toBe(3);
  });

  it('exception 事件映射为 provider-error', async () => {
    const { events } = await runEvent({
      exception: { type: 'throttlingException', details: { message: 'slow down' } },
    });

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('slow down');
    expect(error?.retryable).toBe(true);
  });

  it('event-stream 的 error 帧不再被静默丢弃', async () => {
    const bytes = frame(
      {
        ':message-type': 'error',
        ':error-code': 'throttlingException',
        ':error-message': 'slow down',
      },
      undefined,
    );

    await expect(
      Effect.runPromise(Stream.runCollect(framing.frame(Stream.fromIterable([bytes])))),
    ).rejects.toThrow(/slow down/);
  });

  it('usage 把 inputTokens 与非缓存数按不变式拆分', async () => {
    let state = Bedrock.protocol.stream.initial();
    for (const raw of [
      { messageStop: { stopReason: 'end_turn' } },
      {
        metadata: {
          usage: {
            inputTokens: 5,
            cacheReadInputTokens: 3,
            cacheWriteInputTokens: 2,
            outputTokens: 4,
          },
        },
      },
    ]) {
      const [next] = await Effect.runPromise(Bedrock.protocol.stream.step(state, decode(raw)));
      state = next;
    }

    const finish = (await haltEvents(state)).find(LLMEvent.is.finish);
    expect(finish?.usage?.inputTokens).toBe(10);
    expect(finish?.usage?.nonCachedInputTokens).toBe(5);
    expect(finish?.usage?.cacheReadInputTokens).toBe(3);
    expect(finish?.usage?.cacheWriteInputTokens).toBe(2);
  });

  it('缓存断点只对支持显式缓存的 Claude 模型开启', () => {
    expect(BedrockCache.breakpoints('amazon.nova-pro-v1:0').supported).toBe(false);
    expect(BedrockCache.breakpoints('anthropic.claude-v2').supported).toBe(false);
    const fiveMinute = BedrockCache.breakpoints('us.anthropic.claude-3-5-sonnet-20241022-v2:0');
    expect(fiveMinute.supported).toBe(true);
    expect(fiveMinute.ttl1h).toBe(false);
    expect(BedrockCache.breakpoints('anthropic.claude-sonnet-4-5-20250929-v1:0').ttl1h).toBe(true);
  });

  it('孤立 tool delta（无 open block）被忽略而不是中断整轮', async () => {
    const { events } = await runEvent({
      contentBlockDelta: { contentBlockIndex: 5, delta: { toolUse: { input: '{}' } } },
    });

    expect(events).toEqual([]);
  });

  it('malformed stop reason 直接判定为错误', async () => {
    await expect(
      Effect.runPromise(
        Bedrock.protocol.stream.step(
          Bedrock.protocol.stream.initial(),
          decode({ messageStop: { stopReason: 'malformed_tool_use' } }),
        ),
      ),
    ).rejects.toThrow(/malformed_tool_use/);
  });

  it('model_context_window_exceeded 归一为 length', async () => {
    const [state] = await Effect.runPromise(
      Bedrock.protocol.stream.step(
        Bedrock.protocol.stream.initial(),
        decode({ messageStop: { stopReason: 'model_context_window_exceeded' } }),
      ),
    );

    const finished = await haltEvents(state);
    const terminal = finished.find(LLMEvent.is.finish);
    expect(terminal?.reason).toBe('length');
    expect(terminal?.reasonRaw).toBe('model_context_window_exceeded');
  });

  it('末尾残留半帧会被判为 incomplete-stream', async () => {
    const complete = frame(
      { ':message-type': 'event', ':event-type': 'messageStop' },
      { stopReason: 'end_turn' },
    );
    const truncated = complete.subarray(0, complete.length - 4);

    await expect(
      Effect.runPromise(Stream.runCollect(framing.frame(Stream.fromIterable([truncated])))),
    ).rejects.toThrow(/Incomplete Bedrock Converse event-stream frame/);
  });

  it('event-stream 的 exception 帧会被解码并交给协议处理', async () => {
    const bytes = frame(
      {
        ':message-type': 'exception',
        ':exception-type': 'validationException',
        ':content-type': 'application/json',
      },
      { message: 'input too long' },
    );

    const frames = await collectFrames(bytes);
    const raw = Array.from(frames)[0] as { rawBody?: string };
    expect(raw.rawBody).toContain('input too long');
    const decoded = decode(Array.from(frames)[0]);
    const [, events] = await Effect.runPromise(
      Bedrock.protocol.stream.step(Bedrock.protocol.stream.initial(), decoded),
    );

    expect(events.find(LLMEvent.is.providerError)?.message).toBe('input too long');
  });
});
