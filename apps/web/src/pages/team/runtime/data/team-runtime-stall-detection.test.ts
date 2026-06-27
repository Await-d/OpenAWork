import { describe, expect, it, vi } from 'vitest';
import { resolveSessionScopeStallState } from './team-runtime-stall-detection.js';

describe('team-runtime-stall-detection', () => {
  it('running 且 scope 内有近期 handoff 活动时，不因根会话 updatedAt 陈旧误判停滞', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));

    const result = resolveSessionScopeStallState({
      fallbackUpdatedAt: '2026-06-21T11:50:00.000Z',
      handoffs: [
        {
          fromSessionId: 'session-root',
          sessionId: 'session-child',
          state: 'running',
          toSessionId: 'session-child',
          updatedAt: Date.parse('2026-06-21T11:59:30.000Z'),
        },
      ],
      running: true,
      sessionScope: new Set(['session-root', 'session-child']),
      thresholdMs: 120_000,
    });

    expect(result.stalled).toBe(false);
    expect(result.lastActivityAgoMs).toBe(30_000);
    vi.useRealTimers();
  });

  it('running 且 scope 处于 clarifying 等允许等待态时，不标记停滞', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));

    const result = resolveSessionScopeStallState({
      fallbackUpdatedAt: '2026-06-21T11:50:00.000Z',
      nodes: [
        {
          sessionId: 'session-root',
          substate: 'clarifying',
        },
      ],
      running: true,
      sessionScope: new Set(['session-root']),
      thresholdMs: 120_000,
    });

    expect(result.waitingAllowed).toBe(true);
    expect(result.stalled).toBe(false);
    vi.useRealTimers();
  });

  it('running 且长时间无活动且不在允许等待态时，标记停滞', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T12:00:00.000Z'));

    const result = resolveSessionScopeStallState({
      fallbackUpdatedAt: '2026-06-21T11:50:00.000Z',
      running: true,
      sessionScope: new Set(['session-root']),
      thresholdMs: 120_000,
    });

    expect(result.waitingAllowed).toBe(false);
    expect(result.stalled).toBe(true);
    expect(result.lastActivityAgoMs).toBe(600_000);
    vi.useRealTimers();
  });
});
