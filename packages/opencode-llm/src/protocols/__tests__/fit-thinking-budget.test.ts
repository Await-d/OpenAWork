/**
 * 思考预算钳制契约测试（对齐上游 packages/ai@v2.0.28 的 `fitThinkingBudget`）。
 */

import { describe, expect, it } from 'vitest';
import { ProviderShared } from '../shared.js';

describe('fitThinkingBudget', () => {
  it('预算贴着上限时压到一半', () => {
    expect(ProviderShared.fitThinkingBudget(8_000, 8_000)).toBe(4_000);
    expect(ProviderShared.fitThinkingBudget(9_000, 8_000)).toBe(4_000);
  });

  it('恰好等于上限一半时不动', () => {
    expect(ProviderShared.fitThinkingBudget(4_000, 8_000)).toBe(4_000);
  });

  it('低于上限一半时原样透传', () => {
    expect(ProviderShared.fitThinkingBudget(1_024, 8_000)).toBe(1_024);
  });

  it('没有输出上限时原样透传', () => {
    expect(ProviderShared.fitThinkingBudget(9_999, undefined)).toBe(9_999);
  });

  it('-1 / 0 等特殊值原样透传（不干预）', () => {
    expect(ProviderShared.fitThinkingBudget(-1, 8_000)).toBe(-1);
    expect(ProviderShared.fitThinkingBudget(0, 8_000)).toBe(0);
  });

  it('上限极小时钳到调用方给的最小值', () => {
    expect(ProviderShared.fitThinkingBudget(1_400, 1_500, 1_024)).toBe(1_024);
    expect(ProviderShared.fitThinkingBudget(1_400, 1_500)).toBe(750);
  });
});

describe('Gemini thinkingConfig 预算钳制', () => {
  const geminiBody = async (
    input: {
      providerOptions?: Record<string, unknown>;
      maxTokens?: number;
      system?: string[];
    } = {},
  ) => {
    const { Effect } = await import('effect');
    const { Gemini } = await import('../gemini.js');
    const { request } = await import('../../llm.js');
    const model = Gemini.route
      .with({ endpoint: { baseURL: 'https://generativelanguage.googleapis.com' } })
      .model({ id: 'gemini-2.5-pro' });
    const prepared = request({
      model,
      prompt: 'hi',
      ...(input.maxTokens === undefined ? {} : { generation: { maxTokens: input.maxTokens } }),
      ...(input.system === undefined ? {} : { system: input.system }),
      ...(input.providerOptions === undefined
        ? {}
        : { providerOptions: { gemini: input.providerOptions } }),
    } as never);
    return (await Effect.runPromise(Gemini.protocol.body.from(prepared))) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget?: number } };
      systemInstruction?: { parts: Array<{ text: string }> };
    };
  };

  it('预算顶着输出上限时压到一半（下限 512）', async () => {
    const body = await geminiBody({
      providerOptions: { thinkingConfig: { thinkingBudget: 20_000 } },
      maxTokens: 8_000,
    });

    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(4_000);
  });

  it('输出上限极小时钳到 512', async () => {
    const body = await geminiBody({
      providerOptions: { thinkingConfig: { thinkingBudget: 400 } },
      maxTokens: 600,
    });

    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(512);
  });

  it('没有输出上限时原样透传', async () => {
    const body = await geminiBody({
      providerOptions: { thinkingConfig: { thinkingBudget: 8_192 } },
    });

    expect(body.generationConfig?.thinkingConfig?.thinkingBudget).toBe(8_192);
  });

  it('system 分段保留而不是 join 成一段', async () => {
    const body = await geminiBody({
      system: [
        { type: 'text', text: '第一段' },
        { type: 'text', text: '第二段' },
      ],
    });

    expect(body.systemInstruction?.parts).toEqual([{ text: '第一段' }, { text: '第二段' }]);
  });
});
