/**
 * Small chip button that lives in the ChatTopBar pill. Shows a terminal
 * icon and the count of currently-running terminals; clicking it
 * toggles the SessionTerminalsPanel popover.
 *
 * Layout: the wrapper is `position: relative` so the panel can render
 * directly below the chip without measuring offsets.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import { SessionTerminalsPanel } from './SessionTerminalsPanel.js';

interface SessionTerminalsChipProps {
  terminals: SessionTerminalView[];
  runningCount: number;
  loading: boolean;
  error: string | null;
  pendingKillIds: Set<string>;
  onKillTerminal: (terminalId: string) => Promise<void>;
  onReload: () => void;
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
}

export function SessionTerminalsChip(props: SessionTerminalsChipProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const hasAny = props.terminals.length > 0;

  const handleClose = useCallback(() => setOpen(false), []);

  // Close the popover on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, handleClose]);

  const activeIndicatorColor =
    props.runningCount > 0 ? 'var(--success))' : hasAny ? 'var(--fg-muted)' : 'var(--fg-muted)';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`会话终端：${props.runningCount} 个运行中`}
        onClick={() => setOpen((prev) => !prev)}
        title={
          props.runningCount > 0
            ? `${props.runningCount} 个终端正在运行 · 点击查看`
            : '会话终端：暂无运行中的命令'
        }
        style={{
          height: 26,
          padding: '0 8px',
          borderRadius: 5,
          border: 'none',
          background: open
            ? 'color-mix(in srgb, var(--success) 18%, var(--bg-overlay))'
            : 'transparent',
          color: props.runningCount > 0 ? 'var(--success))' : 'var(--fg-muted)',
          boxShadow: open
            ? 'inset 0 0 0 1px color-mix(in srgb, var(--success) 50%, var(--border-default))'
            : 'none',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        <svg
          aria-hidden="true"
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
        {props.runningCount > 0 ? (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: activeIndicatorColor,
              }}
            />
            <span>{props.runningCount}</span>
          </>
        ) : hasAny ? (
          <span style={{ fontSize: 10, fontWeight: 500 }}>{props.terminals.length}</span>
        ) : null}
      </button>
      <SessionTerminalsPanel
        open={open}
        onClose={handleClose}
        anchorRef={buttonRef}
        terminals={props.terminals}
        loading={props.loading}
        error={props.error}
        pendingKillIds={props.pendingKillIds}
        onKillTerminal={props.onKillTerminal}
        onReload={props.onReload}
        gatewayUrl={props.gatewayUrl}
        token={props.token}
        sessionId={props.sessionId}
      />
    </>
  );
}
