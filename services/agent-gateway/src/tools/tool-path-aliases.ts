/**
 * Canonical `path` / `filePath` / `file_path` resolution for gateway file tools.
 *
 * Every layer that extracts a filesystem path from raw tool input must go
 * through this module so validation and execution can never disagree about
 * which field wins. Precedence: `path` -> `filePath` -> `file_path`.
 */

const TOOL_PATH_INPUT_KEYS = ['path', 'filePath', 'file_path'] as const;

/** Resolve the first non-blank path field, or undefined when none is usable. */
export function readToolPathInput(raw: Record<string, unknown>): string | undefined {
  for (const key of TOOL_PATH_INPUT_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Resolve the path field or throw when the caller supplied none. */
export function pickToolPathInput(raw: Record<string, unknown>): string {
  const value = readToolPathInput(raw);
  if (!value) {
    throw new Error('Either path or filePath is required');
  }
  return value;
}
