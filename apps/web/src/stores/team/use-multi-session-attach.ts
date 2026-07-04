/**
 * useMultiSessionAttach · 多路 SSE 连接管理 hook
 *
 * 监听 `useLayerStore` 中所有 `running` 状态的 session 节点，为每个建立
 * 到 `/sessions/:id/stream/multi-attach` 的 SSE 连接。收到的 RunEvent 通过
 * `useMultiAttachStore.dispatchEvent` 分发到对应 session 的注册处理器。
 *
 * 核心逻辑：
 * 1. 从 `useLayerStore` 读取所有 session 节点
 * 2. 筛选出 `state === 'running'` 的节点
 * 3. 为新出现的 running session 建立 SSE 连接
 * 4. 为不再 running 的 session 关闭连接
 * 5. 连接断开时自动重试（指数退避，最大 30s）
 *
 * 浏览器 SSE 连接数限制：
 * - 同域 EventSource 并发上限约 6 个
 * - team 场景同时 running 的 session 通常 ≤4（reception→pm1→pm2→executor 链式）
 * - 超过上限时按 LRU 策略淘汰最旧的连接（保留最近活跃的）
 *
 * 用法：在 TeamPageV2 顶层调用一次即可。
 */

import { useEffect, useRef, useCallback } from 'react';
import { createMultiAttachStream } from '@openAwork/web-client';
import type { MultiAttachCallbacks } from '@openAwork/web-client';
import type { RunEvent } from '@openAwork/shared';
import { useLayerStore } from './team-events.js';
import { useMultiAttachStore } from './multi-attach-store.js';

const MAX_CONCURRENT_CONNECTIONS = 5;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const ON_DONE_RECONNECT_DELAY_MS = 500;
const NO_STREAM_RECONNECT_DELAY_MS = 500;

interface UseMultiSessionAttachOptions {
  token: string | null;
  gatewayUrl: string;
  enabled: boolean;
}

interface ConnectionEntry {
  sessionId: string;
  close: () => void;
  /** 统一管理所有重连 timer（onError 退避 + onDone 重连），cleanup 时全部清除 */
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
}

