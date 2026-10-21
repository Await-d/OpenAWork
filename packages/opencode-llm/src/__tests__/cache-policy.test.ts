/**
 * 缓存策略单元测试（对齐上游 packages/ai@v2.0.28）
 *
 * 覆盖 T-11：AUTO 断点布局（最后工具 + 首末 system + 会话尾）、4 断点预算、
 * 路由白名单、`cacheFormat` 覆盖，以及网关类路由的模型名启发式。
 */

import { describe, it, expect } from 'vitest';
import { applyCachePolicy } from '../cache-policy.js';
import {
  CacheHint,
  LLMRequest,
  Message,
  Model,
  ToolDefinition,
  type CachePolicy,
  type SystemPart,
} from '../schema/index.js';
import type { AnyRoute } from '../route/client.js';
import * as AnthropicMessages from '../protocols/anthropic-messages.js';
import * as OpenAIChat from '../protocols/openai-chat.js';

const ephemeral = new CacheHint({ type: 'ephemeral' });

const modelFor = (
  route: AnyRoute,
  options: { id?: string; cacheFormat?: 'anthropic' | 'alibaba' } = {},
) =>
  Model.make({
    id: options.id ?? 'test-model',
    provider: 'test',
    route,
    compatibility:
      options.cacheFormat === undefined ? undefined : { cacheFormat: options.cacheFormat },
  });

const tool = (name: string): ToolDefinition =>
  new ToolDefinition({ name, description: name, inputSchema: { type: 'object' } });

const systemPart = (text: string, cached = false): SystemPart => ({
  type: 'text',
  text,
  cache: cached ? ephemeral : undefined,
});

const requestFor = (input: {
  readonly route: AnyRoute;
  readonly id?: string;
  readonly cacheFormat?: 'anthropic' | 'alibaba';
  readonly cache?: CachePolicy;
  readonly system?: ReadonlyArray<SystemPart>;
  readonly messages?: ReadonlyArray<Message>;
  readonly tools?: ReadonlyArray<ToolDefinition>;
}) =>
  new LLMRequest({
    model: modelFor(input.route, { id: input.id, cacheFormat: input.cacheFormat }),
    system: input.system ?? [],
    messages: input.messages ?? [],
    tools: input.tools ?? [],
    cache: input.cache,
  });

const cacheCount = (request: LLMRequest): number =>
  request.tools.filter((item) => item.cache !== undefined).length +
  request.system.filter((part) => part.cache !== undefined).length +
  request.messages.reduce(
    (count, message) =>
      count + message.content.filter((part) => 'cache' in part && part.cache !== undefined).length,
    0,
  );

/** 取消息中最后一个 content part 的 cache 标记。 */
const lastPartCached = (message: Message | undefined): boolean => {
  const part = message?.content.at(-1);
  return part !== undefined && 'cache' in part && part.cache !== undefined;
};

