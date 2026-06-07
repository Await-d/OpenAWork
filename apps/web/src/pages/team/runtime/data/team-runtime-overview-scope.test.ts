import { describe, expect, it } from 'vitest';
import { scopeTeamRuntimeOverviewData } from './team-runtime-overview-scope.js';

describe('scopeTeamRuntimeOverviewData', () => {
  it('未选中会话时保留全量数据', () => {
    const result = scopeTeamRuntimeOverviewData({
      selectedSessionId: null,
      handoffs: [{ id: 'h-1', fromSessionId: 'a', toSessionId: 'b', sessionId: 'b' }],
      runtimeTasks: [{ id: 't-1', sessionId: 'b' }],
      sessions: [
        { id: 'a', parentSessionId: null },
        { id: 'b', parentSessionId: 'a' },
      ],
      messages: [{ id: 'm-1', sessionId: 'b' }],
      auditLogs: [{ id: 'audit-1', sessionId: 'b' }],
      sharedSessions: [{ id: 'share-1', sessionId: 'b' }],
    });

    expect(result.sessionScope).toBeNull();
    expect(result.handoffs).toHaveLength(1);
    expect(result.runtimeTasks).toHaveLength(1);
    expect(result.messages).toHaveLength(1);
    expect(result.auditLogs).toHaveLength(1);
    expect(result.sharedSessions).toHaveLength(1);
  });

  it('选中会话后会保留当前会话及子树的 handoff/runtime task/session/messages/sharedSessions', () => {
    const result = scopeTeamRuntimeOverviewData({
      selectedSessionId: 'root',
      handoffs: [
        { id: 'h-in', fromSessionId: 'root', toSessionId: 'child', sessionId: 'child' },
        {
          id: 'h-out',
          fromSessionId: 'other',
          toSessionId: 'other-child',
          sessionId: 'other-child',
        },
      ],
      runtimeTasks: [
        { id: 't-in', sessionId: 'child' },
        { id: 't-out', sessionId: 'other' },
      ],
      sessions: [
        { id: 'root', parentSessionId: null },
        { id: 'child', parentSessionId: 'root' },
        { id: 'other', parentSessionId: null },
      ],
      messages: [
        { id: 'm-in', sessionId: 'child' },
        { id: 'm-out', sessionId: 'other' },
      ],
      auditLogs: [
        { id: 'audit-in', sessionId: 'child' },
        { id: 'audit-global-legacy', sessionId: null },
        { id: 'audit-out', sessionId: 'other' },
      ],
      sharedSessions: [
        { sessionId: 'child', id: 'share-in' },
        { sessionId: 'other', id: 'share-out' },
      ],
    });

    expect(result.sessionScope ? Array.from(result.sessionScope).sort() : []).toEqual([
      'child',
      'root',
    ]);
    expect(result.handoffs.map((handoff) => handoff.id)).toEqual(['h-in']);
    expect(result.runtimeTasks.map((task) => task.id)).toEqual(['t-in']);
    expect(result.sessions.map((session) => session.id).sort()).toEqual(['child', 'root']);
    expect(result.messages.map((message) => message.id)).toEqual(['m-in']);
    expect(result.auditLogs).toEqual([
      { id: 'audit-in', sessionId: 'child' },
      { id: 'audit-global-legacy', sessionId: null },
    ]);
    expect(result.sharedSessions.map((session) => session.id)).toEqual(['share-in']);
  });
});
