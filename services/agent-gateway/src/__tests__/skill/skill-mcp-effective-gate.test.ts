/**
 * Coverage for `isSkillMcpAllowedByEffective` — the workspace selection
 * gate applied before `skill_mcp` execution. Closes the bypass found in
 * complex session-history setups where a model could guess an mcp_name
 * pointing at a skill the user removed from the workspace selection.
 */

import { describe, expect, it } from 'vitest';
import { isSkillMcpAllowedByEffective } from '../../skill/skill-mcp-tools.js';
import type { EffectiveSkill } from '../../skill/skill-selection.js';

function effective(overrides: Partial<EffectiveSkill>): EffectiveSkill {
  const skillId = overrides.skillId ?? 'com.example.skill';
  return {
    skillId,
    enabled: true,
    pinned: false,
    origin: 'workspace',
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: skillId,
      name: 'skill-name',
      displayName: 'Skill Display',
      version: '1.0.0',
      description: '',
      capabilities: [],
      permissions: [],
    } as EffectiveSkill['manifest'],
    ...overrides,
  };
}

describe('isSkillMcpAllowedByEffective', () => {
  it('passes through when no effective set is provided (legacy back-compat)', () => {
    expect(isSkillMcpAllowedByEffective(null, 'anything')).toBe(true);
    expect(isSkillMcpAllowedByEffective(undefined, 'anything')).toBe(true);
  });

  it('rejects mcp names that match no effective entry', () => {
    expect(
      isSkillMcpAllowedByEffective(
        [effective({ skillId: 'com.example.allowed' })],
        'com.example.foreign',
      ),
    ).toBe(false);
  });

  it('matches by skill id, manifest name, or displayName', () => {
    const set: EffectiveSkill[] = [effective({ skillId: 'com.example.allowed' })];
    expect(isSkillMcpAllowedByEffective(set, 'com.example.allowed')).toBe(true);
    expect(isSkillMcpAllowedByEffective(set, 'skill-name')).toBe(true);
    expect(isSkillMcpAllowedByEffective(set, 'Skill Display')).toBe(true);
  });

  it('matches by manifest.mcp.id when present', () => {
    const set: EffectiveSkill[] = [
      {
        ...effective({ skillId: 'com.example.embeddedmcp' }),
        manifest: {
          apiVersion: 'agent-skill/v1',
          id: 'com.example.embeddedmcp',
          name: 'embedded',
          displayName: 'Embedded',
          version: '1.0.0',
          description: '',
          capabilities: [],
          permissions: [],
          mcp: {
            id: 'embedded-mcp',
            transport: 'stdio',
          },
        } as EffectiveSkill['manifest'],
      },
    ];
    expect(isSkillMcpAllowedByEffective(set, 'embedded-mcp')).toBe(true);
  });

  it('rejects disabled effective entries even when names match', () => {
    expect(
      isSkillMcpAllowedByEffective(
        [effective({ skillId: 'com.example.disabled', enabled: false })],
        'com.example.disabled',
      ),
    ).toBe(false);
  });

  it('is case- and whitespace-insensitive', () => {
    const set: EffectiveSkill[] = [effective({ skillId: 'com.example.allowed' })];
    expect(isSkillMcpAllowedByEffective(set, '  COM.example.ALLOWED  ')).toBe(true);
    expect(isSkillMcpAllowedByEffective(set, 'SKILL-NAME')).toBe(true);
  });
});
