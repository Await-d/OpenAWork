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

  it('保留自定义角色的 systemPrompt / skillIds / mcpServerIds / routingKeywords（不被 schema 剥离）', () => {
    const result = validateSessionMetadataPatch({
      teamWorkspaceId: 'tw-custom-roster',
      teamDefinition: {
        version: 2,
        createdAt: '2026-05-31T00:00:00.000Z',
        defaultProvider: null,
        memberSlots: [
          {
            id: 'executor-custom-perf',
            layer: 'executor',
            specialty: 'custom',
            displayName: '性能优化专家',
            personaKey: 'executor:custom:perf',
            toolsets: ['read', 'write', 'shell'],
            required: false,
            custom: true,
            systemPrompt: '你是性能优化专家。',
            skillIds: ['skill-a'],
            mcpServerIds: ['mcp-b'],
            routingKeywords: ['性能', '渲染瓶颈'],
          },
        ],
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
    if (result.success) {
      const slot = result.data.teamDefinition?.memberSlots?.[0];
      expect(slot?.routingKeywords).toEqual(['性能', '渲染瓶颈']);
      expect(slot?.systemPrompt).toBe('你是性能优化专家。');
      expect(slot?.skillIds).toEqual(['skill-a']);
      expect(slot?.mcpServerIds).toEqual(['mcp-b']);
    }
  });
});
