import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';
import * as Gemini from '../gemini.js';
import { GenerationOptions, LLMEvent, LLMRequest } from '../../schema/index.js';

const decode = Schema.decodeUnknownSync(Gemini.protocol.stream.event);

const runFrames = async (frames: ReadonlyArray<unknown>) => {
  let state = Gemini.protocol.stream.initial();
  const events: LLMEvent[] = [];
  for (const frame of frames) {
    const [next, emitted] = await Effect.runPromise(
      Gemini.protocol.stream.step(state, decode(JSON.stringify(frame))),
    );
    state = next;
    events.push(...emitted);
  }
  return { state, events };
};

describe('Gemini 流式恢复', () => {
  it('functionCall 缺省 args 时降级为空对象', async () => {
    const { events } = await runFrames([
      { candidates: [{ content: { parts: [{ functionCall: { name: 'get_time' } }] } }] },
    ]);

    expect(events.find(LLMEvent.is.toolCall)?.input).toEqual({});
  });

  it('跳过未知 part 而不是中断整帧', async () => {
    const { events } = await runFrames([
      {
        candidates: [
          {
            content: {
              parts: [{ executableCode: { language: 'PYTHON', code: 'print(1)' } }],
            },
          },
        ],
      },
    ]);

    expect(events).toEqual([]);
  });

  it('显式 null 字段不会导致整帧解码失败', async () => {
    const { state } = await runFrames([
      {
        candidates: [{ content: null, finishReason: null }],
        usageMetadata: { promptTokenCount: null, totalTokenCount: null },
        promptFeedback: null,
      },
    ]);

    expect(state.finishReason).toBeUndefined();
  });

  it('error 事件映射为 provider-error 并保留可重试语义', async () => {
    const { events } = await runFrames([
      { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota exceeded' } },
    ]);

    const error = events.find(LLMEvent.is.providerError);
    expect(error?.message).toBe('quota exceeded');
    expect(error?.retryable).toBe(true);
  });

  it('MALFORMED_FUNCTION_CALL 终止原因映射为 provider-error', async () => {
    const { events } = await runFrames([
      { candidates: [{ finishReason: 'MALFORMED_FUNCTION_CALL' }] },
    ]);

    expect(events.find(LLMEvent.is.providerError)?.message).toContain('MALFORMED_FUNCTION_CALL');
    expect(events.filter(LLMEvent.is.finish)).toHaveLength(0);
  });

  it('保留供应商 functionCall id，并对重复 id 铸造唯一回退 id', async () => {
    const { events } = await runFrames([
      {
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { id: 'call_dup', name: 'a' } },
                { functionCall: { id: 'call_dup', name: 'b' } },
                { functionCall: { name: 'c' } },
              ],
            },
          },
        ],
      },
    ]);

    const calls = events.filter(LLMEvent.is.toolCall);
    expect(calls.map((call) => call.id)).toEqual([
      'call_dup',
      expect.stringMatching(/^tool_/),
      expect.stringMatching(/^tool_/),
    ]);
    const ids = new Set(calls.map((call) => call.id));
    expect(ids.size).toBe(3);
  });

  it('下发 frequencyPenalty/presencePenalty/seed 与默认 includeThoughts', async () => {
    const request = new LLMRequest({
      model: Gemini.route.model({ id: 'gemini-2.5-pro' }),
      system: [],
      messages: [],
      tools: [],
      generation: GenerationOptions.make({ frequencyPenalty: 0.5, presencePenalty: 0.2, seed: 7 }),
      providerOptions: { gemini: { thinkingConfig: { thinkingBudget: 1024 } } },
    });

    const body = await Effect.runPromise(Gemini.protocol.body.from(request));
    expect(body.generationConfig).toMatchObject({
      frequencyPenalty: 0.5,
      presencePenalty: 0.2,
      seed: 7,
      thinkingConfig: { thinkingBudget: 1024, includeThoughts: true },
    });
  });

  it('文本后接工具调用时先关闭 text 块', async () => {
    const { events } = await runFrames([
      { candidates: [{ content: { parts: [{ text: '想说点话' }] } }] },
      { candidates: [{ content: { parts: [{ functionCall: { name: 'get_time' } }] } }] },
    ]);

    const types = events.map((event) => event.type);
    expect(types.indexOf('text-end')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('text-end')).toBeLessThan(types.indexOf('tool-call'));
  });

  it('仅 promptFeedback.blockReason 时 finish 归类为 content-filter', async () => {
    const { state } = await runFrames([{ promptFeedback: { blockReason: 'SAFETY' } }]);

    const finished = Gemini.protocol.stream.onHalt?.(state) ?? [];
    const terminal = finished.find(LLMEvent.is.finish);
    expect(terminal?.reason).toBe('content-filter');
    expect(terminal?.reasonRaw).toBe('SAFETY');
  });

  it('有 finishReason 时以模型自身原因为准，不被 promptFeedback 覆盖', async () => {
    const { state } = await runFrames([
      { promptFeedback: { blockReason: 'SAFETY' } },
      { candidates: [{ finishReason: 'STOP' }] },
    ]);

    const finished = Gemini.protocol.stream.onHalt?.(state) ?? [];
    const terminal = finished.find(LLMEvent.is.finish);
    expect(terminal?.reason).toBe('stop');
    expect(terminal?.reasonRaw).toBe('STOP');
  });
});
