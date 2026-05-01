/**
 * Small status badge used by web tools (webfetch / websearch / google_search)
 * to show whether the call returned results, came back empty, or errored.
 */
export type SearchVisualState = 'found' | 'empty' | 'error';

export function SearchStateBadge({ state }: { state: SearchVisualState }) {
  const labels: Record<SearchVisualState, string> = {
    found: '✓ 已找到',
    empty: '∅ 无结果',
    error: '✗ 错误',
  };
  return <span className={`tool-search-badge tool-search-badge-${state}`}>{labels[state]}</span>;
}
