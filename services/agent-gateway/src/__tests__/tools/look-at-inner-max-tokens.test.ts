import { describe, expect, it } from 'vitest';
import {
  MODEL_REQUEST_DEFAULT_MAX_TOKENS,
  MODEL_REQUEST_MAX_TOKENS_CAP,
} from '../../provider/model-router.js';
import { resolveInnerMaxTokens } from '../../tools/look-at-tools.js';

/**
 * 内层调用（look_at / computer_use）的输出上限兜底规则。
 *
 * 优先级链的**前两级**由 `model-router` 的 `buildRequestOverrides` +
 * `mergedOverrides.maxTokens ?? request.maxTokens` 保证（用户配置始终优先）；
 * 本文件锁定的是第三、四级——「模型声明的 maxOutputTokens（收敛）」与「常量兜底」。
 */
describe('resolveInnerMaxTokens', () => {
  it('未提供模型声明时退回常量默认值', () => {
    expect(resolveInnerMaxTokens(undefined)).toBe(MODEL_REQUEST_DEFAULT_MAX_TOKENS);
    expect(resolveInnerMaxTokens(undefined)).toBe(2048);
  });

  it('采用模型声明的 maxOutputTokens', () => {
    expect(resolveInnerMaxTokens(4096)).toBe(4096);
  });

  it('超过 schema 上限时收敛到上限（否则 Zod 会拒绝请求）', () => {
    // catalog 中真实存在的值：65536 / 128000 / 131072
    expect(resolveInnerMaxTokens(65_536)).toBe(MODEL_REQUEST_MAX_TOKENS_CAP);
    expect(resolveInnerMaxTokens(128_000)).toBe(MODEL_REQUEST_MAX_TOKENS_CAP);
    expect(resolveInnerMaxTokens(131_072)).toBe(MODEL_REQUEST_MAX_TOKENS_CAP);
    expect(MODEL_REQUEST_MAX_TOKENS_CAP).toBe(16_384);
  });

  it('非法值（0 / 负数 / 非有限数）退回常量默认值', () => {
    expect(resolveInnerMaxTokens(0)).toBe(MODEL_REQUEST_DEFAULT_MAX_TOKENS);
    expect(resolveInnerMaxTokens(-1)).toBe(MODEL_REQUEST_DEFAULT_MAX_TOKENS);
    expect(resolveInnerMaxTokens(Number.NaN)).toBe(MODEL_REQUEST_DEFAULT_MAX_TOKENS);
    expect(resolveInnerMaxTokens(Number.POSITIVE_INFINITY)).toBe(MODEL_REQUEST_DEFAULT_MAX_TOKENS);
  });

  it('小数向下取整', () => {
    expect(resolveInnerMaxTokens(4096.9)).toBe(4096);
  });

  it('结果始终落在 schema 允许的 [1, cap] 区间内', () => {
    for (const input of [undefined, 1, 2048, 16_384, 16_385, 131_072]) {
      const value = resolveInnerMaxTokens(input);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(MODEL_REQUEST_MAX_TOKENS_CAP);
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
