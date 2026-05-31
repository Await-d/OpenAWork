import { describe, expect, it } from 'vitest';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from './recoverable-read-model.js';

describe('computeExponentialRetryDelay', () => {
  it('按指数退避增长并在上限处封顶', () => {
    expect(computeExponentialRetryDelay({ attempt: 0, baseMs: 2000, maxMs: 30000 })).toBe(2000);
    expect(computeExponentialRetryDelay({ attempt: 1, baseMs: 2000, maxMs: 30000 })).toBe(4000);
    expect(computeExponentialRetryDelay({ attempt: 2, baseMs: 2000, maxMs: 30000 })).toBe(8000);
    expect(computeExponentialRetryDelay({ attempt: 10, baseMs: 2000, maxMs: 30000 })).toBe(
      30000,
    );
  });
});

describe('formatRecoverableLoadError', () => {
  it('会拼出可重试与保留旧数据提示', () => {
    const message = formatRecoverableLoadError({
      baseMessage: 'shared detail unavailable',
      hasRetainedData: true,
      nextRetryAtMs: new Date('2026-05-26T12:30:00.000Z').getTime(),
      retainedDataLabel: '详情',
      retryable: true,
    });

    expect(message).toContain('shared detail unavailable');
    expect(message).toContain('自动重试');
    expect(message).toContain('最近一次成功详情');
  });

  it('不可重试时只保留基础错误文案', () => {
    expect(
      formatRecoverableLoadError({
        baseMessage: '认证失效',
        hasRetainedData: false,
        retainedDataLabel: '快照',
        retryable: false,
      }),
    ).toBe('认证失效');
  });
});
