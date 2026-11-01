import { describe, expect, it } from 'vitest';
import { PENDING_WAIT_HINT_THRESHOLD_MS, formatPendingWaitLabel } from './pending-wait.js';

describe('formatPendingWaitLabel', () => {
  it('不足 1 分钟只报秒，不出现「0 分」', () => {
    expect(formatPendingWaitLabel(0)).toBe('0 秒');
    expect(formatPendingWaitLabel(1_999)).toBe('1 秒');
    expect(formatPendingWaitLabel(59_999)).toBe('59 秒');
  });

  it('超过 1 分钟后给出分秒', () => {
    expect(formatPendingWaitLabel(60_000)).toBe('1 分钟');
    expect(formatPendingWaitLabel(72_000)).toBe('1 分 12 秒');
    expect(formatPendingWaitLabel(3_600_000)).toBe('60 分钟');
  });

  it('负数按 0 处理，不出现负时长', () => {
    expect(formatPendingWaitLabel(-1_000)).toBe('0 秒');
  });

  it('阈值与「先在 3 秒内不显示锚点」的约定一致', () => {
    expect(PENDING_WAIT_HINT_THRESHOLD_MS).toBe(3_000);
  });
});
