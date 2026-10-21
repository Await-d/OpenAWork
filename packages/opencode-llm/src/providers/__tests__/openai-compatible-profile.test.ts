/**
 * OpenAI 兼容供应商默认端点表（对齐上游 `providers/*.ts` 的 `baseURL`）。
 *
 * 契约价值：这些默认值让调用方在只给 provider 名与凭据时就能指向正确端点；
 * 缺失会让请求打到 `api.openai.com` 兜底地址（见网关 `native-model.ts`）。
 */

import { describe, expect, it } from 'vitest';
import * as OpenAICompatible from '../openai-compatible.js';
import { byProvider, profiles } from '../openai-compatible-profile.js';

describe('OpenAI 兼容供应商默认端点表', () => {
  it('每个 profile 都有 provider 名与 https 端点', () => {
    for (const [key, profile] of Object.entries(profiles)) {
      expect(profile.provider, key).toBeTruthy();
      expect(profile.baseURL, key).toMatch(/^https:\/\//);
    }
  });

  it('provider 名与键名一致（连字符项除外，键名即 provider id）', () => {
    for (const [key, profile] of Object.entries(profiles)) {
      expect(profile.provider, key).toBe(key);
    }
  });

  it('byProvider 按 provider 名索引', () => {
    expect(byProvider['venice']?.baseURL).toBe('https://api.venice.ai/api/v1');
    expect(byProvider['moonshot']?.baseURL).toBe('https://api.moonshot.ai/v1');
    expect(byProvider['zai-coding-plan']?.baseURL).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('对齐上游新增的端点（cohere 用其 OpenAI 兼容路径）', () => {
    expect(profiles.cohere.baseURL).toBe('https://api.cohere.ai/compatibility/v1');
    expect(profiles.meta.baseURL).toBe('https://api.meta.ai/v1');
    expect(profiles.digitalocean.baseURL).toBe('https://inference.do-ai.run/v1');
    expect(profiles.opencode.baseURL).toBe('https://opencode.ai/inference/v1');
    expect(profiles['typesafe-ai'].baseURL).toBe('https://api.typesafe.ai/v1');
    expect(profiles['vercel-ai-gateway'].baseURL).toBe('https://ai-gateway.vercel.sh/v1');
  });

  it('具名导出的 provider id 与 profile 一致', () => {
    expect(String(OpenAICompatible.venice.id)).toBe('venice');
    expect(String(OpenAICompatible.moonshot.id)).toBe('moonshot');
    expect(String(OpenAICompatible.deepseek.id)).toBe('deepseek');
  });

  it('连字符 provider id 用驼峰别名导出，id 保留连字符', () => {
    expect(String(OpenAICompatible.typesafeAi.id)).toBe('typesafe-ai');
    expect(String(OpenAICompatible.vercelAiGateway.id)).toBe('vercel-ai-gateway');
    expect(String(OpenAICompatible.zaiCodingPlan.id)).toBe('zai-coding-plan');
  });

  it('具名导出的 facade 能产出模型（端点取自 profile）', () => {
    const model = OpenAICompatible.venice.model('llama-3.3-70b');

    expect(String(model.provider)).toBe('venice');
    expect(model.route.endpoint.baseURL).toBe('https://api.venice.ai/api/v1');
  });

  it('不含非 OpenAI 兼容的供应商（minimax 走 anthropic 端点、mistral 走原生协议）', () => {
    expect(byProvider['minimax']).toBeUndefined();
    expect(byProvider['mistral']).toBeUndefined();
    expect(byProvider['cloudflare-workers-ai']).toBeUndefined();
  });
});
