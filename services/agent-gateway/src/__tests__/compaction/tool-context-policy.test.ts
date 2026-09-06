import { describe, expect, it } from 'vitest';
import { resolveToolContextPolicy } from '../../compaction/tool-context-policy.js';

describe('工具上下文动态策略', () => {
  it('小上下文模型使用保守预算，大上下文模型仍受绝对上限约束', () => {
    expect(resolveToolContextPolicy({ contextWindowTokens: 32_000 }).maxTotalToolCostChars).toBe(
      32_000,
    );
    expect(resolveToolContextPolicy({ contextWindowTokens: 1_000_000 }).maxTotalToolCostChars).toBe(
      48_000,
    );
  });

  it('上下文窗口覆盖项优先于模型默认值', () => {
    expect(
      resolveToolContextPolicy({
        contextWindowOverrideTokens: 16_000,
        contextWindowTokens: 128_000,
      }).maxTotalToolCostChars,
    ).toBe(16_000);
  });
});