describe('applyCachePolicy', () => {
  it('auto：最后工具、首末 system、会话尾各落一个断点', () => {
    const request = requestFor({
      route: AnthropicMessages.route,
      system: [systemPart('base'), systemPart('project'), systemPart('session')],
      tools: [tool('read'), tool('write')],
      messages: [Message.user('one'), Message.assistant('two'), Message.user('three')],
    });

    const result = applyCachePolicy(request);

    expect(result.tools[0]?.cache).toBeUndefined();
    expect(result.tools[1]?.cache).toBeDefined();
    expect(result.system[0]?.cache).toBeDefined();
    expect(result.system[1]?.cache).toBeUndefined();
    expect(result.system[2]?.cache).toBeDefined();
    expect(lastPartCached(result.messages.at(-1))).toBe(true);
    expect(cacheCount(result)).toBe(4);
  });

  it('system 只有一段时只落一个断点', () => {
    const request = requestFor({
      route: AnthropicMessages.route,
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    const result = applyCachePolicy(request);

    expect(result.system[0]?.cache).toBeDefined();
    expect(cacheCount(result)).toBe(3);
  });

  it('非白名单路由不注入断点', () => {
    const request = requestFor({
      route: OpenAIChat.route,
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(applyCachePolicy(request)).toBe(request);
  });

  it('cache: none 时不注入断点', () => {
    const request = requestFor({
      route: AnthropicMessages.route,
      cache: 'none',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(applyCachePolicy(request)).toBe(request);
  });

  it('cacheFormat: anthropic 覆盖路由白名单', () => {
    const request = requestFor({
      route: OpenAIChat.route,
      cacheFormat: 'anthropic',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(cacheCount(applyCachePolicy(request))).toBe(3);
  });

  it('cacheFormat: alibaba 不落工具断点', () => {
    const request = requestFor({
      route: OpenAIChat.route,
      cacheFormat: 'alibaba',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    const result = applyCachePolicy(request);

    expect(result.tools[0]?.cache).toBeUndefined();
    expect(result.system[0]?.cache).toBeDefined();
    expect(lastPartCached(result.messages.at(-1))).toBe(true);
  });

  it('cacheFormat: alibaba 与显式对象策略叠加时强制关闭工具断点', () => {
    const request = requestFor({
      route: OpenAIChat.route,
      cacheFormat: 'alibaba',
      cache: { tools: true, system: true },
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    const result = applyCachePolicy(request);

    expect(result.tools[0]?.cache).toBeUndefined();
    expect(result.system[0]?.cache).toBeDefined();
  });

  it('网关路由：anthropic 家族按 auto 布局', () => {
    const request = requestFor({
      route: { ...OpenAIChat.route, id: 'openrouter' },
      id: '~anthropic/claude-sonnet-4-5',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(cacheCount(applyCachePolicy(request))).toBe(3);
  });

  it('网关路由：qwen 家族不落工具断点、不落首末 system 之外的断点', () => {
    const request = requestFor({
      route: { ...OpenAIChat.route, id: 'openrouter' },
      id: 'qwen/qwen3-max',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    const result = applyCachePolicy(request);

    expect(result.tools[0]?.cache).toBeUndefined();
    expect(result.system[0]?.cache).toBeDefined();
    expect(lastPartCached(result.messages.at(-1))).toBe(true);
  });

  it('网关路由：其他上游不缓存', () => {
    const request = requestFor({
      route: { ...OpenAIChat.route, id: 'openrouter' },
      id: 'meta/llama-4',
      system: [systemPart('base')],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(applyCachePolicy(request)).toBe(request);
  });

  it('手工断点占满 4 个预算时不再新增', () => {
    const request = requestFor({
      route: AnthropicMessages.route,
      system: [
        systemPart('a', true),
        systemPart('b', true),
        systemPart('c', true),
        systemPart('d', true),
      ],
      tools: [tool('read')],
      messages: [Message.user('hi')],
    });

    expect(applyCachePolicy(request)).toBe(request);
  });

  it('会话尾策略跳过 effort 更新标记', () => {
    const effort = Message.effort({ effort: 'high', previous: 'low' });
    const request = requestFor({
      route: AnthropicMessages.route,
      messages: [Message.user('one'), effort, Message.user('two')],
    });

    const result = applyCachePolicy(request);

    expect(lastPartCached(result.messages.at(-1))).toBe(true);
    expect(lastPartCached(result.messages[1])).toBe(false);
    expect(result.messages[0]?.content.at(-1)).not.toHaveProperty('cache');
  });

  it('显式 latest-user-message 策略只标记最后一条用户消息', () => {
    const request = requestFor({
      route: AnthropicMessages.route,
      cache: { messages: 'latest-user-message' },
      tools: [tool('read')],
      messages: [Message.user('one'), Message.assistant('two'), Message.user('three')],
    });

    const result = applyCachePolicy(request);

    expect(result.tools[0]?.cache).toBeUndefined();
    expect(result.messages[1]?.content.at(-1)).not.toHaveProperty('cache');
    expect(lastPartCached(result.messages.at(-1))).toBe(true);
  });
});
