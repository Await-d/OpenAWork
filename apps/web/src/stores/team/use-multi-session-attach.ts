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
 * - 后台逐会话 SSE 最多 3 条，为当前会话流和普通 HTTP 请求保留连接槽
 * - 超过上限的会话走现有轮询回退，不反复淘汰重建连接
 *
 * 用法：在 TeamPageV2 顶层调用一次即可。
 */

import { useEffect, useRef, useCallback } from 'react';
import { createMultiAttachStream } from '@openAwork/web-client';
import type { MultiAttachCallbacks } from '@openAwork/web-client';
import type { RunEvent } from '@openAwork/shared';
import { useLayerStore } from './team-events.js';
import { useMultiAttachStore } from './multi-attach-store.js';

const MAX_CONCURRENT_CONNECTIONS = 3;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const ON_DONE_RECONNECT_DELAY_MS = 500;

/**
 * 结算「连接成功但一条事件都没收到」场景下的下一次重连延迟。
 *
 * 首次仍是 500ms —— 后台流是 fire-and-forget 启动的，提交后往往要等一小会儿
 * 才注册到事件总线，错过这段窗口就会看不到实时输出。但如果始终没有活跃流，
 * 固定 500ms 会退化成每秒两次的请求风暴，故按连续失败次数指数退避（上限 30s）；
 * 收到任意事件即清零（见 onEvent）。
 */
function resolveEmptyStreamReconnectDelayMs(
  attemptsBySession: Map<string, number>,
  sessionId: string,
): number {
  const attempts = (attemptsBySession.get(sessionId) ?? 0) + 1;
  attemptsBySession.set(sessionId, attempts);
  return Math.min(ON_DONE_RECONNECT_DELAY_MS * 2 ** (attempts - 1), RECONNECT_MAX_DELAY_MS);
}

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
  /** 每个 session 连续「连上但没有任何事件」的次数，用于重连退避。 */
  const emptyAttemptsRef = useRef<Map<string, number>>(new Map());

  /**
   * `connectSession` 的自我调度桥（trampoline）。
   *
   * 三条重连路径（onNoActiveStream / onError 指数退避 / onDone）都要在定时器里再次
   * 调用 `connectSession` 本身——直接写 `connectSession(...)` 是「`const` 回调在自身
   * 初始化器内自引用」，React Compiler 判为 "Cannot access variable before it is
   * declared"（TDZ）并放弃优化整个 hook。统一改为 ref 持有 + effect 同步
   * （同 use-scroll-intent.ts 的惯用法），只在定时器回调里取值，渲染期不读 ref。
   */
  const connectSessionRef = useRef<(sessionId: string) => void>(() => {});

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
          // to polling.
          //
          // **重连统一交给紧随其后的 `onDone`**：服务端在这种情况下是先发本事件、
          // 再关闭连接，客户端必然还会收到一次 `onDone`。早前两边各调度一次重连，
          // onDone 会把 onNoActiveStream 刚建的 phantom entry 当成真实连接删掉并
          // 清掉重连定时器，于是 running 会话的多路 SSE 一旦空转就再也无法自愈
          // （用户只能刷新页面）。
          const entry = connectionsRef.current.get(sessionId);
          clearEntryTimer(entry);
          if (entry) {
            connectionsRef.current.delete(sessionId);
          }
          storeGetState().setSessionState(sessionId, 'idle');
        },
        onEvent: (event: RunEvent, meta) => {
          // 收到真实事件 ⇒ 「连上但空转」的计数清零，下一轮重连回到 500ms 快路径。
          emptyAttemptsRef.current.delete(sessionId);
          // lastRowId / lastEventAt 已并入 dispatchEvent 的单次 set，不再单独写。
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
            connectSessionRef.current(sessionId);
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
          // one (e.g. next handoff in the chain). 连续空转时按指数退避，
          // 避免「连接 → 立即 no-active-stream → 再连接」的固定 500ms 风暴。
          if (runningSessionsRef.current.has(sessionId)) {
            const reconnectTimer = setTimeout(
              () => {
                const pending = connectionsRef.current.get(sessionId);
                if (pending?.reconnectTimer !== reconnectTimer) return;
                connectionsRef.current.delete(sessionId);
                if (runningSessionsRef.current.has(sessionId)) connectSessionRef.current(sessionId);
              },
              resolveEmptyStreamReconnectDelayMs(emptyAttemptsRef.current, sessionId),
            );
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

  // 与 connectSessionRef 配对：定时器最早 500ms 后触发，挂载提交阶段必已同步。
  useEffect(() => {
    connectSessionRef.current = connectSession;
  }, [connectSession]);

  // Main effect: sync connections with running sessions from layer store
  useEffect(() => {
    if (!enabled || !token) return;

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
      runningSessionsRef.current.clear();
      emptyAttemptsRef.current.clear();
      for (const [sessionId, entry] of connectionsRef.current) {
        clearEntryTimer(entry);
        entry.close();
        storeGetState().setSessionState(sessionId, 'closed');
        storeGetState().setConnectedAt(sessionId, null);
      }
      connectionsRef.current.clear();
    };
  }, [enabled, token, connectSession, storeGetState]);
}
