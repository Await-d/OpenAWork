/**
 * 角色实例生命周期的装配约定。
 *
 * 背景：实例结束 / 关闭后必须继续以终态展示（卡片不消失），而判定「结束」有两个
 * 反直觉的坑 —— 这次把它们抽成纯函数就是为了让这两条能被直接断言：
 *   1. 归属只能用 `toSessionId`；回落 `sessionId` 会把上游接待层根会话误标成已结束。
 *   2. 一个实例可能有多条 handoff（回收重试），只有最近一条是终态才算结束。
 */

import { describe, expect, it } from 'vitest';
import type { HandoffEntry, HandoffState } from '../../../../stores/team/team-events.js';
import { buildLatestHandoffBySession, resolveInstanceLifecycle } from './team-layer-messages.js';

function handoff(
  overrides: Partial<HandoffEntry> & Pick<HandoffEntry, 'id' | 'state'>,
): HandoffEntry {
  return {
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    updatedAt: 1,
    ...overrides,
  };
}

function noNodes(): Map<string, { state: HandoffState | 'idle' }> {
  return new Map();
}

describe('buildLatestHandoffBySession', () => {
  it('按 toSessionId 归并，每个实例只留最近一条', () => {
    const latest = buildLatestHandoffBySession([
      handoff({ id: 'h-1', state: 'completed', toSessionId: 's-pm1', updatedAt: 10 }),
      handoff({ id: 'h-2', state: 'running', toSessionId: 's-pm1', updatedAt: 20 }),
      handoff({ id: 'h-3', state: 'failed', toSessionId: 's-exec', updatedAt: 5 }),
    ]);

    expect(latest.size).toBe(2);
    expect(latest.get('s-pm1')?.state).toBe('running');
    expect(latest.get('s-exec')?.state).toBe('failed');
  });

  it('没有目标 session 的 handoff 不参与归属 —— 不能回落成 sessionId', () => {
    // 真实场景：reception→pm1 的 handoff 排队中就被取消，toSessionId 仍为 null。
    // store 会把 sessionId 回落成 fromSessionId（= 接待层根会话）。若照单全收，
    // 接待层主会话头上就会凭空长出一个「已取消」标识条。
    const latest = buildLatestHandoffBySession([
      handoff({
        id: 'h-1',
        state: 'cancelled',
        fromSessionId: 's-reception',
        toSessionId: null,
        sessionId: 's-reception',
        updatedAt: 10,
      }),
    ]);

    expect(latest.size).toBe(0);
    expect(latest.has('s-reception')).toBe(false);
  });

  it('toSessionId 缺省（undefined）同样不参与归属', () => {
    const latest = buildLatestHandoffBySession([
      handoff({
        id: 'h-1',
        state: 'failed',
        fromSessionId: 's-reception',
        sessionId: 's-reception',
        updatedAt: 10,
      }),
    ]);

    expect(latest.size).toBe(0);
  });
});

describe('resolveInstanceLifecycle', () => {
  it('最近一条 handoff 是终态 → 实例已结束，并带上结束时间与原因', () => {
    const latest = buildLatestHandoffBySession([
      handoff({
        id: 'h-1',
        state: 'failed',
        toSessionId: 's-exec',
        updatedAt: 10,
        endedAt: 1234,
        failureReason: '依赖安装超时',
      }),
    ]);

    expect(
      resolveInstanceLifecycle({
        ownerSessionId: 's-exec',
        latestHandoffBySession: latest,
        layerNodes: noNodes(),
      }),
    ).toEqual({ lifecycle: 'failed', endedAt: 1234, failureReason: '依赖安装超时' });
  });

  it('最近一条 handoff 非终态 → 回落到 layer node 的实时状态', () => {
    // 被回收重试：先 completed，再 reclaimed 成 running。不能因为历史上完成过
    // 就把「正在重试」的实例标成「已完成」。
    const latest = buildLatestHandoffBySession([
      handoff({ id: 'h-1', state: 'completed', toSessionId: 's-exec', updatedAt: 10 }),
      handoff({ id: 'h-2', state: 'running', toSessionId: 's-exec', updatedAt: 20 }),
    ]);

    expect(
      resolveInstanceLifecycle({
        ownerSessionId: 's-exec',
        latestHandoffBySession: latest,
        layerNodes: new Map([['s-exec', { state: 'running' as const }]]),
      }),
    ).toEqual({ lifecycle: 'running', endedAt: null, failureReason: null });
  });

  it('没有任何记录 → idle（从未派发过 handoff 的实例）', () => {
    expect(
      resolveInstanceLifecycle({
        ownerSessionId: 's-unknown',
        latestHandoffBySession: new Map(),
        layerNodes: noNodes(),
      }),
    ).toEqual({ lifecycle: 'idle', endedAt: null, failureReason: null });
  });

  it('接待层根会话不会被「排队中取消的下游 handoff」误标成已结束', () => {
    // 端到端复现原本的误标路径：根会话是 reception，子 handoff 归属 pm1。
    const latest = buildLatestHandoffBySession([
      handoff({
        id: 'h-1',
        state: 'cancelled',
        fromSessionId: 's-reception',
        toSessionId: null,
        sessionId: 's-reception',
        updatedAt: 10,
      }),
      handoff({ id: 'h-2', state: 'cancelled', toSessionId: 's-pm1', updatedAt: 11 }),
    ]);

    expect(
      resolveInstanceLifecycle({
        ownerSessionId: 's-reception',
        latestHandoffBySession: latest,
        layerNodes: new Map([['s-reception', { state: 'idle' as const }]]),
      }),
    ).toEqual({ lifecycle: 'idle', endedAt: null, failureReason: null });

    // 而真正的目标实例照常显示终态
    expect(
      resolveInstanceLifecycle({
        ownerSessionId: 's-pm1',
        latestHandoffBySession: latest,
        layerNodes: noNodes(),
      }).lifecycle,
    ).toBe('cancelled');
  });
});
