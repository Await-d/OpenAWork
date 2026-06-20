import type { CSSProperties } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import type { HandoffEntry } from '../../../../../stores/team/team-events.js';
import {
  CONVERSATION_BADGE_STYLE,
  CONVERSATION_INFO_CARD_STYLE,
} from './conversation-shared-styles.js';

const STATE_LABELS: Record<string, string> = {
  idle: '空闲',
  pending: '等待中',
  claimed: '已认领',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const STATE_COLOR: Record<string, string> = {
  idle: 'var(--fg-muted)',
  pending: 'var(--warning)',
  claimed: 'var(--aux)',
  running: 'var(--success)',
  completed: 'var(--accent)',
  failed: 'var(--danger)',
  cancelled: 'var(--fg-muted)',
};

const BADGE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

export function LayerFlowHandoffHeader({
  entry,
  fromSessionTitle = null,
  toSessionTitle = null,
}: {
  entry: HandoffEntry;
  fromSessionTitle?: string | null;
  toSessionTitle?: string | null;
}) {
  const fromId = getRoleLayerIdentity(entry.fromRoleLayer);
  const toId = getRoleLayerIdentity(entry.toRoleLayer);
  const color = STATE_COLOR[entry.state] ?? 'var(--fg-muted)';

  return (
    <div
      style={{
        display: 'grid',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 40%, transparent)',
        background: `color-mix(in srgb, ${color} 6%, var(--bg-overlay))`,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg-strong)' }}>
          {fromId.icon} {fromId.label} → {toId.icon} {toId.label}
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 8px',
            borderRadius: 999,
            background: `color-mix(in srgb, ${color} 16%, transparent)`,
            color,
          }}
        >
          {STATE_LABELS[entry.state] ?? entry.state}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
          {new Date(entry.updatedAt).toLocaleString('zh-CN')}
        </span>
      </div>
      {entry.summary ? (
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--fg-default)', lineHeight: 1.55 }}>
          {entry.summary}
        </p>
      ) : null}
      <div
        style={{
          display: 'grid',
          gap: 8,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        {(fromSessionTitle || entry.fromSessionId) ? (
          <div style={CONVERSATION_INFO_CARD_STYLE}>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>来源会话</span>
            <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
              {(fromSessionTitle?.trim() || entry.fromSessionId || '').slice(0, 28)}
            </span>
            {entry.fromSessionId ? <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>from · {entry.fromSessionId.slice(0, 8)}</span> : null}
          </div>
        ) : null}
        {(toSessionTitle || entry.toSessionId) ? (
          <div style={CONVERSATION_INFO_CARD_STYLE}>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>目标会话</span>
            <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
              {(toSessionTitle?.trim() || entry.toSessionId || '').slice(0, 28)}
            </span>
            {entry.toSessionId ? <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>to · {entry.toSessionId.slice(0, 8)}</span> : null}
          </div>
        ) : null}
        <div style={CONVERSATION_INFO_CARD_STYLE}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>交接元信息</span>
          <span style={{ fontSize: 11, color: 'var(--fg-default)', lineHeight: 1.5 }}>
            {fromId.short} → {toId.short}
          </span>
          <div style={BADGE_ROW_STYLE}>
            {typeof entry.retryCount === 'number' && entry.retryCount > 0 ? (
              <span style={CONVERSATION_BADGE_STYLE}>retry · {entry.retryCount}</span>
            ) : null}
            {entry.paused ? <span style={CONVERSATION_BADGE_STYLE}>paused</span> : null}
            <span style={CONVERSATION_BADGE_STYLE}>handoff · {entry.id.slice(0, 8)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
