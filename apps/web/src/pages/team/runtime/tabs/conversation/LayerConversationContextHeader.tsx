import type { CSSProperties, ReactNode } from 'react';
import { getRoleLayerIdentity } from '../../data/role-layer-identity.js';
import { CONVERSATION_BADGE_STYLE } from './conversation-shared-styles.js';

const HEADER_STYLE: CSSProperties = {
  display: 'grid',
  gap: 10,
  padding: '12px 14px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 76%, var(--bg-base))',
  flexShrink: 0,
};

const BADGE_ROW_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const INFO_GRID_STYLE: CSSProperties = {
  display: 'grid',
  gap: 6,
};

const CONTEXT_ROW_STYLE: CSSProperties = {
  display: 'grid',
  gap: 4,
  paddingTop: 6,
  borderTop: '1px solid color-mix(in srgb, var(--border-default) 18%, transparent)',
};

const CONTEXT_META_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const CONTEXT_TEXT_STYLE: CSSProperties = {
  fontSize: 11,
  color: 'var(--fg-default)',
  lineHeight: 1.5,
  minWidth: 0,
};

const SESSION_ID_STYLE: CSSProperties = {
  fontSize: 10,
  color: 'var(--fg-muted)',
  fontVariantNumeric: 'tabular-nums',
};

interface LayerConversationContextHeaderProps {
  actions?: ReactNode;
  fromRoleLayer?: string | null;
  fromSessionId?: string | null;
  fromSessionTitle?: string | null;
  modeBadge?: string | null;
  reuseBadge?: string | null;
  sessionId: string;
  sessionTitle?: string | null;
  title?: string | null;
  toRoleLayer?: string | null;
}

export function LayerConversationContextHeader({
  actions = null,
  fromRoleLayer = null,
  fromSessionId = null,
  fromSessionTitle = null,
  modeBadge = null,
  reuseBadge = null,
  sessionId,
  sessionTitle = null,
  title = null,
  toRoleLayer = null,
}: LayerConversationContextHeaderProps) {
  const fromIdentity = fromRoleLayer ? getRoleLayerIdentity(fromRoleLayer) : null;
  const toIdentity = toRoleLayer ? getRoleLayerIdentity(toRoleLayer) : null;

  return (
    <div style={HEADER_STYLE}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: 6, minWidth: 0, flex: 1 }}>
          <strong style={{ fontSize: 13, color: 'var(--fg-strong)' }}>
            {title?.trim() || '层级对话详情'}
          </strong>
          <div style={BADGE_ROW_STYLE}>
            {modeBadge ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--accent) 24%, transparent)',
                  background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                  color: 'var(--accent)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {modeBadge}
              </span>
            ) : null}
            {reuseBadge ? (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  border: '1px solid color-mix(in srgb, var(--warning) 24%, transparent)',
                  background: 'color-mix(in srgb, var(--warning) 10%, transparent)',
                  color: 'var(--warning)',
                  fontSize: 10,
                  fontWeight: 700,
                }}
              >
                {reuseBadge}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ flexShrink: 0 }}>{actions}</div>
      </div>
      <div style={INFO_GRID_STYLE}>
        {fromIdentity || fromSessionId ? (
          <div style={CONTEXT_ROW_STYLE}>
            <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>
              来源上下文
            </span>
            <div style={CONTEXT_META_STYLE}>
              {fromIdentity ? (
                <span style={CONVERSATION_BADGE_STYLE}>
                  {fromIdentity.icon} 来源 · {fromIdentity.label}
                </span>
              ) : null}
              {fromSessionId ? (
                <span style={CONTEXT_TEXT_STYLE} title={fromSessionTitle?.trim() || fromSessionId}>
                  {fromSessionTitle?.trim() || fromSessionId}
                </span>
              ) : null}
              {fromSessionId ? (
                <span style={SESSION_ID_STYLE}>session · {fromSessionId.slice(0, 8)}</span>
              ) : null}
            </div>
          </div>
        ) : null}
        <div style={CONTEXT_ROW_STYLE}>
          <span style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 700 }}>当前会话</span>
          <div style={CONTEXT_META_STYLE}>
            {toIdentity ? (
              <span style={CONVERSATION_BADGE_STYLE}>
                {toIdentity.icon} 当前 · {toIdentity.label}
              </span>
            ) : null}
            <span style={CONTEXT_TEXT_STYLE} title={sessionTitle?.trim() || sessionId}>
              {sessionTitle?.trim() || sessionId}
            </span>
            <span style={SESSION_ID_STYLE}>session · {sessionId.slice(0, 8)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
