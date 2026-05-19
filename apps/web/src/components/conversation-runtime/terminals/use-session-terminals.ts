/**
 * `useSessionTerminals` — react state machine that mirrors a session's
 * `session_terminals` table for the ChatPage UI.
 *
 * - Hydrates on session change via `GET /sessions/:id/terminals`.
 * - `applyRunEvent` updates the in-memory map for `terminal_started`,
 *   `terminal_output`, and `terminal_exited` events received over the
 *   chat stream so the UI updates without polling.
 * - `kill(terminalId)` POSTs to the kill endpoint and applies an
 *   optimistic state update; the canonical status arrives via the
 *   matching `terminal_exited` event.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RunEvent,
  SessionTerminalStatus,
  StreamTerminalExitedChunk,
  StreamTerminalOutputChunk,
  StreamTerminalStartedChunk,
} from '@openAwork/shared';
import {
  killSessionTerminal,
  listSessionTerminals,
  type SessionTerminalView,
} from './terminals-api.js';

export interface UseSessionTerminalsResult {
  /** Map keyed by terminalId for stable ordering and easy lookup. */
  terminals: SessionTerminalView[];
  /** Active terminals (status running or tmux-spawned). */
  runningCount: number;
  loading: boolean;
  /** Latest error message, if any. */
  error: string | null;
  /** Refetch from the server. Useful for the "refresh" button. */
  reload: () => void;
  /** Apply a single RunEvent to local state (called from chat stream loop). */
  applyRunEvent: (event: RunEvent) => void;
  /** Kill a terminal (optimistic). Returns the server response. */
  killTerminal: (terminalId: string) => Promise<void>;
  /** True while a kill request is in-flight for this terminal id. */
  pendingKillIds: Set<string>;
}

const ACTIVE_STATUSES: ReadonlySet<SessionTerminalStatus> = new Set(['running', 'tmux-spawned']);

interface UseSessionTerminalsOptions {
  currentSessionId: string | null;
  gatewayUrl: string;
  token: string | null;
}

