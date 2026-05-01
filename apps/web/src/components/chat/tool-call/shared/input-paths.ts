/**
 * Helpers for extracting / trimming file-path-shaped values out of
 * heterogeneous tool input objects. Used by both the inline summary line
 * and the block card title bar.
 */

export function trimPath(value: string): string {
  const segments = value.replace(/\\/g, '/').split('/').filter(Boolean);
  return segments.length > 4 ? `…/${segments.slice(-3).join('/')}` : segments.join('/');
}

export function extractFilePath(input: Record<string, unknown>): string | undefined {
  const raw = input.filePath ?? input.file_path ?? input.path ?? input.file;
  return typeof raw === 'string' && raw.trim() ? trimPath(raw) : undefined;
}

/**
 * Truncate a free-form string to fit a header pill while preserving
 * leading/trailing whitespace cleanly. Ellipsis is U+2026, never "..." so
 * we don't accidentally produce something that looks like a path segment.
 */
export function clampString(value: string, maxLen: number): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLen - 1))}…`;
}
