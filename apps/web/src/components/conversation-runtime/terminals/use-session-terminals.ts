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
 *
 * 兜底同步（reconcile）：
 * `applyRunEvent` 只有在聊天流活着且事件确实送达时才生效。聊天流断线、
 * 后台标签页被浏览器节流、或者后端重启都会让本地 map 永远停在旧状态——
 * 表现就是"终端早就结束了，面板里还显示运行中"。为此这里额外维护一个
 * 低频兜底轮询，把服务端快照对齐回本地：
 *   - 有活跃终端时 5s 一次，纯空闲时 20s 一次；
 *   - 页面不可见（`document.hidden`）时完全暂停，切回前台立刻对齐一次；
 *   - 失败按 2 的幂退避，最长 20s，成功后立即复位。
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
  renameSessionTerminal,
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
  /** Refetch without flipping `loading` — used by the reconcile loop. */
  refreshSilently: () => void;
  /**
   * Timestamp (ms) of the last successful server sync. The panel renders
   * "同步于 Xs 前" so users can tell whether the list is trustworthy.
   */
  lastSyncedAtMs: number | null;
  /** True while a silent reconcile round-trip is in flight. */
  syncing: boolean;
  /** Apply a single RunEvent to local state (called from chat stream loop). */
  applyRunEvent: (event: RunEvent) => void;
  /** Kill a terminal (optimistic). Returns the server response. */
  killTerminal: (terminalId: string) => Promise<void>;
  /** Kill several terminals in one batch (powers "全部终止"). */
  killTerminals: (terminalIds: readonly string[]) => Promise<void>;
  /** Rename a terminal. Updates local state optimistically. */
  renameTerminal: (terminalId: string, name: string | null) => Promise<void>;
  /** Remove a terminated terminal from local state (hides it from tabs). */
  dismissTerminal: (terminalId: string) => void;
  /** True while a kill request is in-flight for this terminal id. */
  pendingKillIds: Set<string>;
}

const ACTIVE_STATUSES: ReadonlySet<SessionTerminalStatus> = new Set(['running', 'tmux-spawned']);

/** Reconcile cadence while at least one terminal is still active. */
const ACTIVE_RECONCILE_INTERVAL_MS = 5_000;
/** Reconcile cadence when nothing is running (still catches missed starts). */
const IDLE_RECONCILE_INTERVAL_MS = 20_000;
/** Upper bound for the failure backoff. */
const SYNC_ERROR_MAX_DELAY_MS = 20_000;
/**
 * A locally-created row younger than this survives a server snapshot that
 * hasn't observed it yet. Without the grace window the `terminal_started`
 * SSE event racing ahead of DB visibility would make rows flicker out.
 */
const LOCAL_ROW_GRACE_MS = 15_000;

interface UseSessionTerminalsOptions {
  currentSessionId: string | null;
  gatewayUrl: string;
  token: string | null;
}

/**
 * Merge a server snapshot into the local map.
 *
 * Server rows win, with two exceptions: rows with an in-flight kill keep
 * their optimistic local status, and very recent active local rows are
 * preserved when the snapshot predates them.
 */
function mergeServerSnapshot(
  previous: Record<string, SessionTerminalView>,
  rows: readonly SessionTerminalView[],
  sessionId: string,
  pendingKillIds: ReadonlySet<string>,
  now: number,
): Record<string, SessionTerminalView> {
  const next: Record<string, SessionTerminalView> = {};
  const seen = new Set<string>();

  for (const row of rows) {
    if (row.sessionId !== sessionId) continue;
    seen.add(row.terminalId);
    if (pendingKillIds.has(row.terminalId)) {
      const local = previous[row.terminalId];
      if (local) {
        next[row.terminalId] = local;
        continue;
      }
    }
    next[row.terminalId] = row;
  }

  for (const [terminalId, local] of Object.entries(previous)) {
    if (seen.has(terminalId)) continue;
    if (ACTIVE_STATUSES.has(local.status) && now - local.startedAtMs < LOCAL_ROW_GRACE_MS) {
      next[terminalId] = local;
    }
  }

  return next;
}

