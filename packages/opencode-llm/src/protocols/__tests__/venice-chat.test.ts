/**
 * Venice Chat 协议契约测试（对齐上游 `venice-chat.ts`）。
 *
 * 三块专有行为必须成立：
 * 1. 请求侧 `venice_parameters` 转 snake_case 且显式带 `includeVeniceSystemPrompt: false`；
 * 2. `reasoning` 对象承载档位（不下发 OpenAI 的扁平 `reasoning_effort`）；
 * 3. 加密推理（`__ENCRYPTED_REASONING__` 之后）不进事件流，但作为密文随
 *    `reasoning-end` 的 `providerMetadata.venice.encryptedReasoningContent` 下发。
 */

import { describe, expect, it } from 'vitest';
import { Effect } from 'effect';
import * as VeniceChat from '../venice-chat.js';
import * as Venice from '../../providers/venice.js';
import {
  LLMEvent,
  LLMRequest,
  Message,
  Model,
  ToolCallPart,
  type ContentPart,
} from '../../schema/index.js';

const model = Model.make({
  id: 'llama-3.3-70b',
  provider: 'venice',
  // 路由由 provider 门面提供（协议本身不含 endpoint/auth）。
  route: Venice.route,
});

const requestOf = (input: {
  readonly providerOptions?: Record<string, unknown>;
  readonly messages?: ReadonlyArray<Message>;
  readonly maxTokens?: number;
  readonly topK?: number;
}) =>
  new LLMRequest({
    model,
    system: [],
    messages: [...(input.messages ?? [])],
    tools: [],
    ...(input.providerOptions === undefined ? {} : { providerOptions: input.providerOptions }),
    ...(input.maxTokens === undefined && input.topK === undefined
      ? {}
      : {
          generation: {
            ...(input.maxTokens === undefined ? {} : { maxTokens: input.maxTokens }),
            ...(input.topK === undefined ? {} : { topK: input.topK }),
          },
        }),
  });

const lower = (input: Parameters<typeof requestOf>[0]) =>
  Effect.runPromise(VeniceChat.protocol.body.from(requestOf(input)));

const streamEvent = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  choices: [{ index: 0, delta }],
  ...extra,
});

