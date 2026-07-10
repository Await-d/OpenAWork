/**
 * dead-code-diagnostics — collect "this symbol is never used" hints
 * from the LSP servers running over the workspace and turn them into
 * a deterministic candidate list for the `/remove-deadcode` slash
 * command (T-DEAD-01/02, workflow 260509).
 *
 * Only diagnostics whose `code` matches a curated allowlist (TS6133
 * declared-but-never-read, F401 pyflakes unused-import, …) are
 * surfaced; anything else stays out of the candidate list. This is
 * the single guard rail that prevents the command from deleting
 * anything the LSP merely flagged as a warning ("variable shadow",
 * "deprecated API"). Heuristic / message-substring matching is
 * deliberately NOT used — we trust diagnostic codes only.
 *
 * Implementation note: we operate on the same `LSPManager.diagnostics()`
 * shape that `getPostWriteDiagnostics` already consumes, but extend
 * the per-entry projection to include `code` + `source` (those exist
 * in `DiagnosticSummary` but were dropped by the legacy projection).
 */

import { lspManager } from '../lsp/router.js';

/** Numeric / string LSP diagnostic codes that mean "definitely dead code". */
export const DEFAULT_DEAD_CODE_CODES: ReadonlySet<string | number> = new Set<string | number>([
  // TypeScript
  6133, // 'X' is declared but its value is never read
  6196, // 'X' is declared but never used
  6198, // All destructured elements are unused
  6199, // All variables are unused
  6205, // All type parameters are unused
  // Python (pyflakes / ruff)
  'F401', // imported but unused
  'F811', // redefinition of unused
  'F841', // assigned but never used
  // ESLint plugin: unused-imports
  'unused-imports/no-unused-imports',
  'unused-imports/no-unused-vars',
  // Generic ESLint
  'no-unused-vars',
  'no-unused-expressions',
  // Generic LSP-source-agnostic codes some servers emit
  'unused-import',
  'unused-variable',
]);

export interface DeadCodeCandidate {
  /** Absolute or LSP-reported file path. */
  file: string;
  /** 1-based line number to match the LSP summary projection. */
  line: number;
  /** 1-based column number. */
  col: number;
  /** Diagnostic message (human-readable). */
  message: string;
  /** Diagnostic code we matched against. */
  code: string | number;
  /** Source server / linter ID, e.g. `'typescript'`, `'ruff'`. */
  source?: string;
}

export interface CollectDeadCodeOptions {
  /**
   * Override the allowlist. Useful for tests and for users who want
   * to trim the curated set down (e.g. exclude `no-unused-vars`).
   */
  allowedCodes?: ReadonlySet<string | number>;
  /** Cap the result so a giant codebase does not flood the command card. */
  maxCandidates?: number;
  /**
   * Inject a custom diagnostics fetcher. Defaults to the singleton
   * `lspManager.diagnostics()` — tests stub this out so they don't
   * have to spin up real language servers.
   */
  fetchDiagnostics?: () => Promise<Record<string, DiagnosticLike[]>>;
}

/**
 * Subset of `DiagnosticSummary` we actually need. Kept structurally
 * loose so callers don't have to import from `@openAwork/lsp-client`.
 */
export interface DiagnosticLike {
  severity: 'error' | 'warning' | 'information' | 'hint';
  line: number;
  col: number;
  message: string;
  source?: string;
  code?: string | number;
}

const DEFAULT_MAX_CANDIDATES = 200;

export async function collectDeadCodeDiagnostics(
  options: CollectDeadCodeOptions = {},
): Promise<DeadCodeCandidate[]> {
  const allowedCodes = options.allowedCodes ?? DEFAULT_DEAD_CODE_CODES;
  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const fetchDiagnostics = options.fetchDiagnostics ?? lspManager.diagnostics.bind(lspManager);

  let raw: Record<string, DiagnosticLike[]>;
  try {
    raw = await fetchDiagnostics();
  } catch (err) {
    // Diagnostics is best-effort — a 500 from the LSP layer must not
    // crash the slash command. The executor falls back to a "no LSP
    // signal" message in that case.
    console.warn('[remove-deadcode] LSP diagnostics fetch failed —', String(err));
    return [];
  }

  const out: DeadCodeCandidate[] = [];
  for (const [file, summaries] of Object.entries(raw)) {
    if (!Array.isArray(summaries)) continue;
    for (const diag of summaries) {
      if (diag.code === undefined) continue;
      // Only `error` + `warning` are taken — informational / hint
      // entries can include "deprecated" suggestions that share
      // codes with dead-code rules in some linters.
      if (diag.severity !== 'error' && diag.severity !== 'warning') continue;
      if (!allowedCodes.has(diag.code)) continue;
      out.push({
        file,
        line: diag.line,
        col: diag.col,
        message: diag.message,
        code: diag.code,
        ...(diag.source ? { source: diag.source } : {}),
      });
      if (out.length >= maxCandidates) {
        return out;
      }
    }
  }
  // Stable order across runs is critical so the LLM's plan does not
  // shuffle on re-invoke. Sort by file then line then col.
  return out.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.col - b.col;
  });
}

/**
 * Render the candidate list as the YAML-ish block we inject into the
 * `/remove-deadcode` instruction. Format chosen for token-efficiency
 * + LLM-friendliness: easy to spot the file/line, easy to count, easy
 * to skip.
 */
export function formatDeadCodeCandidates(candidates: ReadonlyArray<DeadCodeCandidate>): string {
  if (candidates.length === 0) {
    return '（LSP 未报告任何匹配死代码诊断码的条目）';
  }
  const lines: string[] = [];
  lines.push(`# 共 ${candidates.length} 条 LSP 死代码候选`);
  let currentFile: string | null = null;
  for (const c of candidates) {
    if (c.file !== currentFile) {
      lines.push('');
      lines.push(`## ${c.file}`);
      currentFile = c.file;
    }
    const sourceTag = c.source ? `[${c.source}]` : '';
    lines.push(`- ${c.line}:${c.col} ${sourceTag}(${c.code}) ${c.message}`);
  }
  return lines.join('\n');
}