export function useSessionTerminals(
  options: UseSessionTerminalsOptions,
): UseSessionTerminalsResult {
  const { currentSessionId, gatewayUrl, token } = options;
  const [terminalsById, setTerminalsById] = useState<Record<string, SessionTerminalView>>({});
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAtMs, setLastSyncedAtMs] = useState<number | null>(null);
  const [pendingKills, setPendingKills] = useState<Set<string>>(() => new Set());
  // Used to bump a reload nonce so callers can imperatively refetch.
  const [reloadNonce, setReloadNonce] = useState(0);
  // Bumped after every reconcile attempt to re-arm the polling timer even
  // when the snapshot didn't change any state.
  const [syncTick, setSyncTick] = useState(0);
  const inflightController = useRef<AbortController | null>(null);
  // Mirrors `pendingKills` for use inside async callbacks without adding a
  // dependency that would re-create `runSync` (and restart the loop).
  const pendingKillsRef = useRef<Set<string>>(pendingKills);
  pendingKillsRef.current = pendingKills;
  const failureCountRef = useRef(0);
  // Last `reloadNonce` handled by the reload effect below. Lets the effect
  // tell "an imperative reload was requested" apart from "the identity
  // changed", so a session switch never fires a second, redundant sync.
  const handledReloadNonceRef = useRef(0);

  const hasActiveTerminals = useMemo(
    () => Object.values(terminalsById).some((t) => ACTIVE_STATUSES.has(t.status)),
    [terminalsById],
  );

  /**
   * One reconcile round-trip. `initial` drives the hydration spinner,
   * `silent` is the background path and only flips `syncing`.
   */
  const runSync = useCallback(
    async (mode: 'initial' | 'silent'): Promise<void> => {
      if (!currentSessionId || !token) return;

      inflightController.current?.abort();
      const controller = new AbortController();
      inflightController.current = controller;
      if (mode === 'initial') setLoading(true);
      else setSyncing(true);

      try {
        const payload = await listSessionTerminals({
          gatewayUrl,
          sessionId: currentSessionId,
          token,
          limit: 50,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setTerminalsById((previous) =>
          mergeServerSnapshot(
            previous,
            payload.terminals,
            currentSessionId,
            pendingKillsRef.current,
            Date.now(),
          ),
        );
        setError(null);
        failureCountRef.current = 0;
        setLastSyncedAtMs(Date.now());
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : String(err));
        failureCountRef.current += 1;
      } finally {
        if (!controller.signal.aborted) {
          if (mode === 'initial') setLoading(false);
          else setSyncing(false);
        }
        setSyncTick((prev) => prev + 1);
      }
    },
    [currentSessionId, gatewayUrl, token],
  );

  useEffect(() => {
    // Reset on session switch — never show terminals from a different chat.
    setTerminalsById({});
    setError(null);
    setPendingKills(new Set());
    setLastSyncedAtMs(null);
    failureCountRef.current = 0;

    if (!currentSessionId || !token) {
      setLoading(false);
      setSyncing(false);
      return;
    }

    void runSync('initial');

    return () => {
      inflightController.current?.abort();
      inflightController.current = null;
    };
  }, [currentSessionId, gatewayUrl, token, runSync]);

  // `reload()` 只负责重新拉取，**不**重置本地快照。
  //
  // 之前这个 effect 与上面的身份 effect 合二为一，`reloadNonce` 自增会把
  // `terminalsById` 清空，`activeTerminalCount` 因此出现一次瞬时 0；
  // `TerminalPanel` 的「运行中数量 >0 → 0」effect 会把整个抽屉收起，
  // 于是建第 2 个终端时面板自动折叠（D-1）。重置只允许随身份变化发生。
  useEffect(() => {
    if (handledReloadNonceRef.current === reloadNonce) return;
    handledReloadNonceRef.current = reloadNonce;
    if (!currentSessionId || !token) return;
    // `runSync` 自身会 abort 上一个 in-flight 请求，所以这里不需要额外的
    // abort 清理闭包——它只属于身份 effect（会话切换 / 卸载）。
    void runSync('initial');
  }, [reloadNonce, currentSessionId, token, runSync]);

  // 兜底 reconcile 循环。延迟同时承担两个职责：常态轮询周期 + 失败退避。
  useEffect(() => {
    if (!currentSessionId || !token) return;

    const baseDelay = hasActiveTerminals
      ? ACTIVE_RECONCILE_INTERVAL_MS
      : IDLE_RECONCILE_INTERVAL_MS;
    const delay = Math.min(baseDelay * 2 ** failureCountRef.current, SYNC_ERROR_MAX_DELAY_MS);

    const timer = window.setTimeout(() => {
      // 后台标签页不做无谓请求；切回前台时由 visibilitychange 立刻补一次。
      if (typeof document !== 'undefined' && document.hidden) return;
      void runSync('silent');
    }, delay);

    return () => window.clearTimeout(timer);
  }, [currentSessionId, token, hasActiveTerminals, runSync, syncTick]);

  // 回到前台时立刻对齐一次，避免用户看到离开期间积压的过期状态。
  useEffect(() => {
    if (!currentSessionId || !token) return;
    const onVisibilityChange = (): void => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void runSync('silent');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [currentSessionId, token, runSync]);

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

  const killTerminals = useCallback(
    async (terminalIds: readonly string[]) => {
      // 串行之外的并行请求都在各自分支内处理错误，这里只做 fan-out。
      await Promise.all(terminalIds.map((terminalId) => killTerminal(terminalId)));
    },
    [killTerminal],
  );

  const reload = useCallback(() => {
    setReloadNonce((prev) => prev + 1);
  }, []);

  const refreshSilently = useCallback(() => {
    void runSync('silent');
  }, [runSync]);

  const renameTerminalFn = useCallback(
    async (terminalId: string, name: string | null) => {
      if (!currentSessionId || !token) return;
      // Optimistic update
      setTerminalsById((previous) => {
        const existing = previous[terminalId];
        if (!existing) return previous;
        const updated = { ...existing };
        if (name && name.trim().length > 0) {
          updated.name = name.trim();
        } else {
          delete updated.name;
        }
        return { ...previous, [terminalId]: updated };
      });
      try {
        const response = await renameSessionTerminal({
          gatewayUrl,
          sessionId: currentSessionId,
          terminalId,
          token,
          name,
        });
        if (response.terminal) {
          setTerminalsById((previous) => ({
            ...previous,
            [terminalId]: response.terminal as SessionTerminalView,
          }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [currentSessionId, gatewayUrl, token],
  );

  const dismissTerminal = useCallback((terminalId: string) => {
    setTerminalsById((previous) => {
      const { [terminalId]: _removed, ...rest } = previous;
      return rest;
    });
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
    refreshSilently,
    lastSyncedAtMs,
    syncing,
    applyRunEvent,
    killTerminal,
    killTerminals,
    renameTerminal: renameTerminalFn,
    dismissTerminal,
    pendingKillIds: pendingKills,
  };
}
