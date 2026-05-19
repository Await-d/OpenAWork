/**
 * Pinned skill prompt injection — PR3 of the skill-workspace-selection spec.
 *
 * "Pinned" skills are workspace-level skills the user wants the model to know
 * about without having to call the `skill` tool. Their `descriptionForModel`
 * gets stitched into the system prompt as a sequence of `<skill_content>`
 * blocks (same shape used by `task-agent-resolution.ts` for delegated agents),
 * with a per-session token cap so a user pinning many heavy skills cannot
 * accidentally torch their context budget.
 *
 * Per-spec invariants:
 * - BUILTIN skills are NEVER pinned through this path (they are always
 *   available via the skill tool — pinning them would double-count tokens).
 * - Disabled effective entries are ignored.
 * - When the rendered section exceeds MAX_PINNED_SKILL_CHARS, lower-priority
 *   entries are dropped first; the cap is char-based as a coarse proxy for
 *   tokens (~4 chars/token) so we don't pull a tokenizer into the hot path.
 *
 * First-turn snapshot semantics live one layer up in `stream.ts`: the caller
 * is expected to read a stable snapshot of pinned skill ids from session
 * metadata, then look up the current manifests at render time. This module
 * is deliberately stateless so it stays trivially testable.
 */

import type { SkillManifest } from '@openAwork/skill-types';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import type { EffectiveSkill } from './skill-selection.js';

/**
 * Hard cap, in characters, on the rendered pinned-skills section. Tuned to
 * roughly 6k tokens at ~4 chars/token. Crossing this threshold drops
 * lower-priority entries until the section fits.
 */
export const MAX_PINNED_SKILL_CHARS = 24000;

const BUILTIN_SKILL_IDS = new Set(BUILTIN_SKILLS.map((entry) => entry.manifest.id));

interface PinnedCandidate {
  skillId: string;
  manifest: SkillManifest;
}

function selectPinnedCandidates(effective: EffectiveSkill[]): PinnedCandidate[] {
  return effective.flatMap((entry) => {
    if (!entry.enabled || !entry.pinned) return [];
    if (entry.origin === 'builtin' || BUILTIN_SKILL_IDS.has(entry.skillId)) return [];
    if (!entry.manifest) return [];
    return [{ skillId: entry.skillId, manifest: entry.manifest }];
  });
}

function renderSkillBlock(manifest: SkillManifest): string {
  const title = manifest.displayName ?? manifest.name ?? manifest.id;
  const description = manifest.description?.trim() ?? '';
  const descriptionForModel = manifest.descriptionForModel?.trim() ?? '';
  const lines: string[] = [`<skill_content name="${title}">`];
  if (description) lines.push(description);
  if (descriptionForModel) {
    if (description) lines.push('');
    lines.push(descriptionForModel);
  }
  lines.push('</skill_content>');
  return lines.join('\n');
}

export interface BuildPinnedSkillsPromptSectionOptions {
  /** Override the global character cap (mainly for tests). */
  maxChars?: number;
}

export interface PinnedSkillsPromptResult {
  /** The fully assembled prompt section, or null if no pinned skills are available. */
  section: string | null;
  /** Skill ids that ended up in the rendered output. */
  includedSkillIds: string[];
  /** Skill ids that were dropped because of the char cap. */
  truncatedSkillIds: string[];
}

/**
 * Build a system-prompt section from the user's pinned skills. Returns null
 * when there is nothing to inject — call sites should treat null as "skip".
 */
