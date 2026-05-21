/**
 * Session terminals panel — the popover that shows every bash /
 * background bash / tmux pseudo-terminal tracked for the current chat
 * session. Triggered from a chip in `ChatTopBar`.
 *
 * UX notes:
 *  - Active terminals (status `running` / `tmux-spawned`) sort to the
 *    top with a pulsing dot indicator.
 *  - Each row exposes an inline output preview (last 4KB) and a Kill
 *    button; closed rows expose a Delete button to clean up history.
 *  - Output is rendered in a mono font box with `white-space: pre-wrap`
 *    so wide log lines stay readable without horizontal scroll.
 */

import { useEffect, useState } from 'react';
import type { SessionTerminalStatus } from '@openAwork/shared';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  closeTerminal,
  deleteSessionTerminal,
} from '../../conversation-runtime/terminals/terminals-api.js';
import { InteractiveTerminalView } from './InteractiveTerminalView.js';

interface SessionTerminalsPanelProps {
  open: boolean;
  onClose: () => void;
  /**
   * 触发按钮的 ref。Panel 用 fixed 定位 + getBoundingClientRect 计算
   * 弹出位置,从而独立于父级 layout — 即使顶栏 chip 因为换行 / 压缩
   * 落在意外位置,popover 也始终贴在按钮下方且不会被父级 overflow:
   * hidden 截断。
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
  terminals: SessionTerminalView[];
  loading: boolean;
  error: string | null;
  pendingKillIds: Set<string>;
  onKillTerminal: (terminalId: string) => Promise<void>;
  onReload: () => void;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
}

const STATUS_LABELS: Record<SessionTerminalStatus, string> = {
  running: '运行中',
  idle: '空闲',
  exited: '已退出',
  aborted: '已取消',
  timeout: '超时',
  spawn_error: '启动失败',
  killed: '已终止',
  stale: '已失效',
  'tmux-spawned': 'tmux 在运行',
  'tmux-killed': 'tmux 已关闭',
};

const STATUS_COLORS: Record<SessionTerminalStatus, { fg: string; bg: string; dot: string }> = {
  running: {
    fg: 'var(--success)',
    bg: 'color-mix(in srgb, var(--success) 18%, transparent)',
    dot: 'var(--success)',
  },
  idle: {
    fg: 'var(--aux)',
    bg: 'color-mix(in srgb, var(--aux) 14%, transparent)',
    dot: 'var(--aux)',
  },
  exited: {
    fg: 'var(--fg-default)',
    bg: 'color-mix(in srgb, var(--fg-muted) 12%, transparent)',
    dot: 'var(--fg-muted)',
  },
  aborted: {
    fg: 'var(--warning)',
    bg: 'color-mix(in srgb, var(--warning) 18%, transparent)',
    dot: 'var(--warning)',
  },
  timeout: {
    fg: 'var(--warning)',
    bg: 'color-mix(in srgb, var(--warning) 18%, transparent)',
    dot: 'var(--warning)',
  },
  spawn_error: {
    fg: 'var(--danger)',
    bg: 'color-mix(in srgb, var(--danger) 18%, transparent)',
    dot: 'var(--danger)',
  },
  killed: {
    fg: 'var(--danger)',
    bg: 'color-mix(in srgb, var(--danger) 18%, transparent)',
    dot: 'var(--danger)',
  },
  stale: {
    fg: 'var(--fg-muted)',
    bg: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
    dot: 'var(--fg-muted)',
  },
  'tmux-spawned': {
    fg: 'var(--aux)',
    bg: 'color-mix(in srgb, var(--aux) 18%, transparent)',
    dot: 'var(--aux)',
  },
  'tmux-killed': {
    fg: 'var(--fg-muted)',
    bg: 'color-mix(in srgb, var(--fg-muted) 10%, transparent)',
    dot: 'var(--fg-muted)',
  },
};

const ACTIVE_STATUSES = new Set<SessionTerminalStatus>(['running', 'idle', 'tmux-spawned']);

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function formatDuration(startedAtMs: number, endedAtMs?: number): string {
  const end = endedAtMs ?? Date.now();
  const ms = Math.max(0, end - startedAtMs);
  if (ms < 1_000) return `${ms} ms`;
  const s = ms / 1_000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  const remainingS = Math.floor(s % 60);
  return `${m}m ${remainingS}s`;
}

function StatusBadge({ status }: { status: SessionTerminalStatus }) {
  const palette = STATUS_COLORS[status];
  const label = STATUS_LABELS[status] ?? status;
  const isActive = ACTIVE_STATUSES.has(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 9999,
        fontSize: 11,
        fontWeight: 600,
        color: palette.fg,
        background: palette.bg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: palette.dot,
          animation: isActive ? 'pulse 1.4s ease-in-out infinite' : undefined,
        }}
      />
      {label}
    </span>
  );
}

function TerminalRow({
  terminal,
  pendingKill,
  onKill,
  onDelete,
  gatewayUrl,
  token,
  sessionId,
  onClose,
}: {
  terminal: SessionTerminalView;
  pendingKill: boolean;
  onKill: () => void;
  onDelete: (() => Promise<void>) | null;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  onClose: (terminalId: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = ACTIVE_STATUSES.has(terminal.status);
  // Persistent terminals (kind 'foreground' from spawnPersistentTerminal)
  // can be typed into. We can't query the metadata flag from the public
  // payload, but we can rely on `toolName === 'quick_terminal'` for user
  // tabs and on a heuristic for agent persistent shells. For now treat
  // any active foreground terminal as input-capable; the backend gates
  // the actual stdin write and replies with `terminal_not_persistent`
  // for one-shot agent commands so the UI just silently no-ops.
  const inputEnabled = isActive && terminal.kind === 'foreground';
  return (
    <li
      style={{
        listStyle: 'none',
        padding: '10px 12px',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <StatusBadge status={terminal.status} />
        <code
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            fontSize: 12,
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
            color: 'var(--text-1)',
          }}
          title={terminal.command}
        >
          {terminal.name || terminal.description || terminal.command}
        </code>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            fontSize: 11,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--fg-default)',
            padding: '3px 8px',
            borderRadius: 5,
            cursor: 'pointer',
          }}
        >
          {expanded ? '收起' : '详情'}
        </button>
        {isActive ? (
          <button
            type="button"
            disabled={pendingKill}
            onClick={onKill}
            style={{
              fontSize: 11,
              border: '1px solid color-mix(in srgb, var(--danger) 50%, transparent)',
              background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
              color: 'var(--danger)',
              padding: '3px 8px',
              borderRadius: 5,
              cursor: pendingKill ? 'wait' : 'pointer',
              opacity: pendingKill ? 0.6 : 1,
            }}
          >
            {pendingKill ? '终止中…' : '终止'}
          </button>
        ) : onDelete ? (
          <button
            type="button"
            onClick={() => {
              void onDelete();
            }}
            style={{
              fontSize: 11,
              border: '1px solid var(--border-subtle)',
              background: 'transparent',
              color: 'var(--fg-muted)',
              padding: '3px 8px',
              borderRadius: 5,
              cursor: 'pointer',
            }}
          >
            清理
          </button>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          fontSize: 11,
          color: 'var(--fg-muted)',
        }}
      >
        <span title="工具">{terminal.toolName}</span>
        <span
          title="工作目录"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 280,
          }}
        >
          {terminal.cwd}
        </span>
        {terminal.pid !== undefined ? <span>pid {terminal.pid}</span> : null}
        <span>{formatDuration(terminal.startedAtMs, terminal.endedAtMs)}</span>
        {terminal.outputBytesTotal > 0 ? (
          <span>{formatBytes(terminal.outputBytesTotal)} 输出</span>
        ) : null}
        {terminal.exitCode !== undefined ? <span>exit {terminal.exitCode}</span> : null}
      </div>
      {expanded ? (
        <div
          style={{
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              height: 240,
              background: 'var(--bg-base)',
            }}
          >
            <InteractiveTerminalView
              gatewayUrl={gatewayUrl}
              token={token}
              sessionId={sessionId}
              terminal={terminal}
              inputEnabled={inputEnabled}
            />
          </div>
          {isActive && inputEnabled ? (
            <div
              style={{
                padding: '4px 10px',
                fontSize: 10.5,
                color: 'var(--fg-muted)',
                background: 'var(--bg-overlay)',
                borderTop: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>👆 直接输入命令并回车 · 完整 PTY 暂未支持(vim/top 等可能异常)</span>
              <button
                type="button"
                onClick={() => {
                  void onClose(terminal.terminalId);
                }}
                style={{
                  fontSize: 10.5,
                  border: '1px solid var(--border-subtle)',
                  background: 'transparent',
                  color: 'var(--fg-default)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                关闭终端
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function SessionTerminalsPanel({
  open,
  onClose,
  anchorRef,
  terminals,
  loading,
  error,
  pendingKillIds,
  onKillTerminal,
  onReload,
  gatewayUrl,
  token,
  sessionId,
}: SessionTerminalsPanelProps) {
  // Compute popover position from the anchor's viewport rect on every
  // open / window resize / scroll. Fixed positioning means parent
  // `overflow: hidden` and flex-wrap shenanigans no longer matter.
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => {
    if (!open || !anchorRef?.current) {
      setPosition(null);
      return;
    }
    const update = (): void => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef]);

  if (!open) return null;
  const active = terminals.filter((t) => ACTIVE_STATUSES.has(t.status));
  const closed = terminals.filter((t) => !ACTIVE_STATUSES.has(t.status));
  return (
    <>
      <button
        type="button"
        aria-label="关闭终端面板"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          border: 'none',
          padding: 0,
          margin: 0,
          zIndex: 998,
          cursor: 'default',
        }}
      />
      <div
        role="dialog"
        aria-label="会话终端"
        style={{
          // fixed 相对视口,绕开任何父级 overflow / wrap 影响。
          position: 'fixed',
          top: position?.top ?? 64,
          right: position?.right ?? 16,
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: 'min(560px, calc(100vh - 96px))',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-overlay)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 10,
          boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
          zIndex: 999,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            background: 'var(--bg-overlay)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>会话终端</span>
            <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
              {active.length} 个运行中 / 共 {terminals.length} 条记录
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={onReload}
              style={{
                fontSize: 11,
                border: '1px solid var(--border-subtle)',
                background: 'transparent',
                color: 'var(--fg-default)',
                padding: '3px 10px',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              刷新
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
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
        </div>
        {error ? (
          <div
            style={{
              padding: '8px 14px',
              background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
              color: 'var(--danger)',
              fontSize: 11,
            }}
          >
            {error}
          </div>
        ) : null}
        <ul
          style={{
            margin: 0,
            padding: 0,
            flex: 1,
            overflow: 'auto',
            background: 'var(--bg-overlay)',
          }}
        >
          {loading && terminals.length === 0 ? (
            <li
              style={{
                padding: 18,
                color: 'var(--fg-muted)',
                textAlign: 'center',
                listStyle: 'none',
              }}
            >
              正在加载…
            </li>
          ) : terminals.length === 0 ? (
            <li
              style={{
                padding: 18,
                color: 'var(--fg-muted)',
                textAlign: 'center',
                listStyle: 'none',
              }}
            >
              当前会话还没有跑过终端命令。
            </li>
          ) : (
            <>
              {active.map((terminal) => (
                <TerminalRow
                  key={terminal.terminalId}
                  terminal={terminal}
                  pendingKill={pendingKillIds.has(terminal.terminalId)}
                  onKill={() => {
                    void onKillTerminal(terminal.terminalId);
                  }}
                  onDelete={null}
                  gatewayUrl={gatewayUrl}
                  token={token}
                  sessionId={sessionId}
                  onClose={async (terminalId) => {
                    if (!sessionId || !token) return;
                    try {
                      await closeTerminal({
                        gatewayUrl,
                        sessionId,
                        terminalId,
                        token,
                      });
                    } catch {
                      /* surfaced via onReload */
                    }
                    onReload();
                  }}
                />
              ))}
              {closed.map((terminal) => (
                <TerminalRow
                  key={terminal.terminalId}
                  terminal={terminal}
                  pendingKill={false}
                  onKill={() => {
                    void onKillTerminal(terminal.terminalId);
                  }}
                  onDelete={
                    sessionId && token
                      ? async () => {
                          await deleteSessionTerminal({
                            gatewayUrl,
                            sessionId,
                            terminalId: terminal.terminalId,
                            token,
                          });
                          onReload();
                        }
                      : null
                  }
                  gatewayUrl={gatewayUrl}
                  token={token}
                  sessionId={sessionId}
                  onClose={async () => {
                    /* closed terminal — close button is hidden */
                  }}
                />
              ))}
            </>
          )}
        </ul>
      </div>
    </>
  );
}
