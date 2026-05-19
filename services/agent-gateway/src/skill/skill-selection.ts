/**
 * Skill selection resolver — PR1 of the skill-workspace-selection spec.
 *
 * See `.agentdocs/workflow/260509-skill-workspace-selection-spec.md` for the
 * full design. This module is the single entry point that every downstream
 * caller (skill tool description renderer, system-prompt pinned injector,
 * task-agent delegation filter, capabilities route) must route through, so
 * filter semantics stay identical everywhere.
 *
 * Core semantics:
 *   1. Workspace path is normalized once and matched verbatim afterwards.
 *      Missing workspace path collapses to the sentinel `__default__`.
 *   2. The resolver checks `chat_workspace_skill_configured` for an explicit
 *      "user has saved configuration here" marker. When present, the user's
 *      choice (even an empty selection set!) wins. When absent, we try the
 *      `__default__` key, and if THAT is also unconfigured, we fall back to
 *      reading `installed_skills.enabled=1` live — this is the "never
 *      configured" escape hatch so first-time users see current behaviour
 *      unchanged.
 *   3. Session overrides are applied on top of the workspace-level view.
 *      A `pinned=null` override means the user flipped `enabled` only.
 *   4. BUILTIN_SKILLS are always appended as enabled/not-pinned and CANNOT
 *      be disabled or pinned through selection tables (hard invariant).
 *   5. `installed_skills.enabled=0` rows are hard-off for the user — they
 *      never appear in the effective set even if the selection table has
 *      `enabled=1`, because user-level uninstall/disable takes precedence.
 */

import { resolve } from 'node:path';
import { BUILTIN_SKILLS } from '@openAwork/skills';
import type { SkillManifest } from '@openAwork/skill-types';
import { sqliteAll, sqliteGet } from '../db.js';
import { validateWorkspacePath } from '../workspace/workspace-paths.js';

export const DEFAULT_WORKSPACE_PATH_KEY = '__default__';

export type SkillOrigin = 'workspace' | 'workspace-fallback' | 'session-override' | 'builtin';

export interface EffectiveSkill {
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  origin: SkillOrigin;
  reason?: string;
  /** Parsed manifest when available — BUILTIN rows always carry one; installed rows carry one when the row is enabled. */
  manifest?: SkillManifest;
}

export interface ResolveEffectiveSkillsInput {
  userId: string;
  /** Raw path from session metadata, or null when the session has none. */
  workspacePath: string | null;
  /** Session id when we want to apply per-session overrides. */
  sessionId: string | null;
}

/**
 * Normalize a user-provided workspace path to the canonical sentinel used as
 * the selection table's `workspace_path` column. Returns `__default__` for
 * null/empty/invalid input so callers never have to special-case.
 *
 * Note: we do NOT enforce `validateWorkspacePath` here because the resolver
 * is called from the request hot-path (every stream turn) and path roots may
 * be empty in some environments. The CRUD route layer is responsible for
 * rejecting out-of-root writes.
 */
export function normalizeWorkspacePathKey(raw: string | null | undefined): string {
  if (typeof raw !== 'string') {
    return DEFAULT_WORKSPACE_PATH_KEY;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return DEFAULT_WORKSPACE_PATH_KEY;
  }
  try {
    return resolve(trimmed).replace(/\/+$/, '') || DEFAULT_WORKSPACE_PATH_KEY;
  } catch {
    return DEFAULT_WORKSPACE_PATH_KEY;
  }
}

/**
 * Like `normalizeWorkspacePathKey` but additionally enforces that the path
 * lives inside a configured workspace root. Returns null for writes that
 * should be rejected. Used by CRUD routes, not the resolver.
 */
export function normalizeWorkspacePathForWrite(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return DEFAULT_WORKSPACE_PATH_KEY;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return DEFAULT_WORKSPACE_PATH_KEY;
  }
  const validated = validateWorkspacePath(trimmed);
  if (!validated) {
    return null;
  }
  return validated.replace(/\/+$/, '') || DEFAULT_WORKSPACE_PATH_KEY;
}

