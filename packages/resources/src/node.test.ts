import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { INTEGRATED_RESOURCE_SKILL_NAMES, REFERENCE_ONLY_SKILL_NAMES } from './catalog.js';
import {
  createBuiltinResourceSkillDefs,
  createResourceSkillManifest,
  resourcePath,
} from './node.js';

describe('OpenCowork resource skills', () => {
  it('creates manifests for integrated resource skills and keeps reference-only skills disabled', () => {
    const noopExecutor = async () => ({ content: 'noop', isError: false });

    const defs = createBuiltinResourceSkillDefs(noopExecutor);
    const names = new Set(defs.map((entry) => entry.manifest.name));

    expect(defs).toHaveLength(INTEGRATED_RESOURCE_SKILL_NAMES.length);
    for (const skillName of INTEGRATED_RESOURCE_SKILL_NAMES) {
      expect(names.has(skillName)).toBe(true);
    }
    for (const skillName of REFERENCE_ONLY_SKILL_NAMES) {
      expect(names.has(skillName)).toBe(false);
    }
  });

  it('links each manifest to an existing SKILL.md resource and full model instructions', () => {
    for (const skillName of INTEGRATED_RESOURCE_SKILL_NAMES) {
      const manifest = createResourceSkillManifest(skillName);
      const skillPath = resourcePath('skills', skillName, 'SKILL.md');

      expect(manifest.id).toBe(`com.openAwork.resource.${skillName}`);
      expect(manifest.descriptionForModel?.length ?? 0).toBeGreaterThan(300);
      expect(manifest.references?.[0]?.path).toBe(skillPath);
      expect(existsSync(skillPath)).toBe(true);
    }
  });
});
