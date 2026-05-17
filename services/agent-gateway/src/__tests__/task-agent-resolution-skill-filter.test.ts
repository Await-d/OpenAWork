/**
 * Coverage for `resolveDelegatedAgent`'s `parentEffective` filter (PR2).
 *
 * Asserts that:
 *   - BUILTIN skills are always kept regardless of effective state.
 *   - Installed skills NOT in the parent effective set are dropped.
 *   - droppedSkills is reported so the caller can audit-log.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveDelegatedAgent } from '../task-agent-resolution.js';
import type { EffectiveSkill } from '../skill-selection.js';

vi.mock('../db.js', () => ({
  sqliteAll: vi.fn(() => []),
  sqliteGet: vi.fn(() => undefined),
  sqliteRun: vi.fn(),
  sqliteTransaction: <T>(fn: () => T) => fn(),
}));

function effective(skillId: string, enabled = true): EffectiveSkill {
  return {
    skillId,
    enabled,
    pinned: false,
    origin: 'workspace',
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: skillId,
      name: skillId.split('.').pop() ?? skillId,
      displayName: skillId,
      version: '1.0.0',
      description: '',
      capabilities: [],
      permissions: [],
    } as EffectiveSkill['manifest'],
  };
}

describe('resolveDelegatedAgent parentEffective filter', () => {
  it('keeps all skills when no parentEffective is provided (legacy behaviour)', () => {
    const result = resolveDelegatedAgent('user-1', {
      load_skills: ['custom-skill', 'foreign-skill', 'git-master'],
    });
    expect(result.requestedSkills).toEqual(['custom-skill', 'foreign-skill', 'git-master']);
    expect(result.droppedSkills).toEqual([]);
  });

  it('drops installed skills outside the parent effective set, keeps BUILTIN', () => {
    const result = resolveDelegatedAgent(
      'user-1',
      {
        load_skills: ['com.example.allowed', 'com.example.foreign', 'git-master'],
      },
      {
        parentEffective: [effective('com.example.allowed')],
      },
    );
    // git-master is BUILTIN → bypass; foreign is dropped.
    expect(result.requestedSkills).toEqual(['com.example.allowed', 'git-master']);
    expect(result.droppedSkills).toEqual(['com.example.foreign']);
  });

  it('drops skills whose effective row is disabled', () => {
    const result = resolveDelegatedAgent(
      'user-1',
      {
        load_skills: ['com.example.disabled'],
      },
      {
        parentEffective: [effective('com.example.disabled', false)],
      },
    );
    expect(result.requestedSkills).toEqual([]);
    expect(result.droppedSkills).toEqual(['com.example.disabled']);
  });

  it('matches by displayName / name aliases too, not only by id', () => {
    const result = resolveDelegatedAgent(
      'user-1',
      {
        load_skills: ['Allowed Skill'],
      },
      {
        parentEffective: [
          {
            ...effective('com.example.allowed'),
            manifest: {
              apiVersion: 'agent-skill/v1',
              id: 'com.example.allowed',
              name: 'allowed',
              displayName: 'Allowed Skill',
              version: '1.0.0',
              description: '',
              capabilities: [],
              permissions: [],
            } as EffectiveSkill['manifest'],
          },
        ],
      },
    );
    expect(result.requestedSkills).toEqual(['Allowed Skill']);
    expect(result.droppedSkills).toEqual([]);
  });
});
