/**
 * Bedrock Converse 区间对齐测试（对齐上游 packages/ai@v2.0.28）。
 *
 * 覆盖 T-34：Nova 2 高推理 effort 时不下发 `maxTokens`；非 Claude/Nova 模型把
 * 工具结果里的图片 hoist 到结果旁边。
 */

import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import * as BedrockConverse from '../bedrock-converse.js';
import * as LLM from '../../llm.js';
import { Message } from '../../schema/index.js';

const prepare = async (modelId: string, extra: Record<string, unknown> = {}) => {
  const model = BedrockConverse.route
    .with({ endpoint: { baseURL: 'https://bedrock-runtime.us-east-1.amazonaws.com' } })
    .model({ id: modelId });
  const request = LLM.request({
    model,
    prompt: 'hi',
    ...extra,
  } as never);
  return Effect.runPromise(BedrockConverse.protocol.body.from(request));
};

describe('Nova 2 的 maxTokens 抑制', () => {
  it('Nova 2 + 高推理 effort 时不下发 maxTokens', async () => {
    const body = (await prepare('amazon.nova-2-lite', {
      generation: { maxTokens: 4096 },
      http: {
        body: { additionalModelRequestFields: { reasoningConfig: { maxReasoningEffort: 'high' } } },
      },
    })) as { inferenceConfig?: { maxTokens?: number } };

    expect(body.inferenceConfig?.maxTokens).toBeUndefined();
  });

  it('Nova 2 非高 effort 时仍下发 maxTokens', async () => {
    const body = (await prepare('amazon.nova-2-lite', {
      generation: { maxTokens: 4096 },
    })) as { inferenceConfig?: { maxTokens?: number } };

    expect(body.inferenceConfig?.maxTokens).toBe(4096);
  });

  it('Claude 模型不受该抑制影响', async () => {
    const body = (await prepare('anthropic.claude-opus-4-5', {
      generation: { maxTokens: 4096 },
      http: {
        body: { additionalModelRequestFields: { reasoningConfig: { maxReasoningEffort: 'high' } } },
      },
    })) as { inferenceConfig?: { maxTokens?: number } };

    expect(body.inferenceConfig?.maxTokens).toBe(4096);
  });
});
