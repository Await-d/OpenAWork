/* ── session_info（会话详情卡） ── */

import type { SessionInfoView } from '../shared/session-text-view.js';

const MONO =
  'ui-monospace, SFMono-Regular, SFMono, Menlo, Monaco, Consolas, Liberation Mono, monospace';

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  color: 'var(--fg-muted)',
  flexShrink: 0,
};

const VALUE_STYLE: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.55,
  color: 'var(--fg-default)',
  minWidth: 0,
  wordBreak: 'break-word',
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
      <span style={{ ...LABEL_STYLE, width: 64 }}>{label}</span>
      <span style={VALUE_STYLE}>{value}</span>
    </div>
  );
}

export function SessionInfoPreview({ data }: { data: SessionInfoView }) {
  const rows: Array<[string, string]> = [
    ...(data.messageCount !== undefined
      ? ([['消息数', String(data.messageCount)]] as Array<[string, string]>)
      : []),
    ...(data.dateRange ? ([['时间范围', data.dateRange]] as Array<[string, string]>) : []),
    ...(data.todos ? ([['待办', data.todos]] as Array<[string, string]>) : []),
    ...(data.fileDiffs ? ([['文件变更', data.fileDiffs]] as Array<[string, string]>) : []),
    ...(data.snapshots ? ([['快照', data.snapshots]] as Array<[string, string]>) : []),
    ...(data.parentSession ? ([['父会话', data.parentSession]] as Array<[string, string]>) : []),
    ...(data.children ? ([['子会话', `${data.children} 个`]] as Array<[string, string]>) : []),
  ];

  return (
    <div
      data-testid="session-info-preview"
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            fontFamily: MONO,
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--fg-strong)',
            wordBreak: 'break-all',
          }}
        >
          {data.sessionId}
        </span>
        {data.status && (
          <span
            style={{
              flexShrink: 0,
              padding: '1px 6px',
              borderRadius: 999,
              fontSize: 10,
              color: 'var(--fg-muted)',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-default)',
            }}
          >
            {data.status}
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {rows.map(([label, value]) => (
            <InfoRow key={label} label={label} value={value} />
          ))}
        </div>
      )}

      {data.extra.length > 0 && (
        <details>
          <summary style={{ ...LABEL_STYLE, cursor: 'pointer' }}>
            更多（{data.extra.length}）
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {data.extra.map(([label, value]) => (
              <InfoRow key={label} label={label} value={value} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
