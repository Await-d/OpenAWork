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

import { useState } from 'react';
import type { SessionTerminalStatus } from '@openAwork/shared';
import type { SessionTerminalView } from '../../pages/chat-page/terminals-api.js';
import { deleteSessionTerminal } from '../../pages/chat-page/terminals-api.js';

interface SessionTerminalsPanelProps {
  open: boolean;
  onClose: () => void;
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
  running: { fg: '#34d399', bg: 'color-mix(in srgb, #34d399 18%, transparent)', dot: '#34d399' },
  exited: {
    fg: 'var(--text-2)',
    bg: 'color-mix(in srgb, var(--text-3) 12%, transparent)',
    dot: 'var(--text-3)',
  },
  aborted: { fg: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 18%, transparent)', dot: '#f59e0b' },
  timeout: { fg: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 18%, transparent)', dot: '#f59e0b' },
  spawn_error: {
    fg: '#ef4444',
    bg: 'color-mix(in srgb, #ef4444 18%, transparent)',
    dot: '#ef4444',
  },
  killed: { fg: '#ef4444', bg: 'color-mix(in srgb, #ef4444 18%, transparent)', dot: '#ef4444' },
  stale: {
    fg: 'var(--text-3)',
    bg: 'color-mix(in srgb, var(--text-3) 10%, transparent)',
    dot: 'var(--text-3)',
  },
  'tmux-spawned': {
    fg: '#3b82f6',
    bg: 'color-mix(in srgb, #3b82f6 18%, transparent)',
    dot: '#3b82f6',
  },
  'tmux-killed': {
    fg: 'var(--text-3)',
    bg: 'color-mix(in srgb, var(--text-3) 10%, transparent)',
    dot: 'var(--text-3)',
  },
};

const ACTIVE_STATUSES = new Set<SessionTerminalStatus>(['running', 'tmux-spawned']);

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
}: {
  terminal: SessionTerminalView;
  pendingKill: boolean;
  onKill: () => void;
  onDelete: (() => Promise<void>) | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const isActive = ACTIVE_STATUSES.has(terminal.status);
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
          {terminal.command}
        </code>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          style={{
            fontSize: 11,
            border: '1px solid var(--border-subtle)',
            background: 'transparent',
            color: 'var(--text-2)',
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
              border: '1px solid color-mix(in srgb, #ef4444 50%, transparent)',
              background: 'color-mix(in srgb, #ef4444 14%, transparent)',
              color: '#ef4444',
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
              color: 'var(--text-3)',
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
          color: 'var(--text-3)',
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
        <pre
          style={{
            margin: 0,
            padding: '8px 10px',
            background: 'color-mix(in srgb, var(--surface) 60%, #000 30%)',
            color: '#dcdcdc',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            maxHeight: 240,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, monospace)',
            fontSize: 11.5,
            lineHeight: 1.4,
          }}
        >
          {terminal.outputTail || '(无输出)'}
        </pre>
      ) : null}
    </li>
  );
}

export function SessionTerminalsPanel({
  open,
  onClose,
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
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 4,
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: 'min(560px, calc(100vh - 96px))',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface)',
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
            background: 'var(--header-bg)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>会话终端</span>
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
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
                color: 'var(--text-2)',
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
                color: 'var(--text-3)',
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
              background: 'color-mix(in srgb, #ef4444 12%, transparent)',
              color: '#ef4444',
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
            background: 'var(--surface)',
          }}
        >
          {loading && terminals.length === 0 ? (
            <li
              style={{
                padding: 18,
                color: 'var(--text-3)',
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
                color: 'var(--text-3)',
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
                />
              ))}
            </>
          )}
        </ul>
      </div>
    </>
  );
}
