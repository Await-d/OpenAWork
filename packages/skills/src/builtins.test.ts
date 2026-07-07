import { describe, expect, it } from 'vitest';
import { BUILTIN_SKILLS } from './builtins.js';

const LAZYCODEX_SKILL_NAMES = [
  'review-work',
  'programming',
  'frontend',
  'visual-qa',
  'lsp',
  'ast-grep',
  'rules',
] as const;

const LAZYCODEX_SKILL_NAME_SET = new Set<string>(LAZYCODEX_SKILL_NAMES);

describe('BUILTIN_SKILLS LazyCodex subset', () => {
  it('includes the high-value LazyCodex workflow skills as prompt-based builtins', () => {
    const byName = new Map(BUILTIN_SKILLS.map((entry) => [entry.manifest.name, entry.manifest]));

    for (const skillName of LAZYCODEX_SKILL_NAMES) {
      const manifest = byName.get(skillName);
      expect(manifest?.id).toBe(`com.openAwork.builtin.${skillName}`);
      expect(manifest?.descriptionForModel?.length ?? 0).toBeGreaterThan(120);
      expect(manifest?.lifecycle?.activation).toBe('on-demand');
    }
  });

  it('does not expose Codex-only tool names in the LazyCodex subset prompts', () => {
    const forbidden = ['multi_agent_v1', 'tool_search', 'mcp__codegraph', 'image_gen'];
    const subset = BUILTIN_SKILLS.filter((entry) =>
      LAZYCODEX_SKILL_NAME_SET.has(entry.manifest.name),
    );

    expect(subset).toHaveLength(LAZYCODEX_SKILL_NAMES.length);
    for (const entry of subset) {
      for (const token of forbidden) {
        expect(entry.manifest.descriptionForModel ?? '').not.toContain(token);
      }
    }
  });
});
