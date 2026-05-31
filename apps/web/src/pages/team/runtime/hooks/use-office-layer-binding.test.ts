import { describe, expect, it } from 'vitest';
import {
  deriveLayerActivity,
  layerToOfficeStatus,
  deriveOfficeStatusOverlay,
  AGENT_INDEX_TO_LAYER,
  type LayerActivity,
} from './use-office-layer-binding.js';
import type { HandoffEntry, LayerNode, TeamRoleLayer } from '../../../../stores/team/team-events.js';
import type { AgentTeamsOfficeAgent } from '../data/team-runtime-types.js';

function agent(id: string): AgentTeamsOfficeAgent {
  return { id, accent: '#fff', label: id, note: '', status: 'resting', x: 0, y: 0 };
}

function node(partial: Partial<LayerNode> & Pick<LayerNode, 'sessionId' | 'roleLayer' | 'state'>): LayerNode {
  return { parentSessionId: null, ...partial };
}

describe('deriveLayerActivity', () => {
  it('从 layer 节点与 handoff 聚合活动状态', () => {
    const activity = deriveLayerActivity({
      layerNodes: [
        node({ sessionId: 'a', roleLayer: 'pm1', state: 'running' }),
        node({ sessionId: 'b', roleLayer: 'executor', state: 'pending' }),
      ],
      handoffs: [
        {
          id: 'h1',
          state: 'failed',
          fromRoleLayer: 'pm2',
          toRoleLayer: 'reviewer',
          updatedAt: 1,
        } as HandoffEntry,
      ],
    });
    expect(activity.running.has('pm1')).toBe(true);
    expect(activity.pending.has('executor')).toBe(true);
    expect(activity.failed.has('reviewer')).toBe(true);
  });
});

describe('layerToOfficeStatus', () => {
  const activity: LayerActivity = {
    running: new Set<TeamRoleLayer>(['pm1']),
    pending: new Set<TeamRoleLayer>(['executor']),
    failed: new Set<TeamRoleLayer>(),
  };
  it('running → working', () => {
    expect(layerToOfficeStatus('pm1', activity)).toBe('working');
  });
  it('pending → discussing', () => {
    expect(layerToOfficeStatus('executor', activity)).toBe('discussing');
  });
  it('其他 → resting', () => {
    expect(layerToOfficeStatus('reviewer', activity)).toBe('resting');
  });
});

describe('deriveOfficeStatusOverlay', () => {
  it('无任何活动时原样返回', () => {
    const agents = [agent('leader'), agent('researcher')];
    const result = deriveOfficeStatusOverlay(agents, {
      running: new Set<TeamRoleLayer>(),
      pending: new Set<TeamRoleLayer>(),
      failed: new Set<TeamRoleLayer>(),
    });
    expect(result).toBe(agents);
  });

  it('按 agent 索引映射到层级状态', () => {
    const agents = [agent('s0'), agent('s1'), agent('s2'), agent('s3')];
    // 索引 0→pm1, 1→pm2, 2→executor, 3→reviewer
    const activity: LayerActivity = {
      running: new Set<TeamRoleLayer>(['pm1']),
      pending: new Set<TeamRoleLayer>(['executor']),
      failed: new Set<TeamRoleLayer>(),
    };
    const result = deriveOfficeStatusOverlay(agents, activity);
    expect(AGENT_INDEX_TO_LAYER[0]).toBe('pm1');
    expect(result[0]!.status).toBe('working'); // pm1 running
    expect(result[2]!.status).toBe('discussing'); // executor pending
    expect(result[1]!.status).toBe('resting'); // pm2 idle
  });
});
