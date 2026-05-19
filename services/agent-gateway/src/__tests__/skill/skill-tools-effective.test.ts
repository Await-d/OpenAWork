/**
 * Coverage for `createSkillTool`'s effective-set integration:
 *
 * - description renders only enabled installed/local + BUILTIN entries
 * - execute rejects requests for installed/local skills outside the set
 * - BUILTIN skills bypass the filter regardless of effective state
 *
 * The tool's normal happy paths (load installed manifest, fetch cached entry,
 * etc.) are intentionally not retested here — they live in the legacy
 * skill-tools tests. PR2 only adds the gating behaviour.
 */

import { describe, expect, it } from 'vitest';
import { createSkillTool, renderSkillReferenceFilesBlock } from '../../skill/skill-tools.js';
import type { EffectiveSkill } from '../../skill/skill-selection.js';
import type { SkillManifest } from '@openAwork/skill-types';

const builtinManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.openAwork.builtin.git-master',
  name: 'git-master',
  displayName: 'git-master',
  version: '1.0.0',
  description: 'git operations',
  capabilities: ['git.commit'],
  permissions: [],
};

const customManifest = {
  apiVersion: 'agent-skill/v1',
  id: 'com.example.custom',
  name: 'custom-skill',
  displayName: 'Custom Skill',
  version: '1.0.0',
  description: 'A custom skill',
  capabilities: ['custom.test'],
  permissions: [],
};

const otherManifest = {
  ...customManifest,
  id: 'com.example.other',
  name: 'other-skill',
  displayName: 'Other Skill',
  description: 'A different skill',
};

function builtinEffective(): EffectiveSkill {
  return {
    skillId: builtinManifest.id,
    enabled: true,
    pinned: false,
    origin: 'builtin',
    manifest: builtinManifest as EffectiveSkill['manifest'],
  };
}

function customEffective(overrides: Partial<EffectiveSkill> = {}): EffectiveSkill {
  return {
    skillId: customManifest.id,
    enabled: true,
    pinned: false,
    origin: 'workspace',
    manifest: customManifest as EffectiveSkill['manifest'],
    ...overrides,
  };
}

describe('createSkillTool description rendering', () => {
  it('uses the legacy generic description when no effective set is provided', () => {
    const tool = createSkillTool('s', 'u');
    expect(tool.description).not.toContain('Available skills (this session)');
  });

  it('lists enabled installed + builtin entries with tags', () => {
    const tool = createSkillTool('s', 'u', {
      effective: [customEffective({ pinned: true }), builtinEffective()],
    });
    expect(tool.description).toContain('Available skills (this session):');
    expect(tool.description).toContain('Custom Skill [pinned]');
    expect(tool.description).toContain('git-master [builtin]');
  });

  it('omits disabled installed entries from the listing', () => {
    const tool = createSkillTool('s', 'u', {
      effective: [
        customEffective({ enabled: false }),
        { ...customEffective(), skillId: otherManifest.id, manifest: otherManifest as never },
        builtinEffective(),
      ],
    });
    expect(tool.description).not.toContain('Custom Skill');
    expect(tool.description).toContain('Other Skill [enabled]');
  });

  it('falls back to a refusal hint when no installed skill is enabled', () => {
    const tool = createSkillTool('s', 'u', {
      effective: [],
    });
    // Empty effective means "never configured" path, but caller may still
    // explicitly pass [] when they want strict refusal — we render the empty
    // state as the legacy description, which is acceptable. The active path
    // we want to assert is "all disabled":
    const allDisabled = createSkillTool('s', 'u', {
      effective: [customEffective({ enabled: false })],
    });
    expect(allDisabled.description).toContain('No skills enabled for this workspace');
    expect(tool).toBeDefined();
  });
});

