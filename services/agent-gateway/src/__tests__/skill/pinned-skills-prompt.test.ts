/**
 * Coverage for `buildPinnedSkillsPromptSection`, `snapshotFromEffective`,
 * and `applyPinnedSnapshot`.
 *
 * Asserts:
 *   - BUILTIN entries are never rendered, even if the caller wrongly marks
 *     them pinned.
 *   - Disabled effective entries are skipped.
 *   - The char cap drops lower-priority blocks; closing tag of the kept
 *     blocks remains intact (no half-rendered XML).
 *   - Snapshot capture / replay produces a deterministic order matching the
 *     original capture, even when the live effective set changes later.
 */

import { describe, expect, it } from 'vitest';
import {
  applyPinnedSnapshot,
  buildPinnedSkillsPromptSection,
  snapshotFromEffective,
  MAX_PINNED_SKILL_CHARS,
} from '../../skill/pinned-skills-prompt.js';
import type { EffectiveSkill } from '../../skill/skill-selection.js';

function entry(overrides: Partial<EffectiveSkill>): EffectiveSkill {
  const skillId = overrides.skillId ?? 'com.example.test';
  return {
    skillId,
    enabled: true,
    pinned: true,
    origin: 'workspace',
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: skillId,
      name: skillId.split('.').pop() ?? skillId,
      displayName: skillId,
      version: '1.0.0',
      description: `desc for ${skillId}`,
      descriptionForModel: `model instructions for ${skillId}`,
      capabilities: [],
      permissions: [],
    } as EffectiveSkill['manifest'],
    ...overrides,
  };
}

describe('buildPinnedSkillsPromptSection', () => {
  it('returns null when no pinned candidates exist', () => {
    const result = buildPinnedSkillsPromptSection([
      entry({ skillId: 'a', pinned: false }),
      entry({ skillId: 'b', enabled: false }),
    ]);
    expect(result.section).toBeNull();
    expect(result.includedSkillIds).toEqual([]);
  });

  it('renders enabled+pinned entries as <skill_content> blocks', () => {
    const result = buildPinnedSkillsPromptSection([
      entry({ skillId: 'com.example.alpha' }),
      entry({ skillId: 'com.example.beta' }),
    ]);
    expect(result.section).toContain('<skill_content name="com.example.alpha">');
    expect(result.section).toContain('<skill_content name="com.example.beta">');
    expect(result.section).toContain('</skill_content>');
    expect(result.includedSkillIds).toEqual(['com.example.alpha', 'com.example.beta']);
    expect(result.truncatedSkillIds).toEqual([]);
  });

  it('skips BUILTIN entries even when wrongly marked pinned', () => {
    const result = buildPinnedSkillsPromptSection([
      entry({
        skillId: 'com.openAwork.builtin.git-master',
        origin: 'builtin',
      }),
      entry({ skillId: 'com.example.kept' }),
    ]);
    expect(result.section).not.toContain('git-master');
    expect(result.includedSkillIds).toEqual(['com.example.kept']);
  });

  it('drops lower-priority entries when the char cap is exceeded', () => {
    const small = 200;
    const result = buildPinnedSkillsPromptSection(
      [
        entry({ skillId: 'com.example.first' }),
        entry({ skillId: 'com.example.second' }),
        entry({ skillId: 'com.example.third' }),
      ],
      { maxChars: small },
    );
    expect(result.includedSkillIds.length).toBeGreaterThanOrEqual(1);
    expect(result.includedSkillIds.length + result.truncatedSkillIds.length).toBe(3);
    // Closing tag of every included block must be present (no half-renders).
    const closeCount = (result.section ?? '').split('</skill_content>').length - 1;
    expect(closeCount).toBe(result.includedSkillIds.length);
    expect(result.section).toContain('pinned skill(s) omitted');
  });

  it('honours the global default char cap when no override is supplied', () => {
    const result = buildPinnedSkillsPromptSection([entry({ skillId: 'a' })]);
    expect(result.section!.length).toBeLessThanOrEqual(MAX_PINNED_SKILL_CHARS);
  });
});

describe('snapshotFromEffective + applyPinnedSnapshot', () => {
  it('captures pinned skill ids in order and replays them stably', () => {
    const initial = [
      entry({ skillId: 'com.example.first' }),
      entry({ skillId: 'com.example.second' }),
      entry({ skillId: 'com.example.unpinned', pinned: false }),
    ];
    const snapshot = snapshotFromEffective(initial);
    expect(snapshot.skillIds).toEqual(['com.example.first', 'com.example.second']);

    // Later effective set has different pinned flags + an extra entry.
    const later = [
      entry({ skillId: 'com.example.first', pinned: false }), // user flipped pinned off
      entry({ skillId: 'com.example.second', pinned: false }),
      entry({ skillId: 'com.example.new', pinned: true }), // user pinned a new one
    ];
    const replayed = applyPinnedSnapshot(later, snapshot);
    const pinned = replayed.filter((e) => e.pinned);
    expect(pinned.map((e) => e.skillId)).toEqual(['com.example.first', 'com.example.second']);
    // The "new" one is not promoted because the snapshot drives pinning.
    expect(pinned.some((e) => e.skillId === 'com.example.new')).toBe(false);
  });

  it('drops disabled snapshot entries on replay', () => {
    const snapshot = snapshotFromEffective([entry({ skillId: 'com.example.x' })]);
    const replayed = applyPinnedSnapshot(
      [entry({ skillId: 'com.example.x', enabled: false })],
      snapshot,
    );
    expect(replayed.find((e) => e.skillId === 'com.example.x' && e.pinned)).toBeUndefined();
  });

  it('passes through unchanged when snapshot is null/undefined (legacy session)', () => {
    const live = [entry({ skillId: 'com.example.live' })];
    expect(applyPinnedSnapshot(live, null)).toEqual(live);
    expect(applyPinnedSnapshot(live, undefined)).toEqual(live);
  });

  it('strips pinned from every live entry when snapshot was captured empty', () => {
    // Session started with no pinned; user later pins something. Snapshot
    // is empty → `applyPinnedSnapshot` must NOT let the new pin leak in.
    const liveAfterUserPinned = [entry({ skillId: 'com.example.live', pinned: true })];
    const stripped = applyPinnedSnapshot(liveAfterUserPinned, {
      skillIds: [],
      capturedAt: 0,
    });
    expect(stripped.every((e) => !e.pinned)).toBe(true);
  });
});
