import { describe, expect, it } from 'vitest';
import { buildTeamDynamicScopeNodes } from './use-team-dynamic-entries.js';

describe('buildTeamDynamicScopeNodes', () => {
  it('会合并 session 快照与 layer tree，并优先保留 layer tree 的父链', () => {
    const result = buildTeamDynamicScopeNodes({
      sessions: [
        { id: 'root', parentSessionId: null },
        { id: 'child-from-snapshot', parentSessionId: 'root' },
      ],
      layerNodes: [
        { sessionId: 'child-from-snapshot', parentSessionId: 'pm1-live-parent' },
        { sessionId: 'child-only-in-layer', parentSessionId: 'root' },
      ],
    });

    expect(result).toEqual(
      expect.arrayContaining([
        { id: 'root', parentSessionId: null },
        { id: 'child-from-snapshot', parentSessionId: 'pm1-live-parent' },
        { id: 'child-only-in-layer', parentSessionId: 'root' },
      ]),
    );
  });
});
