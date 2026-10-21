/**
 * Provider 门面默认值契约测试（对齐上游 packages/ai@v2.0.28）。
 *
 * 覆盖 T-29 / T-30：
 * - OpenAI Responses 门面不再隐式下发 `textVerbosity: 'low'`（上游已移除该默认）；
 * - OpenRouter 的 `reasoning.max_tokens` 按输出上限钳制。
 */

import { Effect } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import { LLMClient } from '../../route/client.js';
import { RequestExecutor } from '../../route/executor.js';
import * as OpenAI from '../openai.js';
import * as OpenRouter from '../openrouter.js';

// 走完整 compile：模型/路由级的 providerOptions 默认值只在 `resolveRequestOptions`
// 里合并，直接调 `protocol.body.from` 会绕过它们。
const prepareBody = (request: LLM.Request) =>
  Effect.runPromise(
    (
      LLMClient.prepare(request as never) as Effect.Effect<
        { body: Record<string, unknown> },
        unknown
      >
    ).pipe(
      Effect.provide(LLMClient.layer),
      Effect.provide(RequestExecutor.fetchLayer),
      Effect.provideService(FetchHttpClient.Fetch, globalThis.fetch),
    ),
  );

describe('OpenAI Responses 门面默认值', () => {
  it('gpt-5.x 保留 stateless 与加密思维链默认，但不再强制 textVerbosity', async () => {
    const model = OpenAI.configure({ apiKey: 'test-key' }).responses('gpt-5.1');
    const { body } = await prepareBody(LLM.request({ model, prompt: 'hi' }));

    expect(body.store).toBe(false);
    expect(body.include).toContain('reasoning.encrypted_content');
    // 上游已移除该隐式默认：未显式配置时不下发 verbosity。
    expect((body.text as { verbosity?: string } | undefined)?.verbosity).toBeUndefined();
  });

  it('显式配置的 textVerbosity 仍然透传', async () => {
    const model = OpenAI.configure({ apiKey: 'test-key' }).responses('gpt-5.1');
    const { body } = await prepareBody(
      LLM.request({ model, prompt: 'hi', providerOptions: { openai: { textVerbosity: 'high' } } }),
    );

    expect((body.text as { verbosity?: string } | undefined)?.verbosity).toBe('high');
  });
});

describe('OpenRouter reasoning 预算钳制', () => {
  const prepare = async (reasoning: Record<string, unknown>, maxTokens?: number) => {
    const model = OpenRouter.configure({ apiKey: 'test-key' }).model('anthropic/claude-opus-4-5');
    const { body } = await prepareBody(
      LLM.request({
        model,
        prompt: 'hi',
        ...(maxTokens === undefined ? {} : { generation: { maxTokens } }),
        providerOptions: { openrouter: { reasoning } },
      }),
    );
    return body;
  };

  it('max_tokens 顶着输出上限时被压到一半（下限 1024）', async () => {
    const body = await prepare({ max_tokens: 20_000, effort: 'high' }, 8_000);

    expect(body.reasoning).toEqual({ max_tokens: 4_000, effort: 'high' });
  });

  it('没有输出上限时原样透传', async () => {
    const body = await prepare({ max_tokens: 20_000 });

    expect(body.reasoning).toEqual({ max_tokens: 20_000 });
  });

  it('无 max_tokens 的 reasoning 不受影响', async () => {
    const body = await prepare({ effort: 'high' }, 8_000);

    expect(body.reasoning).toEqual({ effort: 'high' });
  });
});
