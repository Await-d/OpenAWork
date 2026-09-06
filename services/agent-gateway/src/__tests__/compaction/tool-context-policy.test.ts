import { describe, expect, it } from 'vitest';
import { resolveToolContextPolicy } from '../../compaction/tool-context-policy.js';

describe('工具上下文动态策略', () => {
  it('正常请求不再设置固定工具字符总预算', () => {
    expect(resolveToolContextPolicy({ contextWindowTokens: 32_000 }).maxTotalToolCostChars).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(resolveToolContextPolicy({ contextWindowTokens: 1_000_000 }).maxTotalToolCostChars).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('上下文窗口覆盖项不会重新引入工具字符天花板', () => {
    expect(
      resolveToolContextPolicy({
        contextWindowOverrideTokens: 16_000,
        contextWindowTokens: 128_000,
      }).maxTotalToolCostChars,
    ).toBe(Number.POSITIVE_INFINITY);
  });
});
