import { describe, expect, it } from 'vitest';
import { resolveModelRoute } from '../../provider/model-router.js';

/**
 * 裸 modelId 的内置回退解析：跨平台同 id 模型必须落在先声明的一手平台，
 * 而不是被后声明的中转平台(opencode-go)改写。见 model-router 的 BUILTIN_MODEL_INDEX。
 */
describe('BUILTIN_MODEL_INDEX 裸 modelId 归属', () => {
  it.each([
    ['gpt-4o', 'openai'],
    ['gpt-5.6-luna', 'openai'],
    ['mimo-v2.5', 'mimo'],
    ['mimo-v2.5-pro', 'mimo'],
  ])('%s 归属于一手平台 %s', (model, expectedProviderType) => {
    const route = resolveModelRoute({ model, maxTokens: 512, temperature: 1 });

    expect(route.providerType).toBe(expectedProviderType);
  });

  it('opencode-go 专属模型仍能解析到 opencode-go', () => {
    const route = resolveModelRoute({
      model: 'deepseek-v4.1-flash',
      maxTokens: 512,
      temperature: 1,
    });

    expect(route.providerType).toBe('opencode-go');
  });
});
