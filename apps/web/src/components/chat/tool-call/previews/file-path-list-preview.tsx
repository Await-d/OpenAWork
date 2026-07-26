import { useMemo, useState } from 'react';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

/* ── FilePathListPreview (grep files_with_matches / glob) ── */

/**
 * Heuristic: treat the output as a newline-separated list of file paths
 * (used by `grep` files_with_matches mode and `glob`). Bails out if any
 * line looks like a content/count row (path:line: text or path: count).
 */
export function extractFilePathListFromOutput(output: unknown): string[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed || trimmed === 'No files found' || trimmed === 'No files matching pattern')
    return null;
  const lines = trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  // Reject lines that smell like grep content/count rows.
  for (const line of lines) {
    if (/^.+?:\d+:\s/.test(line)) return null;
    if (/^.+?:\s+\d+$/.test(line)) return null;
  }
  return lines;
}

export function FilePathListPreview({
  paths,
  defaultExpanded = false,
}: {
  paths: string[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const VISIBLE = 30;
  const isLong = paths.length > VISIBLE;
  const visible = isLong && !expanded ? paths.slice(0, VISIBLE) : paths;
  // Hoist the shared root once so each row can drop the repeated prefix —
  // otherwise long monorepo paths spend ~70% of the row on identical text.
  const commonPrefix = useMemo(() => computeCommonPathPrefix(paths), [paths]);
  return (
    <div className="path-list-preview">
      <div className="grep-hits-meta">
        <span className="grep-hits-summary">{paths.length} 个文件</span>
      </div>
      <PathPrefixBadge prefix={commonPrefix} />
      <ul className="path-list">
        {visible.map((p) => (
          <li key={p} className="path-list-item">
            <StyledPath path={p} prefix={commonPrefix} />
          </li>
        ))}
      </ul>
      {isLong && (
        <button type="button" className="tool-output-toggle" onClick={() => setExpanded((v) => !v)}>
          {expanded ? '收起' : `显示全部 (${paths.length} 个)`}
        </button>
      )}
    </div>
  );
}
