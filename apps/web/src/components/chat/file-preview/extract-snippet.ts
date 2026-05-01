/**
 * Pure helper used by the hover-preview popover to slice a 5-line
 * window out of a fetched file. Splitting this out from the hook
 * makes it trivially unit-testable without mocking fetch.
 *
 * Window rules:
 *   - With a target line: `target ± SNIPPET_RADIUS` lines, clamped
 *     to file bounds, and the target line returned in
 *     `highlightLine` so the renderer can visually mark it.
 *   - Without a target line: first `SNIPPET_DEFAULT_LEN` lines.
 *   - Empty file: a single empty line, no highlight.
 */

const SNIPPET_RADIUS = 2;
const SNIPPET_DEFAULT_LEN = 5;

export interface FileSnippet {
  /** 1-indexed first line in the snippet. */
  startLine: number;
  /** 1-indexed last line in the snippet (inclusive). */
  endLine: number;
  /** 1-indexed line to highlight, or null when no line was given. */
  highlightLine: number | null;
  /** Raw lines, length === endLine - startLine + 1. */
  lines: string[];
  /** Total line count of the source file (for "of N" footer hints). */
  totalLines: number;
}

/**
 * Extract a small window from `content` centred on `line` (or from
 * the top when `line` is null). Returns 1-indexed positions so the
 * UI can display "L42" matching what users see in editors.
 */
export function extractSnippet(content: string, line: number | null): FileSnippet {
  const all = content.length === 0 ? [''] : content.split(/\r?\n/);
  const total = all.length;

  if (line === null || !Number.isFinite(line) || line < 1) {
    const end = Math.min(SNIPPET_DEFAULT_LEN, total);
    return {
      startLine: 1,
      endLine: end,
      highlightLine: null,
      lines: all.slice(0, end),
      totalLines: total,
    };
  }

  const target = Math.min(Math.floor(line), total);
  const start = Math.max(1, target - SNIPPET_RADIUS);
  const end = Math.min(total, target + SNIPPET_RADIUS);
  return {
    startLine: start,
    endLine: end,
    highlightLine: target,
    lines: all.slice(start - 1, end),
    totalLines: total,
  };
}
