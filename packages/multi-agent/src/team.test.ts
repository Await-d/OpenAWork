import { describe, expect, it } from 'vitest';
import { TeamStoreImpl } from './team.js';

describe('TeamStoreImpl role metadata', () => {
  it('persists canonical role metadata from node_started events', () => {
    const store = new TeamStoreImpl();

    store.handleDAGEvent(
      {
        type: 'node_started',
        nodeId: 'node-1',
        timestamp: Date.now(),
        agentRoleId: 'reviewer',
        canonicalRole: { coreRole: 'reviewer', preset: 'verifier', confidence: 'high' },
      },
      'session-1',
    );

    const team = store.getTeam('session-1');
    expect(team?.members).toEqual([
      {
        id: 'node-1',
        name: 'reviewer',
        role: 'reviewer',
        canonicalRole: { coreRole: 'reviewer', preset: 'verifier', confidence: 'high' },
        status: 'working',
        currentTask: 'node-1',
      },
    ]);
  });
});
