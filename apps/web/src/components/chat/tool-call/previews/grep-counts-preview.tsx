import { useMemo } from 'react';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

/* ── GrepCountsPreview (grep --count) ── */

export interface GrepCountEntry {
  path: string;
  count: number;
}

/**
 * Parse `grep` `output_mode='count'` payloads — one `path: count` per line.
 * Returns null unless every non-empty line matches.
 */
export function extractGrepCountsFromOutput(output: unknown): GrepCountEntry[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed || trimmed === 'No files found') return null;
  const lines = trimmed.split('\n');
  const entries: GrepCountEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(.+?):\s+(\d+)$/.exec(line);
    if (!m) return null;
    entries.push({ path: m[1] ?? '', count: Number(m[2]) });
  }
  return entries.length > 0 ? entries : null;
}

export function GrepCountsPreview({ entries }: { entries: GrepCountEntry[] }) {
  const total = entries.reduce((sum, e) => sum + e.count, 0);
  const commonPrefix = useMemo(
    () => computeCommonPathPrefix(entries.map((e) => e.path)),
    [entries],
  );
  return (
    <div className="grep-hits-preview">
      <div className="grep-hits-meta">
        <span className="grep-hits-summary">
          {total} 处匹配 · {entries.length} 个文件
        </span>
      </div>
      <PathPrefixBadge prefix={commonPrefix} />
      <div className="grep-hits-list">
        {entries.map((e) => (
          <div key={e.path} className="grep-counts-row">
            <span className="grep-counts-path">
              <StyledPath path={e.path} prefix={commonPrefix} />
            </span>
            <span className="grep-counts-num">{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
