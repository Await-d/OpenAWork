import { describe, expect, it } from 'vitest';
import {
  resolveSilentCloseRetryDelayMs,
  SILENT_CLOSE_RETRY_DELAYS_MS,
} from './run-session-attach-effect.js';

/**
 * 工具执行（bash / mcp / 长思考）期间，网关不产生新的 run event，attach 只会
 * 「打开 → 0 事件 → EOF」。这时前端唯一的正确行为是**低频等待**，而不是判定故障。
 * 这些用例把「低频」这件事固定下来：起步 1s、逐级退避、10s 封顶。
 */
describe('resolveSilentCloseRetryDelayMs', () => {
  it('按静默次数递增退避', () => {
    expect(resolveSilentCloseRetryDelayMs(1)).toBe(1_000);
    expect(resolveSilentCloseRetryDelayMs(2)).toBe(2_000);
    expect(resolveSilentCloseRetryDelayMs(3)).toBe(4_000);
    expect(resolveSilentCloseRetryDelayMs(4)).toBe(8_000);
  });

  it('封顶 10s：工具可能执行很久，但不能退到「迟迟接不上」', () => {
    const cap = SILENT_CLOSE_RETRY_DELAYS_MS[SILENT_CLOSE_RETRY_DELAYS_MS.length - 1]!;
    expect(cap).toBe(10_000);
    expect(resolveSilentCloseRetryDelayMs(5)).toBe(cap);
    expect(resolveSilentCloseRetryDelayMs(99)).toBe(cap);
  });

  it('非法次数回落到起步延迟', () => {
    expect(resolveSilentCloseRetryDelayMs(0)).toBe(1_000);
    expect(resolveSilentCloseRetryDelayMs(-5)).toBe(1_000);
  });
});
