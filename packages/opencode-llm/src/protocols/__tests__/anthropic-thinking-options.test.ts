import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import type { HttpPrepared } from '../../route/transport/http.js';
import * as AnthropicMessages from '../anthropic-messages.js';
import { Message } from '../../schema/index.js';

/**
 * Anthropic thinking provider options 对齐（对齐 opencode 参考库）：
 * `adaptive` / `disabled` 原样下发（此前只认 `enabled`，网关的 adaptive
 * 思考会被静默丢弃）；`display` 透传；官方端点走 `?beta=true`。
 */

const prepare = async (
  providerOptions: Record<string, unknown>,
  route = AnthropicMessages.route,
  modelId = 'claude-opus-5',
) => {
  const model = route.model({ id: modelId });
  const request = LLM.request({
    model,
    prompt: 'hello',
    providerOptions: { anthropic: providerOptions },
  });
  const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
  const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));
  return { body, prepared };
};

const urlOf = (prepared: HttpPrepared<unknown>): string => prepared.request.url;

describe('Anthropic thinking provider options', () => {
  it('adaptive 思考原样下发（无需 budget）', async () => {
    const { body } = await prepare({ thinking: { type: 'adaptive' } });

    expect(body.thinking).toEqual({ type: 'adaptive' });
  });

  it('disabled 思考原样下发', async () => {
    const { body } = await prepare({ thinking: { type: 'disabled' } });

    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('enabled 接受 budgetTokens / budget_tokens 两种拼写并透传 display', async () => {
    const camel = await prepare({
      thinking: { type: 'enabled', budgetTokens: 4096, display: 'summarized' },
    });
    // 4096 顶着默认输出上限（4096），被压到一半 2048（对齐参考库的预算钳制）。
    expect(camel.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 2048,
      display: 'summarized',
    });

    const snake = await prepare({ thinking: { type: 'enabled', budget_tokens: 2048 } });
    expect(snake.body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('思考预算贴着输出上限时被压到一半，且不低于 1024', async () => {
    const { body } = await prepare({
      thinking: { type: 'enabled', budgetTokens: 100_000 },
    });

    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 2048 });
  });

  it('输出上限极小时预算钳到最小值 1024', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = LLM.request({
      model,
      prompt: 'hello',
      generation: { maxTokens: 1500 },
      providerOptions: { anthropic: { thinking: { type: 'enabled', budgetTokens: 1400 } } },
    });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));

    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 1024 });
  });

  it('低于上限一半的预算原样透传（-1 / 0 等特殊值不干预）', async () => {
    for (const budgetTokens of [1024, 2048, -1, 0]) {
      const { body } = await prepare({ thinking: { type: 'enabled', budgetTokens } });

      expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: budgetTokens });
    }
  });

  it('between_tools 思考模式原样下发（不补 block_binding）', async () => {
    const { body } = await prepare({ thinking: { type: 'between_tools' } });

    expect(body.thinking).toEqual({ type: 'between_tools' });
  });

  it('enabled 缺少 budget 时在边界报错', async () => {
    await expect(prepare({ thinking: { type: 'enabled' } })).rejects.toThrow(/budgetTokens/);
  });

  it('官方端点使用 ?beta=true，中转端点保持普通路径', async () => {
    const official = await prepare({});
    expect(urlOf(official.prepared)).toContain('/messages?beta=true');

    const relay = await prepare(
      {},
      AnthropicMessages.route.with({
        provider: 'mimo',
        endpoint: { baseURL: 'https://relay.example/v1' },
      }),
    );
    expect(urlOf(relay.prepared)).not.toContain('beta=true');
    expect(urlOf(relay.prepared)).toContain('/messages');
  });
});

/**
 * 对齐参考库：Claude >= 5.1 默认下发
 * `thinking.block_binding.prefix_mismatch_behavior = 'drop_block'`
 * （未显式配置 thinking 时补 adaptive），并请求对应 beta。
 */
