/**
 * Constants shared across skill-management surfaces (SkillsPage,
 * Settings → 插件 → 技能, etc). Pulled into its own file so both
 * sides agree on which skill IDs are considered "system-bundled" and
 * therefore must not be removable / disable-able by a regular user.
 *
 * Adding new entries here is the only step needed to lock down a skill
 * on every UI surface — no per-page duplication.
 */

export const DEFAULT_PREINSTALLED_SKILL_IDS: ReadonlySet<string> = new Set([
  'github:Await-d/agentdocs-orchestrator/agentdocs-orchestrator',
  'github:Await-d/agentdocs-orchestrator/schema-architect',
]);
