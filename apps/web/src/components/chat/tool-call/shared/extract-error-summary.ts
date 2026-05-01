/**
 * Pull a short, single-line error summary out of a failed tool call's
 * output for surfacing in the collapsed header. The full payload is
 * still available behind the "expand" chevron — this helper exists so
 * users see *what went wrong* without having to click first.
 *
 * Output shapes we accommodate (in priority order):
 *   1. `string` — first non-empty line.
 *   2. `{ error: string }` — the field as-is.
 *   3. `{ error: { message: string, … } }` — nested message.
 *   4. `{ message: string }` — top-level message.
 *   5. `{ stderr: string }` — first non-empty stderr line.
 *   6. `{ exitCode: number }` with non-zero — `exit N` fallback.
 *
 * Returns null when the call is not in error or no useful summary can
 * be extracted, so the caller can omit the banner entirely.
 */

const ERROR_CLAMP_LEN = 80;

export function extractErrorSummary(output: unknown, isError: boolean | undefined): string | null {
  // Only kick in when the call is actually flagged as failed. A call
  // with `isError: false` and no output should never display an
  // error summary, even if a stale object happens to expose `.error`.
  if (!isError) return null;

  if (typeof output === 'string') {
    const firstLine = firstNonEmptyLine(output);
    if (firstLine) return clamp(firstLine);
  }

  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;

    const err = obj.error;
    if (typeof err === 'string' && err.trim()) {
      return clamp(err.trim());
    }
    if (err && typeof err === 'object') {
      const nestedMessage = (err as Record<string, unknown>).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
        return clamp(nestedMessage.trim());
      }
    }

    if (typeof obj.message === 'string' && obj.message.trim()) {
      return clamp(obj.message.trim());
    }

    if (typeof obj.stderr === 'string') {
      const stderrLine = firstNonEmptyLine(obj.stderr);
      if (stderrLine) return clamp(stderrLine);
    }

    if (typeof obj.exitCode === 'number' && Number.isFinite(obj.exitCode) && obj.exitCode !== 0) {
      return `exit ${obj.exitCode}`;
    }
  }

  // `isError === true` but output didn't expose anything we
  // recognise — surface a generic label so the banner still
  // triggers and users know to drill into the raw output.
  return '执行失败';
}

function firstNonEmptyLine(text: string): string | null {
  if (!text) return null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function clamp(s: string): string {
  if (s.length <= ERROR_CLAMP_LEN) return s;
  return `${s.slice(0, ERROR_CLAMP_LEN - 1)}…`;
}
