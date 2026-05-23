import { describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import { validateSessionMetadataPatch } from '../../session/session-workspace-metadata.js';

describe('teamDefinition metadata', () => {
  it('接受默认固定团队 memberSlots 快照', () => {
    const result = validateSessionMetadataPatch({
      teamWorkspaceId: 'tw-fixed-roster',
      teamDefinition: {
        version: 2,
        createdAt: '2026-05-22T00:00:00.000Z',
        defaultProvider: null,
        memberSlots: DEFAULT_FIXED_TEAM_MEMBER_SLOTS,
        optionalMembers: [],
        requiredRoleBindings: [
          { role: 'leader', agentId: 'zeus', agentLabel: 'Zeus' },
          { role: 'planner', agentId: 'prometheus', agentLabel: 'Prometheus' },
          { role: 'researcher', agentId: 'librarian', agentLabel: 'Librarian' },
          { role: 'executor', agentId: 'hephaestus', agentLabel: 'Hephaestus' },
          { role: 'reviewer', agentId: 'momus', agentLabel: 'Momus' },
        ],
        source: { kind: 'blank' },
      },
    });

    expect(result.success).toBe(true);
  });
});
