/**
 * Format an elapsed millisecond duration into a compact "Nms" / "N.Ns"
 * string suitable for inline tool-call timing badges.
 *
 * Rules:
 *   - <1000ms: integer milliseconds (`750ms`)
 *   - <10s: one-decimal seconds (`3.4s`)
 *   - ≥10s: rounded integer seconds (`14s`)
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}