describe('Anthropic thinking block binding', () => {
  it('Claude 5.1 未配置 thinking 时补 adaptive + block_binding 默认值', async () => {
    const { body, prepared } = await prepare({}, AnthropicMessages.route, 'claude-opus-5.1');

    expect(body.thinking).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'drop_block' },
    });
    expect(prepared.request.headers['anthropic-beta']).toContain(
      'thinking-binding-controls-2026-08-01',
    );
  });

  it('显式 prefix_mismatch_behavior 优先于默认值', async () => {
    const { body } = await prepare(
      { thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'error' } } },
      AnthropicMessages.route,
      'claude-opus-5.1',
    );

    expect(body.thinking).toEqual({
      type: 'adaptive',
      block_binding: { prefix_mismatch_behavior: 'error' },
    });
  });

  it('disabled 不注入 block_binding，也不请求 binding beta', async () => {
    const { body, prepared } = await prepare(
      { thinking: { type: 'disabled' } },
      AnthropicMessages.route,
      'claude-opus-5.1',
    );

    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(prepared.request.headers['anthropic-beta'] ?? '').not.toContain(
      'thinking-binding-controls',
    );
  });

  it('Claude 5.0 不注入默认 block_binding', async () => {
    const { body } = await prepare({}, AnthropicMessages.route, 'claude-opus-5');

    expect(body.thinking).toBeUndefined();
  });

  it('compatibility 显式关闭时不注入', async () => {
    const route = AnthropicMessages.route;
    const model = route.model({
      id: 'claude-opus-5.1',
      compatibility: { supportsThinkingBlockBinding: false },
    });
    const request = LLM.request({ model, prompt: 'hello' });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));

    expect(body.thinking).toBeUndefined();
  });
});

/**
 * 无签名 thinking block 的 provider 判定（`requireThinkingSignature`）。
 *
 * Moonshot / Kimi 系经 anthropic 端点时不产出签名，必须按「不需要签名」处理，
 * 否则无签名块会被丢弃、思维链从回传历史里消失。上游把这些写在
 * `providers/moonshot.ts` 的 `requireSignature: false`；本地按 provider id /
 * 模型名 / 端点三路推断 —— 这里守护上游 provider id `moonshot` 也命中。
 */
describe('无签名 thinking block 的 provider 判定', () => {
  const lowerWithProvider = async (provider: string, modelID = 'kimi-k2') => {
    const route = AnthropicMessages.route.with({ provider });
    const model = route.model({ id: modelID });
    const request = LLM.request({
      model,
      messages: [
        Message.make({
          role: 'assistant',
          content: [{ type: 'reasoning', text: '内部推理' }],
        }),
      ],
    });
    return Effect.runPromise(AnthropicMessages.protocol.body.from(request));
  };

  const blocksOf = (body: { messages: ReadonlyArray<{ content: unknown }> }, type: string) =>
    (body.messages[0]?.content as ReadonlyArray<{ type?: string }> | undefined)?.filter(
      (part) => part.type === type,
    ) ?? [];

  it('上游 provider id `moonshot` 保留无签名 thinking 块（空签名）', async () => {
    const body = await lowerWithProvider('moonshot');
    const thinking = blocksOf(body, 'thinking') as ReadonlyArray<{ signature?: string }>;

    expect(thinking).toHaveLength(1);
    expect(thinking[0]?.signature).toBe('');
    expect(blocksOf(body, 'text')).toHaveLength(0);
  });

  it('catalog id `moonshotai` 同样保留（别名一致性）', async () => {
    const body = await lowerWithProvider('moonshotai');

    expect(blocksOf(body, 'thinking')).toHaveLength(1);
  });

  it('原生 Anthropic 把无签名 thinking 块降级为 text（需要签名）', async () => {
    const body = await lowerWithProvider('anthropic', 'claude-opus-5');

    expect(blocksOf(body, 'thinking')).toHaveLength(0);
    expect(blocksOf(body, 'text')).toHaveLength(1);
  });
});
