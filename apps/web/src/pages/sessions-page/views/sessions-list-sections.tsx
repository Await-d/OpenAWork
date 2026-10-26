import React from 'react';

export function TopBar({
  totalCount,
  visibleCount,
  searchQuery,
  onSearchChange,
  onImport,
  onNew,
  onNewWithWorkspace,
}: {
  totalCount: number;
  visibleCount: number;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onImport: () => void;
  onNew: () => void;
  onNewWithWorkspace: () => void;
}) {
  const isFiltering = searchQuery.trim().length > 0;
  const countLabel = isFiltering ? `${visibleCount} / ${totalCount}` : `${totalCount}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0.75rem 1.25rem',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}
    >
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--fg-strong)',
          margin: 0,
          flexShrink: 0,
        }}
      >
        会话
      </h2>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          background: isFiltering ? 'var(--accent-muted)' : 'var(--bg-overlay)',
          color: isFiltering ? 'var(--accent)' : 'var(--fg-muted)',
          border: isFiltering ? 'none' : '1px solid var(--border-subtle)',
          borderRadius: 99,
          padding: '2px 9px',
          flexShrink: 0,
          minWidth: 20,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          transition: 'background 120ms ease, color 120ms ease',
        }}
        title={
          isFiltering ? `匹配 ${visibleCount} / 共 ${totalCount} 个会话` : `共 ${totalCount} 个会话`
        }
      >
        {countLabel}
      </span>
      <input
        type="text"
        placeholder="搜索会话…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="form-input"
        style={{
          flex: 1,
          height: 30,
          minWidth: 0,
        }}
      />
      <button type="button" onClick={onImport} className="btn-secondary" style={{ flexShrink: 0 }}>
        导入
      </button>
      <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onNew}
          style={{
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            borderRadius: '7px 0 0 7px',
            padding: '0 14px',
            height: 32,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 100ms ease',
          }}
        >
          + 新建会话
        </button>
        <button
          type="button"
          onClick={onNewWithWorkspace}
          title="选择工作区后新建会话"
          style={{
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            borderLeft: '1px solid var(--accent)',
            borderRadius: '0 7px 7px 0',
            padding: '0 8px',
            height: 32,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            transition: 'background 100ms ease',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function EmptyList({
  onNew,
  scope = 'all',
  onShowAll,
}: {
  onNew: () => void;
  scope?: 'all' | 'personal' | 'team';
  onShowAll?: () => void;
}) {
  const isTeamScope = scope === 'team';
  const headline =
    scope === 'team' ? '还没有团队会话' : scope === 'personal' ? '还没有个人对话' : '还没有会话';
  const hint = isTeamScope
    ? '团队对话从「团队」页面发起,完成后会出现在这里。'
    : '创建一个新会话开始与 Agent 对话';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '3.5rem 1.5rem',
        color: 'var(--fg-muted)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--accent-subtle)',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.6 }}
        >
          {isTeamScope ? (
            <>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>
          ) : (
            <>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 10h8M8 14h5" />
            </>
          )}
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-default)' }}>
          {headline}
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.5 }}>{hint}</span>
      </div>
      {!isTeamScope && (
        <button
          type="button"
          onClick={onNew}
          className="btn-accent"
          style={{ height: 32, padding: '0 16px', fontSize: 12 }}
        >
          新建会话
        </button>
      )}
      {onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className="btn-secondary"
          style={{ height: 28, padding: '0 12px', fontSize: 11 }}
        >
          查看全部会话
        </button>
      )}
    </div>
  );
}

export function EmptyDetail() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: 'var(--fg-muted)',
        background: 'var(--bg-overlay)',
        padding: 32,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: 'var(--accent-subtle)',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.6 }}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      </div>
      <div style={{ textAlign: 'center', maxWidth: 240 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-default)', marginBottom: 6 }}>
          选择一个会话
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          在左侧点击会话以查看详情、管理快照或继续对话
        </div>
      </div>
    </div>
  );
}

export function NoSearchMatches({
  searchQuery,
  onClearSearch,
}: {
  searchQuery: string;
  onClearSearch: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '2.5rem 1rem',
        color: 'var(--fg-muted)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--accent-subtle)',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.7 }}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
          没有匹配的会话
        </span>
        <span
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            maxWidth: 240,
          }}
        >
          搜索 “{searchQuery}” 未匹配到任何会话,可清除搜索后再试。
        </span>
      </div>
      <button
        type="button"
        onClick={onClearSearch}
        className="btn-secondary"
        style={{ height: 28, padding: '0 12px', fontSize: 11 }}
      >
        清除搜索
      </button>
    </div>
  );
}

const SCOPE_TAB_BAR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  flexShrink: 0,
};

const SCOPE_TAB_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
};

const SCOPE_TAB_BUTTON_ACTIVE_STYLE: React.CSSProperties = {
  ...SCOPE_TAB_BUTTON_STYLE,
  background: 'var(--accent-muted)',
  color: 'var(--accent)',
};

export function ScopeFilterTabs({
  scopeFilter,
  onScopeChange,
  personalCount,
  teamCount,
  teamReady,
  teamFailed,
}: {
  scopeFilter: 'all' | 'personal' | 'team';
  onScopeChange: (scope: 'all' | 'personal' | 'team') => void;
  personalCount: number;
  teamCount: number;
  teamReady: boolean;
  teamFailed: boolean;
}) {
  // Hide the team tab entirely when the team runtime fetch failed (user
  // doesn't have team access) and we observed zero team sessions. Loading
  // state still shows it so the layout doesn't shift after data arrives.
  const showTeamTab = !teamReady || teamFailed === false || teamCount > 0;

  return (
    <div role="tablist" aria-label="会话来源" style={SCOPE_TAB_BAR_STYLE}>
      <ScopeTabButton
        label="全部"
        active={scopeFilter === 'all'}
        count={personalCount + teamCount}
        onClick={() => onScopeChange('all')}
      />
      <ScopeTabButton
        label="个人"
        active={scopeFilter === 'personal'}
        count={personalCount}
        onClick={() => onScopeChange('personal')}
      />
      {showTeamTab && (
        <ScopeTabButton
          label="团队"
          active={scopeFilter === 'team'}
          count={teamCount}
          onClick={() => onScopeChange('team')}
          loading={!teamReady}
        />
      )}
    </div>
  );
}

function ScopeTabButton({
  label,
  active,
  count,
  onClick,
  loading = false,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={active ? SCOPE_TAB_BUTTON_ACTIVE_STYLE : SCOPE_TAB_BUTTON_STYLE}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: 99,
          background: active ? 'var(--accent)' : 'var(--bg-overlay)',
          color: active ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
          minWidth: 18,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {loading ? '…' : count}
      </span>
    </button>
  );
}

export function SessionScopeSection({
  kind,
  showHeader,
  collapsed,
  onToggleCollapsed,
  sessionCount,
  children,
}: {
  kind: 'personal' | 'team';
  showHeader: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionCount: number;
  children: React.ReactNode;
}) {
  if (!showHeader) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>;
  }

  const headerLabel = kind === 'team' ? '团队对话' : '个人对话';
  const headerHint = kind === 'team' ? '由团队发起的会话' : '你直接发起的会话';

  return (
    <section aria-label={headerLabel} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          margin: '0 -2px',
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            flexShrink: 0,
            color: 'var(--fg-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 140ms ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-default)',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {headerLabel}
        </span>
        <span
          aria-hidden="true"
          style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 500 }}
        >
          {headerHint}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 7px',
            borderRadius: 99,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sessionCount}
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
      )}
    </section>
  );
}
