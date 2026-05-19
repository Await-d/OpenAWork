/**
 * WorkspaceSwitcher · 团队工作区切换器（含工作区 CRUD 操作）
 *
 * 作为 page-header 顶部"团队 · {workspaceName}"的可点击 dropdown。
 * 选中后导航到 `/team/{newTeamWorkspaceId}`，URL 触发 `useTeamWorkspaceState`
 * 重新加载，会话列表自动过滤到新工作区。
 *
 * 功能：
 * - 当前工作区名称仍然可见（不依赖打开 dropdown 才能看到）
 * - 名称右侧有清晰的 ▾ 指示符提示可点击
 * - 切换是最小阻塞动作（点击列表项立即导航 + 关闭）
 * - 工作区行 hover 时显示 ⋯ 操作按钮（重命名 / 删除）
 * - 重命名：在 dropdown 行内 inline edit（Enter/blur 提交）
 * - 删除：触发上层弹出二次确认 modal（onRequestDelete）
 * - 末尾"+ 新建工作区"项
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
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
  /** 点击 "+ 新建工作区" 项的回调（不传则不渲染该项）。 */
  onCreateNew?: () => void;
  /** 重命名工作区。返回 false 表示失败（如重名）。 */
  onRename?: (workspaceId: string, newName: string) => Promise<boolean>;
  /** 请求删除工作区（由上层弹出二次确认 modal）。 */
  onRequestDelete?: (workspace: TeamWorkspaceSummary) => void;
}

const TRIGGER_BUTTON_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 6,
  border: '1px solid color-mix(in srgb, var(--border-default) 50%, transparent)',
  background: 'var(--bg-overlay)',
  color: 'var(--fg-default)',
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
  color: 'var(--fg-muted)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 200,
};

const POPOVER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  minWidth: 280,
  maxWidth: 360,
  maxHeight: 420,
  overflowY: 'auto',
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 10,
  boxShadow: '0 12px 32px color-mix(in srgb, #000 22%, transparent)',
  zIndex: 100,
  padding: '6px 0',
};

const POPOVER_HEADER_STYLE: CSSProperties = {
  padding: '6px 14px 4px',
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--fg-muted)',
};

const ROW_BASE_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-strong)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 120ms ease',
  position: 'relative',
};

const ROW_ACTIVE_STYLE: CSSProperties = {
  ...ROW_BASE_STYLE,
  background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
};

const CHECK_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  flexShrink: 0,
};

const ACTIONS_BTN_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  flexShrink: 0,
  border: 'none',
  borderRadius: 4,
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
};

const SUBMENU_STYLE: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 'calc(100% + 2px)',
  minWidth: 160,
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border-default)',
  borderRadius: 8,
  boxShadow: '0 8px 24px color-mix(in srgb, #000 22%, transparent)',
  padding: '4px 0',
  zIndex: 101,
};

const SUBMENU_ITEM_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '7px 12px',
  border: 'none',
  background: 'transparent',
  color: 'var(--fg-strong)',
  fontSize: 12,
  textAlign: 'left',
  cursor: 'pointer',
};

const RENAME_INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '4px 8px',
  border: '1px solid var(--accent)',
  borderRadius: 6,
  background: 'var(--bg-overlay)',
  color: 'var(--fg-strong)',
  fontSize: 12,
  outline: 'none',
};