describe('Venice Chat 请求侧', () => {
  it('venice_parameters 转 snake_case 并显式带 includeVeniceSystemPrompt: false', async () => {
    const body = await lower({
      providerOptions: {
        venice: { veniceParameters: { enableWebScraping: true, characterSlug: 'guide' } },
      },
    });

    expect(body.venice_parameters).toEqual({
      enable_web_scraping: true,
      character_slug: 'guide',
      include_venice_system_prompt: false,
    });
  });

  it('调用方显式开启 includeVeniceSystemPrompt 时按 true 下发', async () => {
    const body = await lower({
      providerOptions: {
        venice: { veniceParameters: { includeVeniceSystemPrompt: true } },
      },
    });

    expect(body.venice_parameters).toEqual({ include_venice_system_prompt: true });
  });

  it('reasoningEffort 合并进 reasoning 对象，且不下发扁平 reasoning_effort', async () => {
    const body = await lower({
      providerOptions: { venice: { reasoningEffort: 'high', reasoning: { summary: 'concise' } } },
    });

    expect(body.reasoning).toEqual({ effort: 'high', summary: 'concise' });
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('max_completion_tokens 依次取 options.maxCompletionTokens → maxTokens → generation', async () => {
    const byOptions = await lower({
      providerOptions: { venice: { maxCompletionTokens: 111, maxTokens: 222 } },
      maxTokens: 333,
    });
    expect(byOptions.max_completion_tokens).toBe(111);

    const byMaxTokens = await lower({
      providerOptions: { venice: { maxTokens: 222 } },
      maxTokens: 333,
    });
    expect(byMaxTokens.max_completion_tokens).toBe(222);

    const byGeneration = await lower({ maxTokens: 333 });
    expect(byGeneration.max_completion_tokens).toBe(333);
  });

  it('top_k 取 generation.topK，采样参数按 snake_case 下发', async () => {
    const body = await lower({
      providerOptions: { venice: { minP: 0.1, repetitionPenalty: 1.2, maxTemp: 0.9 } },
      topK: 40,
    });

    expect(body.top_k).toBe(40);
    expect(body.min_p).toBe(0.1);
    expect(body.repetition_penalty).toBe(1.2);
    expect(body.max_temp).toBe(0.9);
  });

  it('assistant 的 providerMetadata.venice 回写 thought_signature 与加密推理', async () => {
    const assistant = Message.make({
      role: 'assistant',
      content: [
        {
          type: 'reasoning',
          text: '思考',
          providerMetadata: { venice: { encryptedReasoningContent: 'CIPHER' } },
        } satisfies ContentPart,
        {
          type: 'tool-call',
          id: 'call_1',
          name: 'read_file',
          input: { path: 'a.ts' },
          providerMetadata: { venice: { thoughtSignature: 'SIG-TOOL' } },
        } satisfies ContentPart,
      ],
    });

    const body = await lower({ messages: [assistant] });
    const message = body.messages[0] as {
      reasoning_content?: string;
      tool_calls?: ReadonlyArray<{ thought_signature?: string }>;
    };

    expect(message.reasoning_content).toBe('CIPHER');
    expect(message.tool_calls?.[0]?.thought_signature).toBe('SIG-TOOL');
  });
});

describe('Venice Chat 加密推理的流式拆分', () => {
  // 末尾必须补一个带 `finish_reason` 的帧：否则共享状态机的 `finishEvents`
  // 会判定「响应在终态事件前结束」并抛 incomplete-stream。
  const drive = async (deltas: ReadonlyArray<Record<string, unknown>>, finishReason = 'stop') => {
    let state = VeniceChat.protocol.stream.initial(requestOf({}));
    const produced: LLMEvent[] = [];
    const frames: ReadonlyArray<unknown> = [
      ...deltas.map((delta) => streamEvent(delta)),
      { choices: [{ index: 0, finish_reason: finishReason }] },
    ];
    for (const frame of frames) {
      const [next, events] = await Effect.runPromise(
        VeniceChat.protocol.stream.step(state, frame as never),
      );
      state = next;
      produced.push(...events);
    }
    const tail = await Effect.runPromise(VeniceChat.protocol.stream.onHalt(state));
    return { state, events: [...produced, ...tail] };
  };

  const reasoningText = (events: ReadonlyArray<LLMEvent>) =>
    events
      .filter(LLMEvent.is.reasoningDelta)
      .map((event) => event.text)
      .join('');

  it('标记之前的内容作为可见推理下发', async () => {
    const { events } = await drive([{ reasoning_content: '可见推理' }]);

    expect(reasoningText(events)).toBe('可见推理');
  });

  it('标记之后的内容不下发为可见推理，但作为密文随 reasoning-end 带走', async () => {
    const { events } = await drive([{ reasoning_content: '可见__ENCRYPTED_REASONING__CIPHER' }]);

    expect(reasoningText(events)).toBe('可见');
    const end = events.find(LLMEvent.is.reasoningEnd);
    expect(end?.providerMetadata?.['venice']).toMatchObject({
      encryptedReasoningContent: '可见__ENCRYPTED_REASONING__CIPHER',
    });
  });

  it('标记跨帧到达时不会把半个标记泄漏成可见文本', async () => {
    const { events } = await drive([
      { reasoning_content: '可见__ENCRY' },
      { reasoning_content: 'PTED_REASONING__CIPHER' },
    ]);

    expect(reasoningText(events)).toBe('可见');
    const end = events.find(LLMEvent.is.reasoningEnd);
    expect(end?.providerMetadata?.['venice']).toMatchObject({
      encryptedReasoningContent: '可见__ENCRYPTED_REASONING__CIPHER',
    });
  });

  it('工具调用的 thought_signature 随 tool-call 的 providerMetadata 下发', async () => {
    const { events } = await drive(
      [
        {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{}' },
              thought_signature: 'SIG-1',
            },
          ],
        },
      ],
      'tool_calls',
    );

    const call = events.find(LLMEvent.is.toolCall);
    expect(call?.providerMetadata?.['venice']).toMatchObject({ thoughtSignature: 'SIG-1' });
  });
});

/** 保证 `ToolCallPart`/`Message` 的构造形态与协议期望一致（编译期守护）。 */
void ToolCallPart;