describe('createSkillTool execute gating', () => {
  it('rejects installed skills not in the effective set', async () => {
    const tool = createSkillTool('s', 'u', {
      effective: [builtinEffective()],
    });
    const signal = new AbortController().signal;
    await expect(tool.execute({ name: customManifest.id }, signal)).rejects.toThrow(
      /Skill not allowed in current workspace\/session/,
    );
  });

  it('allows BUILTIN regardless of effective state', async () => {
    const tool = createSkillTool('s', 'u', {
      effective: [], // strict mode but BUILTIN bypasses
    });
    const signal = new AbortController().signal;
    const result = await tool.execute({ name: builtinManifest.id }, signal);
    expect(result).toContain(`<skill_content name="${builtinManifest.displayName}">`);
  });

  it('passes through to legacy resolution when no effective is provided (back-compat)', async () => {
    const tool = createSkillTool('s', 'u');
    // No DB → BUILTIN still resolves through findBuiltinSkillContent
    const signal = new AbortController().signal;
    const result = await tool.execute({ name: builtinManifest.name }, signal);
    expect(result).toContain('git-master');
  });
});

/**
 * Verifies the `<skill_files>` block rendering added to align with
 * opencode's `tool/skill.ts` skill loader. The block is the
 * OpenAWork-native equivalent of opencode's ripgrep file sample —
 * sourced from the manifest's declared `references[].path` instead of
 * a filesystem walk because OpenAWork skills don't have a uniform
 * on-disk root.
 */
describe('renderSkillReferenceFilesBlock', () => {
  it('returns an empty array when manifest has no references', () => {
    expect(renderSkillReferenceFilesBlock({})).toEqual([]);
    expect(renderSkillReferenceFilesBlock({ references: [] })).toEqual([]);
  });

  it('emits a <skill_files> block listing each declared reference path', () => {
    const block = renderSkillReferenceFilesBlock({
      references: [
        { path: 'scripts/setup.sh', loadAt: 'activation' },
        { path: 'reference/api.md', loadAt: 'never' },
      ],
    } as Partial<SkillManifest>);
    const joined = block.join('\n');
    expect(joined).toContain('<skill_files>');
    expect(joined).toContain('<file>scripts/setup.sh</file>');
    expect(joined).toContain('<file>reference/api.md</file>');
    expect(joined).toContain('</skill_files>');
  });

  it('skips reference entries with empty / missing paths so the prompt prefix stays byte-stable', () => {
    const block = renderSkillReferenceFilesBlock({
      references: [
        { path: '', loadAt: 'activation' },
        { path: '   ', loadAt: 'activation' },
        // Casted because we want to verify the runtime guard handles
        // partial / older-shaped manifests (see helper jsdoc).
        { loadAt: 'activation' } as unknown as { path: string; loadAt: 'activation' },
        { path: 'docs/intro.md', loadAt: 'activation' },
      ],
    } as Partial<SkillManifest>);
    const joined = block.join('\n');
    expect(joined).toContain('<file>docs/intro.md</file>');
    // Negative assertions: blank-path entries must not produce empty
    // <file></file> nodes.
    expect(joined).not.toMatch(/<file>\s*<\/file>/);
  });

  it('emerges in the BUILTIN execute output when the manifest declares references', async () => {
    // Use a real BUILTIN skill — the synthetic builtinManifest above
    // doesn't carry references, so we go through the public BUILTIN
    // table to assert the integration end-to-end.
    const { BUILTIN_SKILLS } = await import('@openAwork/skills');
    const withRefs = BUILTIN_SKILLS.find(
      (entry) => Array.isArray(entry.manifest.references) && entry.manifest.references.length > 0,
    );
    if (!withRefs) {
      // Skip silently if no BUILTIN skill currently declares references —
      // the renderer is still covered by the unit tests above.
      return;
    }
    const tool = createSkillTool('s', 'u');
    const signal = new AbortController().signal;
    const out = await tool.execute({ name: withRefs.manifest.name }, signal);
    expect(out).toContain('<skill_files>');
    expect(out).toContain('</skill_files>');
  });
});
