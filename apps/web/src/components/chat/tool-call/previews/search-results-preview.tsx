import { useMemo } from 'react';
import { computeCommonPathPrefix, PathPrefixBadge, StyledPath } from '../shared/path-display.js';

/* ── workspace_search results preview (grep-style list) ── */

export interface SearchHit {
  path: string;
  line: number;
  text: string;
}

export interface SearchHitsBundle {
  hits: SearchHit[];
  query?: string;
  scanned?: number;
  skipped?: number;
}

export function extractSearchHitsFromOutput(output: unknown): SearchHitsBundle | null {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return null;
  const record = output as Record<string, unknown>;
  const results = record.results;
  if (!Array.isArray(results)) return null;
  const hits: SearchHit[] = [];
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const item = r as Record<string, unknown>;
    const path = typeof item.path === 'string' ? item.path : '';
    const line = typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : 0;
    const text = typeof item.text === 'string' ? item.text : '';
    if (path) hits.push({ path, line, text });
  }
  return {
    hits,
    query: typeof record.query === 'string' ? record.query : undefined,
    scanned: typeof record.scannedFiles === 'number' ? record.scannedFiles : undefined,
    skipped: typeof record.skippedLargeFiles === 'number' ? record.skippedLargeFiles : undefined,
  };
}

export function SearchResultsPreview({ data }: { data: SearchHitsBundle }) {
  const commonPrefix = useMemo(
    () => computeCommonPathPrefix(data.hits.map((h) => h.path)),
    [data.hits],
  );
  if (data.hits.length === 0) {
    return <div className="tool-call-inline-empty">（无匹配结果）</div>;
  }
  return (
    <div className="tool-call-search-results">
      <PathPrefixBadge prefix={commonPrefix} />
      {data.hits.map((hit, idx) => (
        <div key={`${hit.path}:${hit.line}:${idx}`} className="tool-call-search-row">
          <span className="tool-call-search-loc">
            <StyledPath className="tool-call-search-path" path={hit.path} prefix={commonPrefix} />
            <span className="tool-call-search-line">:{hit.line}</span>
          </span>
          <span className="tool-call-search-text">{hit.text}</span>
        </div>
      ))}
      {(data.scanned !== undefined || data.skipped !== undefined) && (
        <div className="tool-call-search-meta">
          {data.scanned !== undefined && <span>扫描 {data.scanned} 个文件</span>}
          {data.skipped !== undefined && data.skipped > 0 && (
            <span>· 跳过 {data.skipped} 个大文件</span>
          )}
        </div>
      )}
    </div>
  );
}