export function buildPinnedSkillsPromptSection(
  effective: EffectiveSkill[],
  options: BuildPinnedSkillsPromptSectionOptions = {},
): PinnedSkillsPromptResult {
  const candidates = selectPinnedCandidates(effective);
  if (candidates.length === 0) {
    return { section: null, includedSkillIds: [], truncatedSkillIds: [] };
  }

  const maxChars = options.maxChars ?? MAX_PINNED_SKILL_CHARS;
  const header = 'Pinned skills (always available, no need to call the skill tool):';

  const blocks: Array<{ skillId: string; rendered: string }> = candidates.map((candidate) => ({
    skillId: candidate.skillId,
    rendered: renderSkillBlock(candidate.manifest),
  }));

  const included: string[] = [];
  const truncated: string[] = [];
  let buffer = header;
  for (const block of blocks) {
    const next = `${buffer}\n\n${block.rendered}`;
    if (next.length > maxChars && included.length > 0) {
      truncated.push(block.skillId);
      continue;
    }
    if (next.length > maxChars) {
      // single block alone is bigger than the cap — keep its first slice so
      // the user still sees something instead of silently dropping every pin.
      const headroom = Math.max(0, maxChars - buffer.length - 64);
      buffer = `${buffer}\n\n${block.rendered.slice(0, headroom)}\n<!-- pinned-skill truncated -->`;
      included.push(block.skillId);
      continue;
    }
    buffer = next;
    included.push(block.skillId);
  }

  if (truncated.length > 0) {
    buffer = `${buffer}\n\n<!-- ${truncated.length} pinned skill(s) omitted to stay within the prompt size budget -->`;
  }

  return {
    section: buffer,
    includedSkillIds: included,
    truncatedSkillIds: truncated,
  };
}

/**
 * Pinned skill snapshot stored on `sessions.metadata_json`. Captured on the
 * first stream turn so subsequent turns / replays render against a stable
 * list — UI changes to pinned skills only take effect for newly-created
 * sessions, matching the toast "next new session" promise from the spec.
 */
export interface PinnedSkillsSnapshot {
  /** Ordered list of pinned skill ids captured at session start. */
  skillIds: string[];
  /** ms timestamp of when the snapshot was taken. */
  capturedAt: number;
}

export function snapshotFromEffective(effective: EffectiveSkill[]): PinnedSkillsSnapshot {
  return {
    skillIds: selectPinnedCandidates(effective).map((c) => c.skillId),
    capturedAt: Date.now(),
  };
}

/**
 * Filter an effective set down to entries whose ids match the snapshot, in
 * snapshot order. Caller renders the result with `buildPinnedSkillsPromptSection`.
 *
 * Snapshot semantics (matters for the "next session takes effect" contract):
 *   - `null` / `undefined` → no snapshot ever captured for this session
 *     (e.g. legacy session created before PR3 shipped). Pass through the live
 *     effective set so older sessions don't lose their pinned section.
 *   - `{ skillIds: [], capturedAt: ... }` → snapshot was captured, the user
 *     simply had no pinned skills at session start. Suppress every live
 *     `pinned` flag so newly pinned skills do NOT leak into this session.
 *   - non-empty `skillIds` → keep only those ids pinned, in capture order.
 */
export function applyPinnedSnapshot(
  effective: EffectiveSkill[],
  snapshot: PinnedSkillsSnapshot | null | undefined,
): EffectiveSkill[] {
  if (snapshot === null || snapshot === undefined) {
    return effective;
  }
  if (snapshot.skillIds.length === 0) {
    // Explicit empty snapshot — strip pinned from every live entry so the
    // user's mid-session pin toggle cannot leak into this session.
    return effective.map((entry) => (entry.pinned ? { ...entry, pinned: false } : entry));
  }
  const byId = new Map(effective.map((entry) => [entry.skillId, entry]));
  const result: EffectiveSkill[] = [];
  for (const skillId of snapshot.skillIds) {
    const entry = byId.get(skillId);
    if (!entry) continue;
    if (!entry.enabled) continue;
    result.push({ ...entry, pinned: true });
    byId.delete(skillId);
  }
  // Preserve the rest of the effective set unchanged so non-pinned entries
  // (workspace fallback, builtin, etc.) still flow to other consumers — but
  // strip any stray pinned=true that's not in the snapshot.
  for (const remaining of byId.values()) {
    result.push(remaining.pinned ? { ...remaining, pinned: false } : remaining);
  }
  return result;
}
