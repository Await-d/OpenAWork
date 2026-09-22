import { describe, expect, it } from 'vitest';
import type { AIProvider } from '@openAwork/agent-core';
import {
  MODEL_REQUEST_MAX_TOKENS_CAP,
  modelRequestSchema,
  resolveCompactionRoute,
  resolveModelRouteFromProvider,
} from '../../provider/model-router.js';

/**
 * 输出额度语义（对齐 opencode v2.0.13 的 `generation.maxTokens === undefined`）。
 *
 * - 未显式指定 ⇒ `maxTokens === undefined` ⇒ 协议层不下发
 *   `max_tokens` / `max_output_tokens`，由上游按模型自身默认上限决定。
 * - 显式请求值 / 模型级 / Provider 级 `requestOverrides.maxTokens` 原样生效。
 *
 * 回归背景：曾固定下发 schema 默认值 2048。推理模型的思考 token 与正文共享同一份
 * 输出预算，2048 会在正文产出前就被上游以 `finish_reason: length` 截断
 * （现象：思考一段后直接停止、没有回复）。
 */
describe('modelRequestSchema · 不再注入默认输出额度', () => {
  it('未指定额度时保持 undefined，不填充任何兜底值', () => {
    const parsed = modelRequestSchema.parse({});
    expect(parsed.maxTokens).toBeUndefined();
    expect(Object.keys(parsed)).not.toContain('maxTokens');
  });

  it('显式额度原样保留，并仍受 CAP 约束', () => {
    expect(modelRequestSchema.parse({ maxTokens: 4096 }).maxTokens).toBe(4096);
    expect(() => modelRequestSchema.parse({ maxTokens: 1_000_000 })).toThrow();
  });
});

function makeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  return {
    id: 'openai',
    type: 'openai',
    name: 'OpenAI',
    enabled: true,
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'test-key',
    defaultModels: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolveModelRouteFromProvider · 输出额度', () => {
  it('请求未指定且无任何覆盖时不下发额度', () => {
    const route = resolveModelRouteFromProvider(makeProvider(), 'gpt-4o', { temperature: 1 });

    expect(route.maxTokens).toBeUndefined();
  });

  it('模型声明的 maxOutputTokens 不参与请求额度（只用于压缩 / 溢出计算）', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({
        defaultModels: [
          { id: 'reasoner', label: 'Reasoner', enabled: true, maxOutputTokens: 384_000 },
        ],
      }),
      'reasoner',
      { temperature: 1 },
    );

    expect(route.maxTokens).toBeUndefined();
    expect(route.maxOutputTokens).toBe(384_000);
  });

  it('请求显式额度生效', () => {
    const route = resolveModelRouteFromProvider(makeProvider(), 'gpt-4o', {
      temperature: 1,
      maxTokens: 4096,
    });

    expect(route.maxTokens).toBe(4096);
  });

  it('模型级 requestOverrides.maxTokens 覆盖并优先于请求缺省', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({
        defaultModels: [
          { id: 'tuned', label: 'Tuned', enabled: true, requestOverrides: { maxTokens: 8192 } },
        ],
      }),
      'tuned',
      { temperature: 1 },
    );

    expect(route.maxTokens).toBe(8192);
  });

  it('Provider 级 requestOverrides.maxTokens 同样生效', () => {
    const route = resolveModelRouteFromProvider(
      makeProvider({ requestOverrides: { maxTokens: 2048 } }),
      'gpt-4o',
      { temperature: 1 },
    );

    expect(route.maxTokens).toBe(2048);
  });
});

/**
 * 压缩请求与主对话共用同一额度语义：旧的 `?? 4096` 兜底会被推理模型的思考
 * 吃满，使压缩返回空摘要并抛 `Compaction LLM returned empty summary`。
 */
describe('resolveCompactionRoute · 输出额度', () => {
  it('未配置时不下发额度（不再使用 4096 兜底）', () => {
    const route = resolveCompactionRoute(makeProvider(), 'unknown-model');

    expect(route.maxTokens).toBeUndefined();
  });

  it('模型级 requestOverrides.maxTokens 原样生效', () => {
    const route = resolveCompactionRoute(
      makeProvider({
        defaultModels: [
          { id: 'tuned', label: 'Tuned', enabled: true, requestOverrides: { maxTokens: 8192 } },
        ],
      }),
      'tuned',
    );

    expect(route.maxTokens).toBe(8192);
  });

  it('模型声明的 maxOutputTokens 仍透出给压缩预算计算，但不作为请求额度', () => {
    const route = resolveCompactionRoute(
      makeProvider({
        defaultModels: [
          { id: 'reasoner', label: 'Reasoner', enabled: true, maxOutputTokens: 384_000 },
        ],
      }),
      'reasoner',
    );

    expect(route.maxTokens).toBeUndefined();
    expect(route.maxOutputTokens).toBe(384_000);
  });
});

describe('MODEL_REQUEST_MAX_TOKENS_CAP · 契约', () => {
  it('仍是显式额度的 schema 上限', () => {
    expect(MODEL_REQUEST_MAX_TOKENS_CAP).toBe(16_384);
  });
});
