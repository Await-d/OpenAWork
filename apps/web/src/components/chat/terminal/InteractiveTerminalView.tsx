/**
 * InteractiveTerminalView — embeds an `xterm.js` instance bound to a
 * single backend terminal (persistent or one-shot). Wires:
 *
 *  - SSE `/sessions/:sid/terminals/:tid/stream` → `term.write()`
 *  - `term.onData()` → POST `/stdin` for persistent terminals;
 *    for non-persistent (e.g. agent's bash run) the input is silently
 *    dropped and a status hint is shown.
 *  - FitAddon resizes on container resize and posts `/resize`.
 *
 * The component is presentational: it does not own the terminal record
 * (parent passes `terminal` from `useSessionTerminals`). On unmount or
 * `terminalId` change it disposes the xterm instance and closes the SSE.
 */

import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { SessionTerminalView } from '../../conversation-runtime/terminals/terminals-api.js';
import {
  openTerminalStream,
  resizeTerminal,
  writeTerminalStdin,
} from '../../conversation-runtime/terminals/terminals-api.js';

interface InteractiveTerminalViewProps {
  gatewayUrl: string;
  token: string | null;
  sessionId: string | null;
  terminal: SessionTerminalView;
  /** Whether the user can type into this terminal (persistent terminals only). */
  inputEnabled: boolean;
}

export function InteractiveTerminalView({
  gatewayUrl,
  token,
  sessionId,
  terminal,
  inputEnabled,
}: InteractiveTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const lastEmittedBytesRef = useRef<number>(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Keep a ref so the keystroke handler always sees the latest enabled flag.
  const enabledRef = useRef(inputEnabled);
  enabledRef.current = inputEnabled;

  useEffect(() => {
    if (!containerRef.current || !sessionId || !token) return;
    // Defensive: skip mounting if the terminal record's sessionId
    // doesn't match the host page's current sessionId. Race condition
    // when the user switches sessions: parent renders this view with
    // the old terminal record briefly before useSessionTerminals
    // resets, causing 404s on the stream / resize endpoints.
    if (terminal.sessionId !== sessionId) return;
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
      theme: {
        background: 'var(--bg-base))',
        foreground: 'var(--fg-default))',
        cursor: 'var(--accent))',
      },
      allowProposedApi: true,
      convertEol: true,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    try {
      fit.fit();
    } catch {
      /* container not laid out yet */
    }
    termRef.current = term;
    fitRef.current = fit;

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        const cols = term.cols;
        const rows = term.rows;
        if (sessionId && token) {
          void resizeTerminal({
            gatewayUrl,
            sessionId,
            terminalId: terminal.terminalId,
            token,
            cols,
            rows,
          }).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    });
    observer.observe(containerRef.current);

    // Pipe keystrokes → backend stdin (persistent only).
    const dataDisposable = term.onData((data) => {
      if (!enabledRef.current) {
        return;
      }
      void writeTerminalStdin({
        gatewayUrl,
        sessionId,
        terminalId: terminal.terminalId,
        token,
        data,
      }).catch(() => {});
    });

    // Resync state per terminal change.
    lastEmittedBytesRef.current = 0;
    let snapshotApplied = false;

    const eventSource = openTerminalStream({
      gatewayUrl,
      sessionId,
      terminalId: terminal.terminalId,
      token,
      onSnapshot: (snapshot) => {
        // Only apply the initial snapshot. EventSource auto-reconnects
        // on network blips and would re-emit `snapshot`, which would
        // wipe whatever the user has half-typed at the prompt.
        if (snapshotApplied) return;
        snapshotApplied = true;
        term.reset();
        if (snapshot.outputTail.length > 0) {
          term.write(snapshot.outputTail);
        }
        lastEmittedBytesRef.current = snapshot.outputBytesTotal;
      },
      onOutput: (chunk) => {
        // The backend sends the cumulative tail (last ≤8KB). When the
        // total bytes only grew, write the diff between previous total
        // and current. When the tail "rolled over" (output exceeded the
        // tail window), the tail isn't a clean prefix anymore, so we
        // just write the whole tail and trust the user.
        const prev = lastEmittedBytesRef.current;
        const next = chunk.outputBytesTotal;
        if (next <= prev) return;
        const grew = next - prev;
        const tail = chunk.outputTail;
        if (grew <= tail.length) {
          term.write(tail.slice(tail.length - grew));
        } else {
          term.write(tail);
        }
        lastEmittedBytesRef.current = next;
      },
      onExited: (chunk) => {
        term.writeln('');
        term.writeln(
          `\u001b[2m[终端已结束 · 状态 ${chunk.status}${
            chunk.exitCode !== undefined ? ` · exit ${chunk.exitCode}` : ''
          }]\u001b[0m`,
        );
      },
    });
    eventSourceRef.current = eventSource;

    return () => {
      observer.disconnect();
      dataDisposable.dispose();
      try {
        eventSource.close();
      } catch {
        /* ignore */
      }
      eventSourceRef.current = null;
      try {
        term.dispose();
      } catch {
        /* ignore */
      }
      termRef.current = null;
      fitRef.current = null;
    };
  }, [gatewayUrl, token, sessionId, terminal.terminalId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: 'var(--bg-base))',
        padding: 4,
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    />
  );
}
