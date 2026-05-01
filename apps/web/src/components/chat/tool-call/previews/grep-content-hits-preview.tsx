import { useMemo } from 'react';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

/* ── GrepContentHitsPreview (grep --content) ── */

export interface GrepContentHit {
  path: string;
  line: number;
  text: string;
}

/**
 * Parse `grep` `output_mode='content'` payloads — one match per line in
 * `path:line: text` shape. Returns null unless *every* non-empty line
 * matches that shape so the call site can fall through to other extractors
 * (e.g. file-path list, plain text) instead of mis-rendering.
 */
export function extractGrepContentHitsFromOutput(output: unknown): GrepContentHit[] | null {
  if (typeof output !== 'string') return null;
  const trimmed = output.trim();
  if (!trimmed || trimmed === 'No files found') return null;
  const lines = trimmed.split('\n');
  const hits: GrepContentHit[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) continue;
    const m = /^(.+?):(\d+):\s(.*)$/.exec(line);
    if (!m) return null;
    hits.push({ path: m[1] ?? '', line: Number(m[2]), text: m[3] ?? '' });
  }
  return hits.length > 0 ? hits : null;
}

/**
 * Render `grep --content` style hits grouped by file. Replaces the prior
 * `<pre>$path:$line: $text</pre>` flat dump with a scannable per-file list.
 */
export function GrepContentHitsPreview({ hits }: { hits: GrepContentHit[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, GrepContentHit[]>();
    for (const h of hits) {
      const list = map.get(h.path) ?? [];
      list.push(h);
      map.set(h.path, list);
    }
    return [...map.entries()];
  }, [hits]);

  const commonPrefix = useMemo(() => computeCommonPathPrefix(grouped.map(([p]) => p)), [grouped]);

  return (
    <div className="grep-hits-preview">
      <div className="grep-hits-meta">
        <span className="grep-hits-summary">
          {hits.length} 处匹配 · {grouped.length} 个文件
        </span>
      </div>
      <PathPrefixBadge prefix={commonPrefix} />
      <div className="grep-hits-list">
        {grouped.map(([path, items]) => (
          <div key={path} className="grep-hits-group">
            <div className="grep-hits-path">
              <StyledPath path={path} prefix={commonPrefix} />
            </div>
            {items.map((h) => (
              <div key={`${path}:${h.line}`} className="grep-hits-row">
                <span className="grep-hits-line">{h.line}</span>
                <span className="grep-hits-text">{h.text}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
