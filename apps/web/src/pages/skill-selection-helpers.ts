/**
 * Pure helpers shared by `SkillSelectionPage.tsx` for token estimation,
 * import/export of skill selection sets, and pinned-priority reordering.
 * Extracted so the byte-counting / JSON shape parsing / array reorder logic
 * can be unit-tested without a DOM.
 *
 * Token estimation mirrors the cap enforced server-side by
 * `pinned-skills-prompt.ts` (MAX_PINNED_SKILL_CHARS = 24000 ≈ 6k tokens at
 * ~4 chars/token). The frontend works with what `effective` returns
 * (`displayName`/`description`/`capabilities`) so the result is a rough
 * conservative estimate, not a tokenizer-accurate count.
 */

export interface PinnedRowSnapshot {
  skillId: string;
  displayName?: string;
  description?: string;
  capabilities?: string[];
  pinned: boolean;
  enabled: boolean;
  isBuiltin: boolean;
}

/** Same number used by `services/agent-gateway/src/pinned-skills-prompt.ts`. */
export const MAX_PINNED_SKILL_CHARS = 24000;
/** Conservative chars-per-token ratio used to surface a token estimate next to the char count. */
export const ESTIMATED_CHARS_PER_TOKEN = 4;

export interface PinnedTokenEstimate {
  totalChars: number;
  estimatedTokens: number;
  capChars: number;
  capTokens: number;
  /** Ratio in [0,∞). > 1.0 means we'd exceed the server-side cap and entries will be truncated. */
  ratio: number;
  pinnedCount: number;
}

/**
 * Build an estimate of how many characters / tokens the user's pinned-skill
 * prompt section will consume on the next session start. Mirrors the rough
 * shape of `renderSkillBlock` in `pinned-skills-prompt.ts` but uses only
 * the fields the frontend already has access to.
 */
export function estimatePinnedTokenUsage(rows: PinnedRowSnapshot[]): PinnedTokenEstimate {
  const pinned = rows.filter((row) => !row.isBuiltin && row.enabled && row.pinned);
  let total = 0;
  for (const row of pinned) {
    const title = (row.displayName ?? row.skillId).trim();
    const description = (row.description ?? '').trim();
    const capabilities = (row.capabilities ?? []).join(', ');
    // Approximate the rendered <skill_content> wrapper + content.
    total += title.length + description.length + capabilities.length + 64;
  }
  const ratio = total / MAX_PINNED_SKILL_CHARS;
  return {
    totalChars: total,
    estimatedTokens: Math.ceil(total / ESTIMATED_CHARS_PER_TOKEN),
    capChars: MAX_PINNED_SKILL_CHARS,
    capTokens: Math.ceil(MAX_PINNED_SKILL_CHARS / ESTIMATED_CHARS_PER_TOKEN),
    ratio,
    pinnedCount: pinned.length,
  };
}

// ---------------------------------------------------------------------------
// Import / Export JSON
// ---------------------------------------------------------------------------

export interface ExportableSelectionItem {
  skillId: string;
  enabled: boolean;
  pinned: boolean;
  reason?: string;
}

export interface ExportableSelectionDocument {
  version: 1;
  workspacePath: string | null;
  exportedAt: string;
  items: ExportableSelectionItem[];
}

/**
 * Serialize the current set of selectable rows into a versioned JSON document
 * that round-trips back through `parseImportedSelection`. BUILTIN and
 * orphaned-uninstalled rows are deliberately excluded — they aren't writable
 * through the PUT endpoint either.
 */
export function buildSelectionExport(input: {
  workspacePath: string | null;
  rows: Array<{
    skillId: string;
    enabled: boolean;
    pinned: boolean;
    reason?: string;
    isBuiltin: boolean;
    isInstalled: boolean;
  }>;
}): ExportableSelectionDocument {
  return {
    version: 1,
    workspacePath: input.workspacePath,
    exportedAt: new Date().toISOString(),
    items: input.rows
      .filter((row) => !row.isBuiltin && row.isInstalled)
      .map((row) => ({
        skillId: row.skillId,
        enabled: row.enabled,
        pinned: row.pinned,
        ...(row.reason ? { reason: row.reason } : {}),
      })),
  };
}

export interface ParsedImportResult {
  ok: true;
  workspacePath: string | null;
  items: ExportableSelectionItem[];
}

export interface ParsedImportError {
  ok: false;
  error: string;
}

// ---------------------------------------------------------------------------
// Pinned reordering
// ---------------------------------------------------------------------------

/**
 * Move the row identified by `fromSkillId` so it lands immediately before
 * the row identified by `toSkillId` in the supplied array. Used by the
 * Pinned group's drag-and-drop UX to flow priority changes through the
 * existing PUT (which writes priority by request items array index).
 *
 * Returns the input unchanged when either id is missing or when the source
 * and target are the same — keeps callers free of defensive checks.
 */
export function reorderRowsByMove<T extends { skillId: string }>(
  rows: readonly T[],
  fromSkillId: string,
  toSkillId: string,
): T[] {
  if (fromSkillId === toSkillId) return rows.slice();
  const fromIdx = rows.findIndex((row) => row.skillId === fromSkillId);
  const toIdx = rows.findIndex((row) => row.skillId === toSkillId);
  if (fromIdx < 0 || toIdx < 0) return rows.slice();
  const next = rows.slice();
  const [moved] = next.splice(fromIdx, 1);
  if (!moved) return rows.slice();
  // After splice, the target index shifts by one when the source was
  // earlier in the array — guard so the moved row lands *before* `toIdx`.
  const insertIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
  next.splice(insertIdx, 0, moved);
  return next;
}

/**
 * Parse and shape-validate a raw JSON string from the user's import dialog.
 * Returns a discriminated union so callers can show a precise reason for
 * rejected payloads instead of swallowing silently.
 */
export function parseImportedSelection(raw: string): ParsedImportResult | ParsedImportError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `JSON parse failed: ${err.message}` : 'JSON parse failed',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'expected a JSON object at the top level' };
  }
  const obj = parsed as Record<string, unknown>;
  if (obj['version'] !== 1) {
    return { ok: false, error: `unsupported version: ${String(obj['version'])}` };
  }
  if (!Array.isArray(obj['items'])) {
    return { ok: false, error: 'missing "items" array' };
  }
  const items: ExportableSelectionItem[] = [];
  for (const entry of obj['items']) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'items[*] must be objects' };
    }
    const row = entry as Record<string, unknown>;
    if (typeof row['skillId'] !== 'string' || row['skillId'].length === 0) {
      return { ok: false, error: 'items[*].skillId must be a non-empty string' };
    }
    if (typeof row['enabled'] !== 'boolean') {
      return { ok: false, error: 'items[*].enabled must be a boolean' };
    }
    if (typeof row['pinned'] !== 'boolean') {
      return { ok: false, error: 'items[*].pinned must be a boolean' };
    }
    items.push({
      skillId: row['skillId'],
      enabled: row['enabled'],
      pinned: row['pinned'],
      ...(typeof row['reason'] === 'string' ? { reason: row['reason'] } : {}),
    });
  }
  const workspacePath =
    typeof obj['workspacePath'] === 'string' || obj['workspacePath'] === null
      ? (obj['workspacePath'] as string | null)
      : null;
  return { ok: true, workspacePath, items };
}