interface WorkspaceSelectionRow {
  skill_id: string;
  enabled: number;
  pinned: number;
  reason: string | null;
  source: string;
  /** Lower = renders earlier; ties broken by skill_id ASC. */
  priority: number;
}

interface SessionOverrideRow {
  skill_id: string;
  enabled: number;
  pinned: number | null;
}

interface InstalledSkillRow {
  skill_id: string;
  manifest_json: string;
  enabled: number;
}

function parseManifest(raw: string): SkillManifest | undefined {
  try {
    return JSON.parse(raw) as SkillManifest;
  } catch {
    return undefined;
  }
}

function readInstalledSkillsForUser(userId: string): Map<string, InstalledSkillRow> {
  const rows = sqliteAll<InstalledSkillRow>(
    'SELECT skill_id, manifest_json, enabled FROM installed_skills WHERE user_id = ? ORDER BY skill_id ASC',
    [userId],
  );
  const map = new Map<string, InstalledSkillRow>();
  for (const row of rows) {
    map.set(row.skill_id, row);
  }
  return map;
}

function readWorkspaceSelections(userId: string, workspacePath: string): WorkspaceSelectionRow[] {
  return sqliteAll<WorkspaceSelectionRow>(
    `SELECT skill_id, enabled, pinned, reason, source, priority
     FROM chat_workspace_skill_selections
     WHERE user_id = ? AND workspace_path = ?
     ORDER BY priority ASC, skill_id ASC`,
    [userId, workspacePath],
  );
}

/**
 * `true` iff the user has explicitly saved any configuration for this
 * `(user, workspacePath)` tuple — including an *empty* selection set. Used
 * by the resolver to distinguish "never configured" (→ fall back to
 * installed_skills.enabled) from "explicitly disabled everything" (→ keep
 * effective set empty so only BUILTIN remains).
 */
function isWorkspaceConfigured(userId: string, workspacePath: string): boolean {
  const row = sqliteGet<{ configured_at: number }>(
    `SELECT configured_at FROM chat_workspace_skill_configured
     WHERE user_id = ? AND workspace_path = ?`,
    [userId, workspacePath],
  );
  return Boolean(row);
}

function readSessionOverrides(sessionId: string): Map<string, SessionOverrideRow> {
  const rows = sqliteAll<SessionOverrideRow>(
    `SELECT skill_id, enabled, pinned
     FROM chat_session_skill_overrides
     WHERE session_id = ?`,
    [sessionId],
  );
  const map = new Map<string, SessionOverrideRow>();
  for (const row of rows) {
    map.set(row.skill_id, row);
  }
  return map;
}

function builtinSkillIdSet(): Set<string> {
  return new Set(BUILTIN_SKILLS.map((entry) => entry.manifest.id));
}

function effectiveFromBuiltins(): EffectiveSkill[] {
  return BUILTIN_SKILLS.map((entry) => ({
    skillId: entry.manifest.id,
    enabled: true,
    pinned: false,
    origin: 'builtin' as const,
    manifest: entry.manifest,
  }));
}

/**
 * Resolve the effective skill set for a given (user, workspace, session)
 * tuple. Pure function of current DB state — callers may cache the result
 * for a single request but must re-call per session turn.
 */
