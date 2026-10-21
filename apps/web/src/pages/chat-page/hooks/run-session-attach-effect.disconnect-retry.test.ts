import { describe, expect, it } from 'vitest';
import {
  createInitialAttachProgressState,
  DISCONNECT_RETRY_DELAYS_MS,
  resolveDisconnectRetryDelayMs,
  resolveSilentCloseRetryDelayMs,
  SILENT_CLOSE_RETRY_DELAYS_MS,
} from './run-session-attach-effect.js';

describe('resolveDisconnectRetryDelayMs', () => {
  it('反复中断时逐级退避，而不是恒定 400ms', () => {
    // 固定 400ms 会让「attach → 收到事件 → 又断开」变成高频死循环，
    // 且每轮都全量重载会话快照——这是页面卡死的成因之一。
    const delays = [1, 2, 3, 4, 5, 6, 7].map(resolveDisconnectRetryDelayMs);
    for (let index = 1; index < delays.length; index += 1) {
      expect(delays[index]!).toBeGreaterThan(delays[index - 1]!);
    }
    expect(delays[0]).toBe(800);
  });

  it('封顶 30s，不退到「永不重试」', () => {
    const cap = DISCONNECT_RETRY_DELAYS_MS[DISCONNECT_RETRY_DELAYS_MS.length - 1]!;
    expect(cap).toBe(30_000);
    expect(resolveDisconnectRetryDelayMs(99)).toBe(cap);
  });

  it('非法次数回落到起步延迟', () => {
    expect(resolveDisconnectRetryDelayMs(0)).toBe(800);
    expect(resolveDisconnectRetryDelayMs(-3)).toBe(800);
  });
});

describe('attach 进度状态', () => {
  it('初始状态里中断计数为 0，连接建立时刻为 0（尚未 attach）', () => {
    const state = createInitialAttachProgressState();
    expect(state.disconnects).toBe(0);
    expect(state.attachedAt).toBe(0);
    expect(state.silentCloses).toBe(0);
    expect(state.stalledReconnects).toBe(0);
  });
});

describe('两种退避的量级', () => {
  it('两条序列都单调不降且都有封顶值', () => {
    for (const sequence of [SILENT_CLOSE_RETRY_DELAYS_MS, DISCONNECT_RETRY_DELAYS_MS]) {
      for (let index = 1; index < sequence.length; index += 1) {
        expect(sequence[index]!).toBeGreaterThanOrEqual(sequence[index - 1]!);
      }
    }
    expect(SILENT_CLOSE_RETRY_DELAYS_MS[SILENT_CLOSE_RETRY_DELAYS_MS.length - 1]).toBe(10_000);
    expect(DISCONNECT_RETRY_DELAYS_MS[DISCONNECT_RETRY_DELAYS_MS.length - 1]).toBe(30_000);
  });

  it('等待新输出的封顶值小于断线重连：前者是正常等待，应更快接上', () => {
    expect(resolveSilentCloseRetryDelayMs(99)).toBeLessThan(resolveDisconnectRetryDelayMs(99));
  });
});
