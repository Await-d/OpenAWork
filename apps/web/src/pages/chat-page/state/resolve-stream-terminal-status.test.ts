import { describe, expect, it } from 'vitest';
import { resolveStreamTerminalStatus } from './resolve-stream-terminal-status.js';

describe('resolveStreamTerminalStatus', () => {
  it('保留回复操作已经乐观置入的 running 状态', () => {
    expect(
      resolveStreamTerminalStatus({
        currentStatus: 'running',
        pausedForPermission: false,
        pausedForQuestion: true,
      }),
    ).toBe('running');
  });

  it('未回复时仍保持 paused，避免误放行新的发送', () => {
    expect(
      resolveStreamTerminalStatus({
        currentStatus: 'paused',
        pausedForPermission: true,
        pausedForQuestion: false,
      }),
    ).toBe('paused');
  });

  it('用户忽略提问后已收敛为 idle 时不重新变成 paused', () => {
    expect(
      resolveStreamTerminalStatus({
        currentStatus: 'idle',
        pausedForPermission: false,
        pausedForQuestion: true,
      }),
    ).toBe('idle');
  });

  it('普通流结束时收敛到 idle', () => {
    expect(
      resolveStreamTerminalStatus({
        currentStatus: 'running',
        pausedForPermission: false,
        pausedForQuestion: false,
      }),
    ).toBe('idle');
  });
});
