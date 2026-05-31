/**
 * Regression (§0.114, installed-skill manifest scan isolation):
 * findInstalledSkill (reached via the `skill` tool's execute) walks EVERY
 * enabled installed skill ordered by recency and parsed each row's
 * manifest_json. The parse was unguarded, so one corrupt manifest (crash
 * mid-write, disk error, hand-edited DB) threw the whole loop — and because
 * the scan is recency-ordered, a single bad manifest made the `skill` tool
 * unable to resolve ANY skill by name, not just the corrupt one. The scan now
 * skips the bad row (tryParseManifest → null) so the rest still resolve.
 *
 * We mock db.js so the installed_skills query returns a corrupt row first, then
 * a healthy matching row, and assert the tool still loads the healthy skill.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SkillToolsModule from '../../skill/skill-tools.js';

const HEALTHY_SKILL_ID = 'com.example.healthy';
const HEALTHY_SKILL_NAME = 'healthy-skill';

vi.mock('../../infra/db.js', () => ({
  // installed_skills scan (ORDER BY updated_at DESC): corrupt row first so we
  // prove the loop continues past it to the healthy match.
  sqliteAll: (sql: string) => {
    if (/FROM\s+installed_skills/i.test(sql)) {
      return [
        { skill_id: 'com.example.poison', source_id: 'src', manifest_json: '{not valid json' },
        {
          skill_id: HEALTHY_SKILL_ID,
          source_id: 'src',
          manifest_json: JSON.stringify({
            apiVersion: 'agent-skill/v1',
            id: HEALTHY_SKILL_ID,
            name: HEALTHY_SKILL_NAME,
            displayName: 'Healthy Skill',
            version: '1.0.0',
            description: 'a healthy skill',
            capabilities: [],
            permissions: [],
          }),
        },
      ];
    }
    return [];
  },
  // No registry cache row → execute falls back to buildBuiltinSkillContent.
  sqliteGet: () => undefined,
}));

let skillTools: typeof SkillToolsModule;

beforeEach(async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  skillTools = await import('../../skill/skill-tools.js');
});

describe('createSkillTool execute installed-manifest scan resilience', () => {
  it('扫描遇到损坏 manifest 行时跳过它，仍能按名解析到健康技能', async () => {
    const tool = skillTools.createSkillTool('ses-1', 'u-1');

    // Must not throw despite the corrupt manifest row ordered ahead of the match.
    const output = await tool.execute({ name: HEALTHY_SKILL_NAME }, new AbortController().signal);

    // The healthy skill resolved and its content rendered.
    expect(typeof output).toBe('string');
    expect(output).toContain('Healthy Skill');
    expect(console.warn).toHaveBeenCalled();
  });
});