export function resolveEffectiveSkills(input: ResolveEffectiveSkillsInput): EffectiveSkill[] {
  const { userId, workspacePath, sessionId } = input;
  const key = normalizeWorkspacePathKey(workspacePath);
  const installed = readInstalledSkillsForUser(userId);
  const builtinIds = builtinSkillIdSet();

  let workspaceRows = readWorkspaceSelections(userId, key);
  let usedFallback = false;
  // The user has explicitly saved a configuration for *this* workspace path
  // — even if the resulting selection set is empty (i.e. all skills disabled).
  // Treat this as a hard signal: do NOT fall back to installed_skills, do NOT
  // try the __default__ key. Honor the user's explicit choice.
  let hasExplicitConfig = isWorkspaceConfigured(userId, key);

  // Try __default__ before giving up — but only if the path-specific tuple
  // is fully unconfigured. Once the user touches a path, they own it.
  if (workspaceRows.length === 0 && !hasExplicitConfig && key !== DEFAULT_WORKSPACE_PATH_KEY) {
    workspaceRows = readWorkspaceSelections(userId, DEFAULT_WORKSPACE_PATH_KEY);
    if (workspaceRows.length > 0 || isWorkspaceConfigured(userId, DEFAULT_WORKSPACE_PATH_KEY)) {
      hasExplicitConfig = true;
    }
  }

  // True fallback: never-configured user → use installed_skills.enabled.
  if (workspaceRows.length === 0 && !hasExplicitConfig) {
    usedFallback = true;
    workspaceRows = [];
    let fallbackPriority = 0;
    // Iterate installed in alphabetical skill_id order so the fallback set is
    // deterministic across server restarts. The Map preserves insertion
    // order, but the upstream query already orders by skill_id.
    for (const [skillId, row] of installed) {
      if (row.enabled !== 1) continue;
      if (builtinIds.has(skillId)) continue; // builtins re-added below
      workspaceRows.push({
        skill_id: skillId,
        enabled: 1,
        pinned: 0,
        reason: null,
        source: 'fallback',
        priority: fallbackPriority++,
      });
    }
  }

  const sessionOverrides = sessionId ? readSessionOverrides(sessionId) : new Map();

  const resolved = new Map<string, EffectiveSkill>();
  for (const row of workspaceRows) {
    // Hard-off: user-level uninstall/disable kills the row regardless of
    // selection state (unless the skill is builtin, in which case it's not
    // in installed_skills at all and we'll handle it below).
    const installedRow = installed.get(row.skill_id);
    if (installedRow && installedRow.enabled !== 1) {
      continue;
    }
    // Skip rows that are both workspace-enabled=0 AND have no session override
    // targeting them — no need to materialize disabled rows for consumers.
    const override = sessionOverrides.get(row.skill_id);
    if (row.enabled !== 1 && !override) {
      continue;
    }
    resolved.set(row.skill_id, {
      skillId: row.skill_id,
      enabled: row.enabled === 1,
      pinned: row.pinned === 1,
      origin: usedFallback ? 'workspace-fallback' : 'workspace',
      reason: row.reason ?? undefined,
      manifest: installedRow ? parseManifest(installedRow.manifest_json) : undefined,
    });
  }

  // Apply session overrides. Overrides may also introduce skills that are not
  // in the workspace selection (e.g. user temporarily enables a skill for this
  // session only) — those still require installed_skills.enabled=1 to matter.
  for (const [skillId, override] of sessionOverrides) {
    if (builtinIds.has(skillId)) continue; // builtins are non-overridable
    const installedRow = installed.get(skillId);
    if (!installedRow || installedRow.enabled !== 1) continue;
    const existing = resolved.get(skillId);
    resolved.set(skillId, {
      skillId,
      enabled: override.enabled === 1,
      pinned:
        override.pinned === null || override.pinned === undefined
          ? (existing?.pinned ?? false)
          : override.pinned === 1,
      origin: 'session-override',
      reason: existing?.reason,
      manifest: existing?.manifest ?? parseManifest(installedRow.manifest_json),
    });
  }

  // BUILTIN always appended at the end, never subject to selection filtering.
  const result: EffectiveSkill[] = [];
  for (const entry of resolved.values()) {
    if (builtinIds.has(entry.skillId)) continue; // defensive: do not double-emit
    result.push(entry);
  }
  result.push(...effectiveFromBuiltins());
  return result;
}
