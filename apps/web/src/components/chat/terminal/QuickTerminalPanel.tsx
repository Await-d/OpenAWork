/**
 * QuickTerminalPanel — VS Code 风格的底部终端抽屉。和
 * `useSessionTerminals` 共享同一个数据源,所以 agent 跑出来的终端
 * 在这里也会自动出现一个 tab,用户可以直接接管输入。
 *
 * 交互:
 *  - 顶部:tab 栏 + 新建按钮 + 调高度的拖把手 + 收起按钮
 *  - 内容:对应 tab 的 InteractiveTerminalView
 *  - 用户主动关闭面板 → 持久化 false,刷新后保持关闭
 *  - 用户开启面板 → 持久化 true,刷新后自动恢复 + 自动选中上次激活的 tab
 *  - 高度可拖动调整,持久化(全局共享)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import {
  closeTerminal,
  createSessionTerminal,
  type SessionTerminalView,
} from '../../conversation-runtime/terminals/terminals-api.js';
import { InteractiveTerminalView } from './InteractiveTerminalView.js';

interface QuickTerminalPanelProps {
  open: boolean;
  onRequestClose: () => void;
  presentation?: 'overlay' | 'inline';
  height?: number;
  onHeightChange?: (height: number) => void;
  workspacePath: string | null;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminals: SessionTerminalView[];
  loading: boolean;
  onReload: () => void;
  onRenameTerminal?: (terminalId: string, name: string | null) => Promise<void>;
  onDismissTerminal?: (terminalId: string) => void;
}

const ACTIVE_STATUSES = new Set(['running', 'idle', 'tmux-spawned']);

function shortLabel(term: SessionTerminalView, index: number): string {
  // User-defined name takes priority
  if (term.name && term.name.trim().length > 0) {
    return term.name.trim();
  }
  // Description from agent (e.g. "安装依赖") takes second priority
  if (term.description && term.description.trim().length > 0) {
    const desc = term.description.trim();
    return desc.length > 24 ? `${desc.slice(0, 22)}…` : desc;
  }
  if (term.toolName === 'quick_terminal') {
    return `终端 ${index + 1}`;
  }
  if (term.command && term.command.length > 0) {
    const trimmed = term.command.trim().split(/\s+/).slice(0, 3).join(' ');
    return trimmed.length > 24 ? `${trimmed.slice(0, 22)}…` : trimmed;
  }
  return `终端 ${index + 1}`;
}

export function QuickTerminalPanel(props: QuickTerminalPanelProps) {
  const {
    open,
    onRequestClose,
    presentation = 'overlay',
    height: controlledHeight,
    onHeightChange,
    workspacePath,
    gatewayUrl,
    token,
    sessionId,
    terminals,
    onReload,
    onRenameTerminal,
    onDismissTerminal,
  } = props;

  const quickTerminalHeight = useUIStateStore((s) => s.quickTerminalHeight);
  const setQuickTerminalHeight = useUIStateStore((s) => s.setQuickTerminalHeight);
  const activeIdByWs = useUIStateStore((s) => s.quickTerminalActiveIdByWorkspace);
  const setActiveIdForWs = useUIStateStore((s) => s.setQuickTerminalActiveIdForWorkspace);

  const wsKey = workspacePath && workspacePath.trim().length > 0 ? workspacePath : '__default__';
  const height = controlledHeight ?? quickTerminalHeight;
  const setHeight = onHeightChange ?? setQuickTerminalHeight;
  const inlinePresentation = presentation === 'inline';

  // Show only currently-live terminals as tabs; closed ones live in the
  // top-bar history popover (SessionTerminalsPanel) where the user can
  // delete them.
  const activeTerminals = useMemo(
    () => terminals.filter((t) => ACTIVE_STATUSES.has(t.status)),
    [terminals],
  );

  const persistedActiveId = activeIdByWs[wsKey] ?? null;
  const [pendingActive, setPendingActive] = useState<string | null>(null);

  // Reset the user's tab pick when the session or workspace changes —
  // a stale id from a different session would silently fall through to
  // the persisted/first-fallback path, but keeping it around is misleading.
  useEffect(() => {
    setPendingActive(null);
  }, [sessionId, wsKey]);

  // Resolve the actual active terminal: prefer the user's explicit pick
  // for this session, fall back to the persisted id if it's still alive,
  // otherwise the first active terminal.
  const activeId = useMemo(() => {
    if (pendingActive && activeTerminals.some((t) => t.terminalId === pendingActive)) {
      return pendingActive;
    }
    if (persistedActiveId && activeTerminals.some((t) => t.terminalId === persistedActiveId)) {
      return persistedActiveId;
    }
    return activeTerminals[0]?.terminalId ?? null;
  }, [pendingActive, persistedActiveId, activeTerminals]);

  // Persist the resolved active id so a refresh restores the same tab.
  useEffect(() => {
    if (!open) return;
    if (activeId !== persistedActiveId) {
      setActiveIdForWs(workspacePath, activeId);
    }
  }, [open, activeId, persistedActiveId, setActiveIdForWs, workspacePath]);

  const activeTerminal = useMemo(
    () => activeTerminals.find((t) => t.terminalId === activeId) ?? null,
    [activeTerminals, activeId],
  );

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!sessionId || !token || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createSessionTerminal({
        gatewayUrl,
        sessionId,
        token,
        ...(workspacePath ? { cwd: workspacePath } : {}),
      });
      setPendingActive(result.terminal.terminalId);
      setActiveIdForWs(workspacePath, result.terminal.terminalId);
      onReload();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : String(error));
    } finally {
      setCreating(false);
    }
  }, [creating, gatewayUrl, sessionId, token, workspacePath, onReload, setActiveIdForWs]);

  const handleCloseTab = useCallback(
    async (terminalId: string) => {
      if (!sessionId || !token) return;
      try {
        await closeTerminal({ gatewayUrl, sessionId, terminalId, token });
      } catch {
        /* ignore */
      } finally {
        if (terminalId === activeId) {
          // Drop persisted active so the next render falls back to the
          // first remaining active terminal.
          setActiveIdForWs(workspacePath, null);
          setPendingActive(null);
        }
        onReload();
      }
    },
    [activeId, gatewayUrl, sessionId, token, workspacePath, onReload, setActiveIdForWs],
  );

  // ─── Inline rename state ───
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const startRename = useCallback((terminalId: string, currentLabel: string) => {
    setRenamingId(terminalId);
    setRenameValue(currentLabel);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId && onRenameTerminal) {
      const trimmed = renameValue.trim();
      void onRenameTerminal(renamingId, trimmed.length > 0 ? trimmed : null);
    }
    setRenamingId(null);
    setRenameValue('');
  }, [renamingId, renameValue, onRenameTerminal]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue('');
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // ─── Auto-dismiss terminated terminals from tab bar ───
  // When a terminal exits, give a brief visual cue then remove it from
  // the active tab list so it doesn't clutter the UI.
  const prevTerminalsRef = useRef<SessionTerminalView[]>([]);
  useEffect(() => {
    const prev = prevTerminalsRef.current;
    prevTerminalsRef.current = terminals;
    if (!onDismissTerminal) return;
    // Find terminals that just transitioned from active to closed
    for (const term of terminals) {
      if (ACTIVE_STATUSES.has(term.status)) continue;
      const wasPreviouslyActive = prev.some(
        (p) => p.terminalId === term.terminalId && ACTIVE_STATUSES.has(p.status),
      );
      if (wasPreviouslyActive) {
        // Brief delay so the user sees the status change before removal
        const tid = term.terminalId;
        setTimeout(() => {
          onDismissTerminal(tid);
        }, 1500);
      }
    }
  }, [terminals, onDismissTerminal]);

  // Drag-resize handle. We track movement via mousemove on window and
  // translate it into a height delta from the bottom of the viewport.
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const onDragStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      dragRef.current = { startY: event.clientY, startHeight: height };
      const onMove = (e: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = dragRef.current.startY - e.clientY;
        const next = dragRef.current.startHeight + delta;
        setHeight(next);
      };
      const onUp = () => {
        dragRef.current = null;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [height, setHeight],
  );

  if (!open) return null;

  return (
    <div
      role="region"
      aria-label="快捷终端面板"
      style={{
        position: inlinePresentation ? 'relative' : 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height,
        minHeight: height,
        background: 'var(--bg-overlay)',
        borderTop: '1px solid var(--border-subtle)',
        boxShadow: inlinePresentation ? 'none' : 'var(--shadow-md)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        zIndex: inlinePresentation ? 1 : 35,
      }}
    >
      {/* Drag handle */}
      <button
        type="button"
        aria-label="拖动调整高度"
        onMouseDown={onDragStart}
        style={{
          position: 'absolute',
          top: -3,
          left: 0,
          right: 0,
          height: 6,
          padding: 0,
          margin: 0,
          border: 'none',
          background: 'transparent',
          cursor: 'ns-resize',
          zIndex: 1,
        }}
      />
      {/* Tabs row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderBottom: '1px solid var(--border-subtle)',
          background: 'var(--bg-overlay)',
          minHeight: 32,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            color: 'var(--fg-muted)',
            fontSize: 11,
            fontWeight: 600,
            paddingRight: 4,
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
          终端
        </span>
        <div
          style={{
            display: 'flex',
            gap: 2,
            flex: 1,
            minWidth: 0,
            overflowX: 'auto',
            scrollbarWidth: 'thin',
          }}
        >
          {activeTerminals.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--fg-muted)', padding: '4px 6px' }}>
              暂无运行中的终端 · 点击 ＋ 新建
            </span>
          ) : (
            activeTerminals.map((term, index) => {
              const isActive = term.terminalId === activeId;
              const label = shortLabel(term, index);
              const isRenaming = renamingId === term.terminalId;
              return (
                <div
                  key={term.terminalId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 4px 2px 8px',
                    borderRadius: 4,
                    background: isActive
                      ? 'color-mix(in srgb, var(--success) 14%, var(--bg-overlay))'
                      : 'transparent',
                    border: isActive
                      ? '1px solid color-mix(in srgb, var(--success) 50%, transparent)'
                      : '1px solid transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      style={{
                        border: '1px solid var(--border-subtle)',
                        background: 'var(--bg-base)',
                        color: 'var(--fg-default)',
                        fontSize: 11,
                        fontWeight: 500,
                        padding: '1px 4px',
                        borderRadius: 3,
                        width: 100,
                        outline: 'none',
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingActive(term.terminalId)}
                      onDoubleClick={() => startRename(term.terminalId, label)}
                      title={`${term.command} · ${term.cwd}\n双击重命名`}
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: isActive ? 'var(--success)' : 'var(--fg-default)',
                        fontSize: 11,
                        fontWeight: isActive ? 600 : 500,
                        cursor: 'pointer',
                        padding: 0,
                        maxWidth: 160,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="关闭终端"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleCloseTab(term.terminalId);
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--fg-muted)',
                      cursor: 'pointer',
                      fontSize: 14,
                      lineHeight: 1,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            void handleCreate();
          }}
          disabled={creating || !sessionId || !token}
          title="新建终端"
          style={{
            width: 24,
            height: 24,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--fg-default)',
            cursor: creating ? 'wait' : 'pointer',
            fontSize: 14,
            lineHeight: 1,
            borderRadius: 4,
            opacity: creating ? 0.6 : 1,
          }}
        >
          ＋
        </button>
        <button
          type="button"
          onClick={onRequestClose}
          aria-label="收起终端面板"
          style={{
            width: 24,
            height: 24,
            border: 'none',
            background: 'transparent',
            color: 'var(--fg-muted)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      {createError ? (
        <div
          style={{
            padding: '4px 10px',
            background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
            color: 'var(--danger)',
            fontSize: 11,
          }}
        >
          {createError}
        </div>
      ) : null}
      {/* Active terminal body */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {activeTerminal ? (
          <InteractiveTerminalView
            key={activeTerminal.terminalId}
            gatewayUrl={gatewayUrl}
            token={token}
            sessionId={sessionId}
            terminal={activeTerminal}
            inputEnabled={
              ACTIVE_STATUSES.has(activeTerminal.status) && activeTerminal.kind === 'foreground'
            }
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--fg-muted)',
              fontSize: 12,
              padding: 16,
              textAlign: 'center',
            }}
          >
            没有运行中的终端。点击右上角 ＋ 新建一个，或让 agent 跑一条 bash 命令。
          </div>
        )}
      </div>
    </div>
  );
}
