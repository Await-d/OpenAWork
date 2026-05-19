import { useState, useRef } from 'react';
import type { CSSProperties } from 'react';

export type FileSearchMode = 'text' | 'filename' | 'symbol';

export interface FileSearchResult {
  path: string;
  line?: number;
  column?: number;
  snippet?: string;
  symbolKind?: string;
}

export interface FileSearchProps {
  onSearch: (query: string, mode: FileSearchMode) => Promise<FileSearchResult[]>;
  onResultClick?: (result: FileSearchResult) => void;
  style?: CSSProperties;
}

const MODE_LABELS: Record<FileSearchMode, string> = {
  text: '文本',
  filename: '文件',
  symbol: '符号',
};

export function FileSearch({ onSearch, onResultClick, style }: FileSearchProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<FileSearchMode>('text');
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void (async () => {
        setLoading(true);
        try {
          const res = await onSearch(value.trim(), mode);
          setResults(res);
        } finally {
          setLoading(false);
        }
      })();
    }, 300);
  }

  function handleModeChange(m: FileSearchMode) {
    setMode(m);
    setResults([]);
    if (query.trim()) {
      setLoading(true);
      void onSearch(query.trim(), m)
        .then(setResults)
        .finally(() => setLoading(false));
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['text', 'filename', 'symbol'] as FileSearchMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleModeChange(m)}
            style={{
              padding: '0.25rem 0.6rem',
              fontSize: 11,
              fontWeight: 600,
              border: '1px solid var(--border-default)',
              borderRadius: 4,
              cursor: 'pointer',
              background: mode === m ? 'var(--accent)' : 'transparent',
              color: mode === m ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={`搜索 ${MODE_LABELS[mode]}…`}
          style={{
            flex: 1,
            background: 'var(--bg-base, var(--bg-overlay))',
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            padding: '0.3rem 0.6rem',
            color: 'var(--fg-strong)',
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)', padding: '0.25rem 0' }}>搜索中…</div>
      )}

      {!loading && results.length > 0 && (
        <div
          style={{
            border: '1px solid var(--border-default)',
            borderRadius: 6,
            overflow: 'hidden',
            maxHeight: 240,
            overflowY: 'auto',
            background: 'var(--bg-overlay)',
          }}
        >
          {results.map((r, i) => (
            <button
              key={`${r.path}:${r.line ?? i}`}
              type="button"
              onClick={() => onResultClick?.(r)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                padding: '0.4rem 0.75rem',
                background: 'transparent',
                border: 'none',
                borderTop: i > 0 ? '1px solid var(--border-default, var(--border-subtle))' : 'none',
                cursor: 'pointer',
                width: '100%',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {r.symbolKind && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--accent)',
                      background:
                        'var(--accent-muted, color-mix(in srgb, var(--accent) 12%, transparent))',
                      padding: '1px 4px',
                      borderRadius: 3,
                    }}
                  >
                    {r.symbolKind}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontFamily: 'monospace',
                    color: 'var(--fg-strong)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.path.split('/').pop()}
                </span>
                {r.line !== undefined && (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--fg-muted)',
                      flexShrink: 0,
                    }}
                  >
                    L{r.line}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--fg-muted)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.snippet ?? r.path}
              </div>
            </button>
          ))}
        </div>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--fg-muted)' }}>暂无结果</div>
      )}
    </div>
  );
}
