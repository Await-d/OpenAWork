import { describe, expect, it, vi } from 'vitest';
import type { HandoffEntry, LayerNode } from '../../../../../stores/team/team-events.js';
import {
  computeTeamStatusBarStats,
  filterHandoffsForStatusBar,
} from './team-status-bar-helpers.js';

describe('filterHandoffsForStatusBar', () => {
  it('未选中会话时返回全量 handoff', () => {
    const handoffs: HandoffEntry[] = [
      {
        id: 'h-1',
        state: 'running',
        fromRoleLayer: 'reception',
        toRoleLayer: 'pm1',
        fromSessionId: 'a',
        toSessionId: 'b',
        sessionId: 'b',
        updatedAt: 1,
      },
      {
        id: 'h-2',
        state: 'pending',
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
        fromSessionId: 'x',
        toSessionId: 'y',
        sessionId: 'y',
        updatedAt: 2,
      },
    ];

    expect(filterHandoffsForStatusBar(handoffs, [], null).map((item) => item.id)).toEqual([
      'h-1',
      'h-2',
    ]);
  });

  it('选中会话后只保留当前会话及子树相关 handoff', () => {
    const handoffs: HandoffEntry[] = [
      {
        id: 'h-in',
        state: 'running',
        fromRoleLayer: 'pm1',
        toRoleLayer: 'pm2',
        fromSessionId: 'root',
        toSessionId: 'child',
        sessionId: 'child',
        updatedAt: 1,
      },
      {
        id: 'h-out',
        state: 'pending',
        fromRoleLayer: 'reviewer',
        toRoleLayer: 'executor',
        fromSessionId: 'other',
        toSessionId: 'other-child',
        sessionId: 'other-child',
        updatedAt: 2,
      },
    ];
    const nodes: LayerNode[] = [
      { sessionId: 'root', parentSessionId: null, roleLayer: 'reception', state: 'running' },
      { sessionId: 'child', parentSessionId: 'root', roleLayer: 'pm1', state: 'running' },
      { sessionId: 'other', parentSessionId: null, roleLayer: 'reviewer', state: 'running' },
    ];

    expect(filterHandoffsForStatusBar(handoffs, nodes, 'root').map((item) => item.id)).toEqual([
      'h-in',
    ]);
  });
});

describe('computeTeamStatusBarStats', () => {
  it('按状态聚合并使用 startedAt 计算耗时', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-04T18:00:00.000Z'));

    const stats = computeTeamStatusBarStats([
      {
        id: 'running-1',
        state: 'running',
        toRoleLayer: 'pm1',
        fromRoleLayer: 'reception',
        updatedAt: Date.parse('2026-06-04T17:59:50.000Z'),
        startedAt: Date.parse('2026-06-04T17:59:00.000Z'),
        fromSessionId: 'root',
        toSessionId: 'pm1-session',
        sessionId: 'pm1-session',
      },
      {
        id: 'pending-1',
        state: 'pending',
        toRoleLayer: 'pm2',
        fromRoleLayer: 'pm1',
        updatedAt: Date.parse('2026-06-04T17:59:55.000Z'),
        fromSessionId: 'pm1-session',
        toSessionId: 'pm2-session',
        sessionId: 'pm2-session',
      },
      {
        id: 'completed-1',
        state: 'completed',
        toRoleLayer: 'reviewer',
        fromRoleLayer: 'pm2',
        updatedAt: Date.parse('2026-06-04T17:58:00.000Z'),
        fromSessionId: 'pm2-session',
        toSessionId: 'review-session',
        sessionId: 'review-session',
      },
    ]);

    expect(stats.running).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.total).toBe(3);
    expect(stats.activeLayers).toEqual(['pm1']);
    expect(stats.elapsedMs).toBe(60_000);

    vi.useRealTimers();
  });

  it('paused 的活跃 handoff 计入等待，不再算运行中', () => {
    const stats = computeTeamStatusBarStats([
      {
        id: 'paused-1',
        state: 'running',
        paused: true,
        toRoleLayer: 'pm2',
        fromRoleLayer: 'pm1',
        updatedAt: 1,
        fromSessionId: 'pm1-session',
        toSessionId: 'pm2-session',
        sessionId: 'pm2-session',
      },
    ]);

    expect(stats.running).toBe(0);
    expect(stats.pending).toBe(1);
    expect(stats.activeLayers).toEqual([]);
  });
});
