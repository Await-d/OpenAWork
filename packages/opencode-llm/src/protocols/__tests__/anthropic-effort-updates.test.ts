import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as LLM from '../../llm.js';
import { LLMClient } from '../../route/client.js';
import { Message } from '../../schema/index.js';
import * as AnthropicMessages from '../anthropic-messages.js';
import * as OpenAIChat from '../openai-chat.js';

/**
 * 时序 effort 更新对齐（对齐 opencode 参考库）：
 * 支持的路由（Anthropic Messages）把 `Message.effort(...)` 标记降级为原生
 * `output_config` system 消息，并把顶层 effort 冻结在首个标记的 `previous`；
 * 其余路由在编译期剥离标记。
 */

const lower = async (
  model: ReturnType<typeof AnthropicMessages.route.model>,
  messages: Message[],
  providerOptions?: Record<string, unknown>,
) => {
  const request = LLM.request({
    model,
    messages,
    ...(providerOptions === undefined ? {} : { providerOptions: { anthropic: providerOptions } }),
  });
  const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));
  const prepared = await Effect.runPromise(model.route.prepareTransport(body, request));
  return { body, prepared };
};

describe('Anthropic 时序 effort 更新', () => {
  it('标记降级为原生 output_config 消息，顶层 effort 冻结在 previous', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const { body, prepared } = await lower(
      model,
      [
        Message.user('开始'),
        Message.effort({ effort: 'high', previous: 'low' }),
        Message.user('继续'),
      ],
      { effort: 'high' },
    );

    // 顶层 effort = 首个标记的 previous（冻结，避免缓存整体失效）。
    expect(body.output_config).toEqual({ effort: 'low' });
    // 标记位置产出原生 system + output_config 消息。
    const effortMessage = body.messages.find(
      (message) => message.role === 'system' && message.output_config !== undefined,
    );
    expect(effortMessage).toMatchObject({ content: [], output_config: { effort: 'high' } });
    expect(prepared.request.headers['anthropic-beta']).toContain(
      'mid-conversation-output-config-2026-07-01',
    );
  });

  it('未给出 effort 的标记使用默认 high', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const { body } = await lower(model, [Message.effort({}), Message.user('继续')]);

    const effortMessage = body.messages.find(
      (message) => message.role === 'system' && message.output_config !== undefined,
    );
    expect(effortMessage).toMatchObject({ content: [], output_config: { effort: 'high' } });
  });

  it('不支持时序更新的模型剥离标记，且不请求 beta', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-haiku-4' });
    const { body, prepared } = await lower(model, [
      Message.user('开始'),
      Message.effort({ effort: 'high', previous: 'low' }),
      Message.user('继续'),
    ]);

    expect(
      body.messages.some(
        (message) => message.role === 'system' && message.output_config !== undefined,
      ),
    ).toBe(false);
    expect(prepared.request.headers['anthropic-beta'] ?? '').not.toContain(
      'mid-conversation-output-config',
    );
  });

  it('回退 / 分叉历史（最后一个标记与请求 effort 不一致）剥离全部标记', async () => {
    const model = AnthropicMessages.route.model({ id: 'claude-opus-5' });
    const request = LLM.request({
      model,
      messages: [Message.effort({ effort: 'high', previous: 'low' }), Message.user('继续')],
      providerOptions: { anthropic: { output_config: { effort: 'medium' } } },
    });
    const body = await Effect.runPromise(AnthropicMessages.protocol.body.from(request));

    expect(
      body.messages.some(
        (message) => message.role === 'system' && message.output_config !== undefined,
      ),
    ).toBe(false);
    expect(body.output_config).toEqual({ effort: 'medium' });
  });

  it('非 Anthropic 路由（OpenAI Chat）在编译期剥离标记', async () => {
    const model = OpenAIChat.route.model({ id: 'gpt-4.1' });
    const request = LLM.request({
      model,
      messages: [Message.effort({ effort: 'high', previous: 'low' }), Message.user('继续')],
    });
    const prepared = await Effect.runPromise(LLMClient.prepare(request));
    const body = prepared.body as { readonly messages: ReadonlyArray<{ readonly role: string }> };

    expect(body.messages.map((message) => message.role)).toEqual(['user']);
  });
});
