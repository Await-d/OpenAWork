/**
 * `generate`/`stream` 入参归一化契约（对齐上游 packages/ai@v2.0.28 的重载）。
 *
 * 已构造的 `LLMRequest` 必须原样下发：调用方做过的 effort/cache 标注不能因为
 * 二次构造而丢失。
 */

import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import * as AnthropicMessages from '../protocols/anthropic-messages.js';
import * as LLM from '../llm.js';
import { LLMClientService } from '../route/client.js';
import { LLMRequest, Message, Model } from '../schema/index.js';

const model = Model.make({
  id: 'claude-opus-5-1',
  provider: 'test',
  route: AnthropicMessages.route,
});

const request = () =>
  new LLMRequest({
    model,
    system: [],
    messages: [Message.user('hi')],
    tools: [],
  });

describe('generate 入参归一化', () => {
  it('接受已构造的 LLMRequest 并原样下发', async () => {
    const seen: unknown[] = [];
    const layer = Layer.succeed(
      LLMClientService,
      LLMClientService.of({
        prepare: () => Effect.die('unused'),
        stream: (input) => {
          seen.push(input);
          return Stream.empty;
        },
        generate: (input) =>
          Effect.sync(() => {
            seen.push(input);
            return { id: 'x' } as never;
          }),
      }),
    );

    const prepared = request();
    await Effect.runPromise(LLM.generate(prepared).pipe(Effect.provide(layer)));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(prepared);
  });

  it('接受 RequestInput 并内部构造', async () => {
    const seen: unknown[] = [];
    const layer = Layer.succeed(
      LLMClientService,
      LLMClientService.of({
        prepare: () => Effect.die('unused'),
        stream: (input) => {
          seen.push(input);
          return Stream.empty;
        },
        generate: (input) =>
          Effect.sync(() => {
            seen.push(input);
            return { id: 'x' } as never;
          }),
      }),
    );

    await Effect.runPromise(
      LLM.generate({ model, prompt: 'hi' } as never).pipe(Effect.provide(layer)),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeInstanceOf(LLMRequest);
  });
});
