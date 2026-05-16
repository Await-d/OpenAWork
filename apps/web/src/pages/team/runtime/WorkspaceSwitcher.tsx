/**
 * WorkspaceSwitcher · 团队工作区切换器
 *
 * 作为 page-header 顶部"团队 · {workspaceName}"的可点击 dropdown。
 * 选中后导航到 `/team/{newTeamWorkspaceId}`，URL 触发 `useTeamWorkspaceState`
 * 重新加载，会话列表自动过滤到新工作区。
 *
 * 设计原则：
 * - 当前工作区名称仍然可见（不依赖打开 dropdown 才能看到）
 * - 名称右侧有清晰的 ▾ 指示符提示可点击
 * - 工作区只有一个时只显示文字（不渲染 dropdown）
 * - 切换是最小阻塞动作（点击列表项立即导航 + 关闭）
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { TeamWorkspaceSummary } from '@openAwork/web-client';

export interface WorkspaceSwitcherProps {
  /** 全部可用工作区列表（来自 useTeamWorkspaceState.workspaces）。 */
  workspaces: TeamWorkspaceSummary[];
  /** 当前激活的工作区。 */
  activeWorkspaceId: string | null;
  /** 切换回调。父级用 `navigate('/team/${id}')`。 */
  onSelect: (workspaceId: string) => void;
  /** loading 时禁用切换。 */
  loading?: boolean;
}

const TRIGGER_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
  background: 'color-mix(in srgb, var(--surface) 80%, transparent)',
  color: 'var(--text-2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 200,
  transition: 'border-color 150ms ease, background 150ms ease',
};

const TRIGGER_BUTTON_DISABLED_STYLE: CSSProperties = {
  ...TRIGGER_BUTTON_STYLE,
  opacity: 0.6,
  cursor: 'not-allowed',
};

const STATIC_LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  color: 'var(--text-3)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 200,
};

const POPOVER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  minWidth: 220,
  maxWidth: 320,
  maxHeight: 360,
  overflowY: 'auto',
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  boxShadow: '0 8px 24px color-mix(in srgb, #000 18%, transparent)',
  zIndex: 100,
  padding: '4px 0',
};

const POPOVER_HEADER_STYLE: CSSProperties = {
  padding: '6px 14px 4px',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-3)',
};

const ITEM_BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 120ms ease',
};

const ITEM_ACTIVE_STYLE: CSSProperties = {
  ...ITEM_BASE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
  color: 'var(--accent)',
  fontWeight: 600,
};

const CHECK_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
};

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  loading,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) ?? null;
  const displayName = activeWorkspace?.name ?? '未选择工作区';

  // 点击外部关闭
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback(
    (id: string) => {
      setOpen(false);
      if (id !== activeWorkspaceId) {
        onSelect(id);
      }
    },
    [activeWorkspaceId, onSelect],
  );

  // 只有一个工作区或没有时不渲染 dropdown，仅显示文字
  if (workspaces.length <= 1) {
    return (
      <span style={STATIC_LABEL_STYLE} title={displayName}>
        · {displayName}
      </span>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        disabled={loading}
        onClick={() => setOpen((v) => !v)}
        style={loading ? TRIGGER_BUTTON_DISABLED_STYLE : TRIGGER_BUTTON_STYLE}
        title={displayName}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 150ms ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open ? (
        <div role="listbox" aria-label="切换工作区" style={POPOVER_STYLE}>
          <div style={POPOVER_HEADER_STYLE}>切换到工作区</div>
          {workspaces.map((ws) => {
            const active = ws.id === activeWorkspaceId;
            return (
              <button
                key={ws.id}
                type="button"
                onClick={() => handleSelect(ws.id)}
                role="option"
                aria-selected={active}
                style={active ? ITEM_ACTIVE_STYLE : ITEM_BASE_STYLE}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background =
                      'color-mix(in srgb, var(--text-3) 8%, transparent)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {active ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={CHECK_STYLE}
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span style={CHECK_STYLE} aria-hidden="true" />
                )}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={ws.name}
                >
                  {ws.name}
                </span>
                {ws.visibility !== 'private' ? (
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      flexShrink: 0,
                      padding: '1px 5px',
                      borderRadius: 4,
                      border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                    }}
                  >
                    {ws.visibility}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