export function WorkspaceSwitcher({
  workspaces,
  activeWorkspaceId,
  onSelect,
  loading,
  onCreateNew,
  onRename,
  onRequestDelete,
}: WorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [submenuId, setSubmenuId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeWorkspace = workspaces.find((ws) => ws.id === activeWorkspaceId) ?? null;
  const displayName = activeWorkspace?.name ?? '未选择工作区';

  // 点击外部关闭
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSubmenuId(null);
        setRenameId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSelect = useCallback(
    (id: string) => {
      if (renameId === id) return;
      setOpen(false);
      setSubmenuId(null);
      if (id !== activeWorkspaceId) {
        onSelect(id);
      }
    },
    [activeWorkspaceId, onSelect, renameId],
  );

  const startRename = useCallback((ws: TeamWorkspaceSummary) => {
    setRenameId(ws.id);
    setRenameValue(ws.name);
    setRenameError(null);
    setSubmenuId(null);
  }, []);

  const cancelRename = useCallback(() => {
    setRenameId(null);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback(
    async (workspace: TeamWorkspaceSummary) => {
      if (!onRename) {
        cancelRename();
        return;
      }
      const next = renameValue.trim();
      if (!next) {
        setRenameError('名称不能为空');
        return;
      }
      if (next === workspace.name) {
        cancelRename();
        return;
      }
      // 重名校验（trim + 不区分大小写）
      const lower = next.toLowerCase();
      const duplicate = workspaces.find(
        (ws) => ws.id !== workspace.id && ws.name.trim().toLowerCase() === lower,
      );
      if (duplicate) {
        setRenameError(`名称「${next}」已存在`);
        return;
      }
      setRenameSubmitting(true);
      try {
        const ok = await onRename(workspace.id, next);
        if (!ok) {
          setRenameError('重命名失败，请重试');
          return;
        }
        cancelRename();
      } finally {
        setRenameSubmitting(false);
      }
    },
    [cancelRename, onRename, renameValue, workspaces],
  );

  const handleRenameKey = useCallback(
    (event: KeyboardEvent<HTMLInputElement>, workspace: TeamWorkspaceSummary) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void submitRename(workspace);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelRename();
      }
    },
    [cancelRename, submitRename],
  );

  // 只有一个工作区或没有时仍允许创建（如果传了 onCreateNew 才显示 dropdown）
  if (workspaces.length <= 1 && !onCreateNew) {
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
          {workspaces.length > 0 ? <div style={POPOVER_HEADER_STYLE}>切换到工作区</div> : null}
          {workspaces.map((ws) => {
            const active = ws.id === activeWorkspaceId;
            const isRenaming = renameId === ws.id;
            const isHovered = hoveredId === ws.id || submenuId === ws.id;
            const showActions = (onRename || onRequestDelete) && (isHovered || submenuId === ws.id);

            return (
              <div
                key={ws.id}
                style={active ? ROW_ACTIVE_STYLE : ROW_BASE_STYLE}
                onMouseEnter={() => setHoveredId(ws.id)}
                onMouseLeave={() => {
                  setHoveredId((cur) => (cur === ws.id ? null : cur));
                }}
              >
                {/* 选中勾 */}
                {active ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--accent)"
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

                {/* 主体（点击切换 / inline 编辑） */}
                {isRenaming ? (
                  <div style={{ flex: 1, display: 'grid', gap: 4, minWidth: 0 }}>
                    <input
                      type="text"
                      value={renameValue}
                      autoFocus
                      disabled={renameSubmitting}
                      onChange={(e) => {
                        setRenameValue(e.target.value);
                        if (renameError) setRenameError(null);
                      }}
                      onKeyDown={(e) => handleRenameKey(e, ws)}
                      onBlur={() => {
                        // 异步：让 click 事件优先（如果是点击别处取消）
                        window.setTimeout(() => {
                          if (renameId === ws.id && !renameSubmitting) {
                            void submitRename(ws);
                          }
                        }, 100);
                      }}
                      style={RENAME_INPUT_STYLE}
                      aria-label="工作区新名称"
                    />
                    {renameError ? (
                      <span style={{ fontSize: 10, color: 'var(--error)' }}>{renameError}</span>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--fg-muted)' }}>
                        Enter 保存 / Esc 取消
                      </span>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleSelect(ws.id)}
                    role="option"
                    aria-selected={active}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      color: active ? 'var(--accent)' : 'var(--fg-strong)',
                      fontWeight: active ? 600 : 400,
                      cursor: 'pointer',
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                    title={ws.name}
                  >
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 12,
                      }}
                    >
                      {ws.name}
                    </span>
                    {ws.defaultWorkingRoot ? (
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--fg-muted)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, monospace, Consolas, "Liberation Mono"',
                        }}
                      >
                        {ws.defaultWorkingRoot}
                      </span>
                    ) : null}
                  </button>
                )}

                {/* hover 操作按钮 */}
                {showActions && !isRenaming ? (
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSubmenuId((cur) => (cur === ws.id ? null : ws.id));
                      }}
                      className="team-icon-ghost"
                      style={ACTIONS_BTN_STYLE}
                      aria-label={`管理 ${ws.name}`}
                      title="管理"
                    >
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <circle cx="5" cy="12" r="1.6" />
                        <circle cx="12" cy="12" r="1.6" />
                        <circle cx="19" cy="12" r="1.6" />
                      </svg>
                    </button>
                    {submenuId === ws.id ? (
                      <div role="menu" aria-label="工作区操作" style={SUBMENU_STYLE}>
                        {onRename ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(ws);
                            }}
                            className="team-menu-item"
                            style={SUBMENU_ITEM_STYLE}
                          >
                            <svg
                              aria-hidden="true"
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 20h9" />
                              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>重命名</span>
                          </button>
                        ) : null}
                        {onRequestDelete ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSubmenuId(null);
                              setOpen(false);
                              onRequestDelete(ws);
                            }}
                            className="team-menu-item"
                            data-tone="danger"
                            style={{
                              ...SUBMENU_ITEM_STYLE,
                              color: 'var(--error)',
                            }}
                          >
                            <svg
                              aria-hidden="true"
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6l-2 14H7L5 6" />
                              <path d="M10 11v6M14 11v6" />
                              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                            </svg>
                            <span>删除工作区</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          {onCreateNew ? (
            <>
              {workspaces.length > 0 ? (
                <div
                  role="separator"
                  style={{
                    height: 1,
                    background: 'color-mix(in srgb, var(--border-default) 50%, transparent)',
                    margin: '4px 0',
                  }}
                />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="team-menu-item"
                style={{
                  ...ROW_BASE_STYLE,
                  color: 'var(--accent)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
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
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span style={{ flex: 1 }}>新建工作区</span>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
