import type { CSSProperties, ReactNode } from 'react';
import { LayerConversationContextHeader } from './LayerConversationContextHeader.js';
import { useNarrowConversationLayout } from './use-narrow-conversation-layout.js';

const ROOT_STYLE: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const CONTENT_STYLE: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(220px, 0.3fr) minmax(0, 1fr)',
  overflow: 'hidden',
};

const SIDEBAR_STYLE: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  overflow: 'auto',
  borderRight: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 76%, var(--bg-base))',
};

const MAIN_STYLE: CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};

const COLLAPSED_BAR_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '10px 12px',
  borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
  background: 'color-mix(in srgb, var(--bg-overlay) 70%, var(--bg-base))',
  flexShrink: 0,
};

export interface LayerDetailWorkspaceProps {
  actions?: ReactNode;
  fromRoleLayer?: string | null;
  fromSessionId?: string | null;
  fromSessionTitle?: string | null;
  main: ReactNode;
  modeBadge?: string | null;
  reuseBadge?: string | null;
  sessionId: string;
  sessionTitle?: string | null;
  sidebar: ReactNode;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: (() => void) | null;
  title?: string | null;
  toRoleLayer?: string | null;
}

export function LayerDetailWorkspace({
  actions = null,
  fromRoleLayer = null,
  fromSessionId = null,
  fromSessionTitle = null,
  main,
  modeBadge = null,
  reuseBadge = null,
  sessionId,
  sessionTitle = null,
  sidebar,
  sidebarCollapsed = false,
  onExpandSidebar = null,
  title = null,
  toRoleLayer = null,
}: LayerDetailWorkspaceProps) {
  const isNarrowLayout = useNarrowConversationLayout();
  const contentStyle: CSSProperties = isNarrowLayout
    ? {
        ...CONTENT_STYLE,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'auto',
      }
    : CONTENT_STYLE;
  const sidebarStyle: CSSProperties = isNarrowLayout
    ? {
        ...SIDEBAR_STYLE,
        borderRight: 'none',
        borderBottom: '1px solid color-mix(in srgb, var(--border-default) 24%, transparent)',
        maxHeight: 280,
      }
    : SIDEBAR_STYLE;

  return (
    <div style={ROOT_STYLE}>
      <LayerConversationContextHeader
        actions={actions}
        fromRoleLayer={fromRoleLayer}
        fromSessionId={fromSessionId}
        fromSessionTitle={fromSessionTitle}
        modeBadge={modeBadge}
        reuseBadge={reuseBadge}
        sessionId={sessionId}
        sessionTitle={sessionTitle}
        title={title}
        toRoleLayer={toRoleLayer}
      />
      <div style={contentStyle}>
        {!sidebarCollapsed ? <div style={sidebarStyle}>{sidebar}</div> : null}
        <div style={MAIN_STYLE}>
          {sidebarCollapsed ? (
            <div style={COLLAPSED_BAR_STYLE}>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                摘要侧栏已折叠，可展开继续查看 handoff 摘要与产物。
              </span>
              {onExpandSidebar ? (
                <button
                  type="button"
                  onClick={onExpandSidebar}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-sm, 6px)',
                    border: '1px solid color-mix(in srgb, var(--accent) 32%, transparent)',
                    background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                    color: 'var(--accent)',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  展开摘要
                </button>
              ) : null}
            </div>
          ) : null}
          {main}
        </div>
      </div>
    </div>
  );
}
