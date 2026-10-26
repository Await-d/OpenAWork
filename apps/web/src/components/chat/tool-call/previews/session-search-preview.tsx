/* ── session_search（消息匹配列表） ── */

import type { SessionSearchHit } from '../shared/session-search-view.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

const ROLE_LABELS: Readonly<Record<string, string>> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
};

const MAX_ROWS = 30;

export function SessionSearchPreview({ hits }: { hits: readonly SessionSearchHit[] }) {
  if (hits.length === 0) {
    return <div className="tool-call-inline-empty">（没有匹配到消息）</div>;
  }

  const visible = hits.slice(0, MAX_ROWS);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>找到 {hits.length} 条匹配</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map((hit, index) => (
          <div
            key={`${hit.sessionId}:${hit.messageId}:${index}`}
            data-session-search-hit={index}
            style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: '0 6px',
                minWidth: 0,
                fontSize: 10.5,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  padding: '0 5px',
                  borderRadius: 999,
                  background: 'var(--bg-overlay)',
                  border: '1px solid var(--border-default)',
                  color: 'var(--fg-muted)',
                }}
              >
                {ROLE_LABELS[hit.role.toLowerCase()] ?? hit.role}
              </span>
              <span style={{ fontFamily: MONO, color: 'var(--fg-subtle)', wordBreak: 'break-all' }}>
                {hit.sessionId}
              </span>
              <span style={{ fontFamily: MONO, color: 'var(--fg-subtle)' }}>· {hit.messageId}</span>
            </div>
            <div
              style={{
                fontSize: 11,
                lineHeight: 1.55,
                color: 'var(--fg-default)',
                wordBreak: 'break-word',
              }}
            >
              {hit.snippet}
            </div>
          </div>
        ))}
      </div>

      {hits.length > visible.length && (
        <div style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          还有 {hits.length - visible.length} 条未展示…
        </div>
      )}
    </div>
  );
}