export function useMultiSessionAttach(options: UseMultiSessionAttachOptions): void {
  const { token, gatewayUrl, enabled } = options;
  const connectionsRef = useRef<Map<string, ConnectionEntry>>(new Map());
  const runningSessionsRef = useRef<Set<string>>(new Set());

  // P2-1 修复：不使用 useMultiAttachStore() 解构（会导致全量重渲染），
  // 改为在 callback 中通过 getState() 访问 action 函数。
  const storeGetState = useMultiAttachStore.getState;

  const clearEntryTimer = (entry: ConnectionEntry | undefined) => {
    if (entry?.reconnectTimer) {
      clearTimeout(entry.reconnectTimer);
      entry.reconnectTimer = null;
    }
  };

  const connectSession = useCallback(
    (sessionId: string) => {
      if (!token) return;

      // Already connected?
      if (connectionsRef.current.has(sessionId)) return;

      // Connection cap check is done by the caller (checkRunningSessions),
      // not here. This prevents LRU eviction thrashing.

      const { setSessionState } = storeGetState();

      setSessionState(sessionId, 'connecting');

      const callbacks: MultiAttachCallbacks = {
        onStatus: (status) => {
          storeGetState().setActiveClientRequestId(sessionId, status.activeClientRequestId);
        },
        onNoActiveStream: () => {
          // No active stream — clean up this connection.
          // Session may still be running but the backend has no active stream
          // to subscribe to. We set state to 'idle' so the consumer falls back
          // to polling, and schedule a reconnect in case a stream starts soon.
          const entry = connectionsRef.current.get(sessionId);
          clearEntryTimer(entry);
          if (entry) {
            connectionsRef.current.delete(sessionId);
          }
          storeGetState().setSessionState(sessionId, 'idle');

          // Schedule a lightweight reconnect — the session might start a new
          // stream shortly (e.g. handoff just dispatched, or runSessionInBackground
          // hasn't registered yet). Use a short delay (500ms) to match the
          // auto-attach timing in useTeamConversationState.
          if (runningSessionsRef.current.has(sessionId)) {
            const reconnectTimer = setTimeout(() => {
              if (
                runningSessionsRef.current.has(sessionId) &&
                !connectionsRef.current.has(sessionId)
              ) {
                connectSession(sessionId);
              }
            }, NO_STREAM_RECONNECT_DELAY_MS);
            // Track timer in a phantom entry so cleanup can clear it.
            connectionsRef.current.set(sessionId, {
              sessionId,
              close: () => {},
              reconnectTimer,
              reconnectAttempt: 0,
            });
          }
        },
        onEvent: (event: RunEvent, meta) => {
          if (meta.rowId > 0) {
            storeGetState().setLastRowId(sessionId, meta.rowId);
          }
          storeGetState().setLastEventAt(sessionId, Date.now());
          storeGetState().dispatchEvent(sessionId, event, meta);
        },
        onError: (_code, _message) => {
          const entry = connectionsRef.current.get(sessionId);
          if (!entry) return;

          clearEntryTimer(entry);
          storeGetState().setSessionState(sessionId, 'error');
          storeGetState().setConnectedAt(sessionId, null);

          // Exponential backoff reconnect
          entry.reconnectAttempt += 1;
          const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, entry.reconnectAttempt - 1),
            RECONNECT_MAX_DELAY_MS,
          );

          entry.reconnectTimer = setTimeout(() => {
            // Check if session is still running before reconnecting
            if (!runningSessionsRef.current.has(sessionId)) {
              connectionsRef.current.delete(sessionId);
              storeGetState().removeSession(sessionId);
              return;
            }
            // Close old connection and reconnect
            entry.close();
            connectionsRef.current.delete(sessionId);
            connectSession(sessionId);
          }, delay);
        },
        onDone: () => {
          const entry = connectionsRef.current.get(sessionId);
          clearEntryTimer(entry);
          if (entry) {
            connectionsRef.current.delete(sessionId);
          }
          storeGetState().setSessionState(sessionId, 'closed');
          storeGetState().setConnectedAt(sessionId, null);

          // If session is still running, try to reconnect after a short delay.
          // The current stream's round ended, but the session may start a new
          // one (e.g. next handoff in the chain).
          if (runningSessionsRef.current.has(sessionId)) {
            const reconnectTimer = setTimeout(() => {
              if (
                runningSessionsRef.current.has(sessionId) &&
                !connectionsRef.current.has(sessionId)
              ) {
                connectSession(sessionId);
              }
            }, ON_DONE_RECONNECT_DELAY_MS);
            // Track timer in a phantom entry so cleanup can clear it.
            connectionsRef.current.set(sessionId, {
              sessionId,
              close: () => {},
              reconnectTimer,
              reconnectAttempt: 0,
            });
          }
        },
      };

      const lastRowId = storeGetState().sessions.get(sessionId)?.lastRowId ?? 0;
      const { close } = createMultiAttachStream({
        gatewayUrl,
        sessionId,
        token,
        afterSeq: lastRowId,
        callbacks,
      });

      connectionsRef.current.set(sessionId, {
        sessionId,
        close,
        reconnectTimer: null,
        reconnectAttempt: 0,
      });

      storeGetState().setSessionState(sessionId, 'connected');
      storeGetState().setConnectedAt(sessionId, Date.now());
    },
    [token, gatewayUrl, storeGetState],
  );

  // Main effect: sync connections with running sessions from layer store
  useEffect(() => {
    if (!enabled || !token) {
      // Clean up all connections when disabled
      for (const [, entry] of connectionsRef.current) {
        clearEntryTimer(entry);
        entry.close();
      }
      connectionsRef.current.clear();
      runningSessionsRef.current.clear();
      return;
    }

    const checkRunningSessions = () => {
      const nodes = useLayerStore.getState().nodes;
      const runningSessionIds = new Set<string>();
      for (const [sessionId, node] of nodes) {
        if (node.state === 'running' || node.state === 'claimed' || node.state === 'pending') {
          runningSessionIds.add(sessionId);
        }
      }
      runningSessionsRef.current = runningSessionIds;

      // Connect new running sessions, but respect the connection cap.
      // If we're at capacity, DON'T evict — just skip. The evicted session
      // will be picked up when another session completes and frees a slot.
      // This prevents connection thrashing (connect→evict→reconnect→evict).
      for (const sessionId of runningSessionIds) {
        if (!connectionsRef.current.has(sessionId)) {
          if (connectionsRef.current.size >= MAX_CONCURRENT_CONNECTIONS) {
            // At capacity — skip this session, it will use polling fallback.
            continue;
          }
          connectSession(sessionId);
        }
      }

      // Disconnect sessions that are no longer running.
      // But preserve entries that only have a pending reconnect timer (phantom entries
      // from onDone/onNoActiveStream) — their close() is a no-op, and we want the
      // timer to fire if the session comes back to running.
      for (const [sessionId, entry] of connectionsRef.current) {
        if (!runningSessionIds.has(sessionId)) {
          clearEntryTimer(entry);
          entry.close();
          connectionsRef.current.delete(sessionId);
          storeGetState().setSessionState(sessionId, 'closed');
        }
      }

      // After disconnecting completed sessions, try to connect any running
      // sessions that were previously skipped due to the cap.
      for (const sessionId of runningSessionIds) {
        if (!connectionsRef.current.has(sessionId)) {
          if (connectionsRef.current.size >= MAX_CONCURRENT_CONNECTIONS) {
            break;
          }
          connectSession(sessionId);
        }
      }
    };

    // Initial check
    checkRunningSessions();

    // Subscribe to store updates
    const unsub = useLayerStore.subscribe(checkRunningSessions);

    return () => {
      unsub();
    };
  }, [enabled, token, connectSession, storeGetState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const [, entry] of connectionsRef.current) {
        clearEntryTimer(entry);
        entry.close();
      }
      connectionsRef.current.clear();
    };
  }, []);
}