export function useSessionTerminals(
  options: UseSessionTerminalsOptions,
): UseSessionTerminalsResult {
  const { currentSessionId, gatewayUrl, token } = options;
  const [terminalsById, setTerminalsById] = useState<Record<string, SessionTerminalView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKills, setPendingKills] = useState<Set<string>>(() => new Set());
  // Used to bump a reload nonce so callers can imperatively refetch.
  const [reloadNonce, setReloadNonce] = useState(0);
  const inflightController = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset on session switch — never show terminals from a different chat.
    setTerminalsById({});
    setError(null);
    setPendingKills(new Set());

    if (!currentSessionId || !token) {
      setLoading(false);
      return;
    }

    inflightController.current?.abort();
    const controller = new AbortController();
    inflightController.current = controller;
    setLoading(true);

    void listSessionTerminals({
      gatewayUrl,
      sessionId: currentSessionId,
      token,
      limit: 50,
      signal: controller.signal,
    })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const next: Record<string, SessionTerminalView> = {};
        for (const t of payload.terminals) next[t.terminalId] = t;
        setTerminalsById(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [currentSessionId, gatewayUrl, token, reloadNonce]);

  const applyRunEvent = useCallback(
    (event: RunEvent) => {
      if (
        event.type !== 'terminal_started' &&
        event.type !== 'terminal_output' &&
        event.type !== 'terminal_exited'
      ) {
        return;
      }
      // Ignore events from a different session that may leak through a
      // shared stream channel.
      if (
        event.type === 'terminal_started' &&
        currentSessionId &&
        event.sessionId !== currentSessionId
      ) {
        return;
      }

      setTerminalsById((previous) => {
        if (event.type === 'terminal_started') {
          const startedEvent = event as StreamTerminalStartedChunk;
          const existing = previous[startedEvent.terminalId];
          const next: SessionTerminalView = {
            ...(existing ?? {
              terminalId: startedEvent.terminalId,
              sessionId: startedEvent.sessionId,
              toolName: startedEvent.toolName,
              kind: startedEvent.kind,
              command: startedEvent.command,
              cwd: startedEvent.cwd,
              status: 'running' as SessionTerminalStatus,
              startedAtMs: startedEvent.startedAtMs,
              lastActivityMs: startedEvent.startedAtMs,
              outputBytesTotal: 0,
              outputTail: '',
            }),
            terminalId: startedEvent.terminalId,
            sessionId: startedEvent.sessionId,
            toolName: startedEvent.toolName,
            kind: startedEvent.kind,
            command: startedEvent.command,
            cwd: startedEvent.cwd,
            ...(startedEvent.description ? { description: startedEvent.description } : {}),
            ...(startedEvent.clientRequestId
              ? { clientRequestId: startedEvent.clientRequestId }
              : {}),
            startedAtMs: startedEvent.startedAtMs,
            lastActivityMs: existing?.lastActivityMs ?? startedEvent.startedAtMs,
          };
          return { ...previous, [startedEvent.terminalId]: next };
        }
        if (event.type === 'terminal_output') {
          const outEvent = event as StreamTerminalOutputChunk;
          const existing = previous[outEvent.terminalId];
          if (!existing) return previous;
          return {
            ...previous,
            [outEvent.terminalId]: {
              ...existing,
              outputTail: outEvent.outputTail,
              outputBytesTotal: outEvent.outputBytesTotal,
              lastActivityMs: outEvent.occurredAt ?? Date.now(),
            },
          };
        }
        // terminal_exited
        const exitEvent = event as StreamTerminalExitedChunk;
        const existing = previous[exitEvent.terminalId];
        if (!existing) return previous;
        return {
          ...previous,
          [exitEvent.terminalId]: {
            ...existing,
            status: exitEvent.status,
            ...(exitEvent.exitCode !== undefined ? { exitCode: exitEvent.exitCode } : {}),
            endedAtMs: exitEvent.endedAtMs,
            lastActivityMs: exitEvent.endedAtMs,
          },
        };
      });
    },
    [currentSessionId],
  );

  const killTerminal = useCallback(
    async (terminalId: string) => {
      if (!currentSessionId || !token) return;
      setPendingKills((prev) => {
        const next = new Set(prev);
        next.add(terminalId);
        return next;
      });
      // Optimistic: mark the row's status as 'killed' so the UI updates
      // immediately. The canonical status comes back through the
      // terminal_exited RunEvent emitted by spawnAndCollect's resolution.
      setTerminalsById((previous) => {
        const existing = previous[terminalId];
        if (!existing) return previous;
        return {
          ...previous,
          [terminalId]: { ...existing, status: 'killed' as SessionTerminalStatus },
        };
      });
      try {
        const response = await killSessionTerminal({
          gatewayUrl,
          sessionId: currentSessionId,
          terminalId,
          token,
        });
        if (response.terminal) {
          setTerminalsById((previous) => ({
            ...previous,
            [terminalId]: response.terminal as SessionTerminalView,
          }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingKills((prev) => {
          const next = new Set(prev);
          next.delete(terminalId);
          return next;
        });
      }
    },
    [currentSessionId, gatewayUrl, token],
  );

  const reload = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  const sortedTerminals = useMemo<SessionTerminalView[]>(() => {
    // Defensive sessionId filter: when the user switches sessions there
    // is a tick where `currentSessionId` updates but `terminalsById`
    // hasn't been reset yet (effect runs after commit). Without this
    // filter, downstream views would mount SSE / send POSTs against
    // a stale session id, producing 404s like
    //   GET /sessions/<new>/terminals/<old-term>/stream → 404
    const list = Object.values(terminalsById);
    const filtered = currentSessionId ? list.filter((t) => t.sessionId === currentSessionId) : list;
    return filtered.sort((a, b) => b.startedAtMs - a.startedAtMs);
  }, [terminalsById, currentSessionId]);

  const runningCount = useMemo(
    () => sortedTerminals.filter((t) => ACTIVE_STATUSES.has(t.status)).length,
    [sortedTerminals],
  );

  return {
    terminals: sortedTerminals,
    runningCount,
    loading,
    error,
    reload,
    applyRunEvent,
    killTerminal,
    pendingKillIds: pendingKills,
  };
}
