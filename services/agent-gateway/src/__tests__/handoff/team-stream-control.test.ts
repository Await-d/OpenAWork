/**
 * team-stream-control 单元测试
 *
 * 覆盖跨层「带内」取消/暂停 gate 的核心决策逻辑（注入 deps，不碰 DB）：
 *   - 非团队层 session → 直接 continue（零开销跳过）
 *   - 无信号 → continue
 *   - cancel_signal → cancelled（带 reason）
 *   - signal.aborted（前端直接 stop）→ cancelled('aborted')
 *   - pause → 阻塞轮询，直到 resume → continue
 *   - pause → cancel → cancelled
 *   - pause 超过墙钟上限 → cancelled('pause-timeout-exceeded')
 */

import { describe, expect, it } from 'vitest';
import {
  checkTeamControlSignals,
  isTeamControlledRoleLayer,
} from '../../handoff/runner/team-stream-control.js';
import type { InboundMessageRecord } from '../../handoff/store/inbound-store.js';

function makeSignal(
  record: Partial<InboundMessageRecord> & { messageType: string },
): InboundMessageRecord {
  return {
    id: 'm-1',
    userId: 'u-1',
    toSessionId: 's-1',
    fromRoleLayer: 'system',
    messageType: record.messageType as InboundMessageRecord['messageType'],
    payload: record.payload ?? {},
    state: 'consumed',
    clientIdempotencyKey: null,
    createdAt: '2026-01-01 00:00:00',
    consumedAt: '2026-01-01 00:00:00',
    consumedByLoopIteration: 1,
    expiresAt: null,
  };
}

const notAborted = new AbortController().signal;

describe('isTeamControlledRoleLayer', () => {
  it('五层返回 true，其他返回 false', () => {
    for (const layer of ['reception', 'pm1', 'pm2', 'executor', 'reviewer']) {
      expect(isTeamControlledRoleLayer(layer)).toBe(true);
    }
    expect(isTeamControlledRoleLayer('user')).toBe(false);
    expect(isTeamControlledRoleLayer(null)).toBe(false);
    expect(isTeamControlledRoleLayer(undefined)).toBe(false);
    expect(isTeamControlledRoleLayer('chat')).toBe(false);
  });
});

describe('checkTeamControlSignals', () => {
  it('非团队层 → continue，且不调用 consume', async () => {
    let consumeCalls = 0;
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: null,
      signal: notAborted,
      round: 1,
      deps: {
        consume: () => {
          consumeCalls += 1;
          return null;
        },
      },
    });
    expect(result).toEqual({ kind: 'continue' });
    expect(consumeCalls).toBe(0);
  });

  it('无 pending 信号 → continue', async () => {
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'executor',
      signal: notAborted,
      round: 2,
      deps: { consume: () => null },
    });
    expect(result).toEqual({ kind: 'continue' });
  });

  it('cancel_signal → cancelled（携带 reason）', async () => {
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'executor',
      signal: notAborted,
      round: 3,
      deps: {
        consume: () =>
          makeSignal({ messageType: 'cancel_signal', payload: { reason: '用户取消' } }),
      },
    });
    expect(result).toEqual({ kind: 'cancelled', reason: '用户取消' });
  });

  it('signal.aborted（前端 stop）→ cancelled(aborted)，优先于消费', async () => {
    const aborted = new AbortController();
    aborted.abort();
    let consumeCalls = 0;
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'reviewer',
      signal: aborted.signal,
      round: 4,
      deps: {
        consume: () => {
          consumeCalls += 1;
          return null;
        },
      },
    });
    expect(result).toEqual({ kind: 'cancelled', reason: 'aborted' });
    expect(consumeCalls).toBe(0);
  });

  it('pause → 阻塞轮询直到 resume → continue', async () => {
    const queue: Array<InboundMessageRecord | null> = [
      makeSignal({ messageType: 'pause_signal' }),
      null, // 第一次轮询：仍 paused
      makeSignal({ messageType: 'resume_signal' }),
    ];
    let sleeps = 0;
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'pm2',
      signal: notAborted,
      round: 5,
      pausePollIntervalMs: 1,
      deps: {
        consume: () => queue.shift() ?? null,
        sleep: async () => {
          sleeps += 1;
        },
      },
    });
    expect(result).toEqual({ kind: 'continue' });
    expect(sleeps).toBeGreaterThanOrEqual(1);
  });

  it('pause → cancel → cancelled', async () => {
    const queue: Array<InboundMessageRecord | null> = [
      makeSignal({ messageType: 'pause_signal' }),
      makeSignal({ messageType: 'cancel_signal', payload: { reason: '取消' } }),
    ];
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'executor',
      signal: notAborted,
      round: 6,
      pausePollIntervalMs: 1,
      deps: {
        consume: () => queue.shift() ?? null,
        sleep: async () => undefined,
      },
    });
    expect(result).toEqual({ kind: 'cancelled', reason: '取消' });
  });

  it('pause 超过墙钟上限 → cancelled(pause-timeout-exceeded)', async () => {
    let nowVal = 1_000;
    const result = await checkTeamControlSignals({
      sessionId: 's-1',
      roleLayer: 'executor',
      signal: notAborted,
      round: 7,
      pausePollIntervalMs: 1,
      pauseMaxBlockMs: 50,
      deps: {
        // 第一次返回 pause，之后一直 null（保持 paused）
        consume: (() => {
          let first = true;
          return () => {
            if (first) {
              first = false;
              return makeSignal({ messageType: 'pause_signal' });
            }
            return null;
          };
        })(),
        // 每次 sleep 推进虚拟时钟，越过 pauseMaxBlockMs
        sleep: async () => {
          nowVal += 100;
        },
        now: () => nowVal,
      },
    });
    expect(result).toEqual({ kind: 'cancelled', reason: 'pause-timeout-exceeded' });
  });
});
