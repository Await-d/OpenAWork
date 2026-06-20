/**
 * Multi-Attach Store · 多路 SSE 流式事件路由
 *
 * 全局 store，管理所有 team session 的多路 SSE 连接状态和事件分发。
 *
 * 架构：
 * - `useMultiSessionAttach` hook 为每个 running session 建立 SSE 连接到
 *   `/sessions/:id/stream/multi-attach`，收到 RunEvent 后调用 `dispatchEvent`
 * - 每个 `useTeamConversationState` 在 mount 时通过 `registerHandler` 注册
 *   自己的 `handleEvent` 回调；unmount 时 `unregisterHandler`
 * - 当某 session 的 SSE 连接活跃时，`useTeamConversationState` 跳过 2.5s 轮询
 *
 * 与单路 attach (`useGatewayClient.attachToActiveStream`) 的关系：
 * - 当前聚焦的 session 仍可使用单路 attach（它需要 clientRequestId 精确匹配）
 * - 多路 attach 作为"背景音"覆盖所有 running session，确保非聚焦层也能实时
 * - 如果单路和多路同时收到事件，由 `useConversationStream` 的事件去重逻辑处理
 */

import { create } from 'zustand';
import type { RunEvent } from '@openAwork/shared';

export type MultiAttachConnectionState = 'idle' | 'connecting' | 'connected' | 'error' | 'closed';

export interface MultiAttachSessionStatus {
  sessionId: string;
  state: MultiAttachConnectionState;
  /** 服务端报告的当前活跃流 clientRequestId（null = 无活跃流） */
  activeClientRequestId: string | null;
  /** 最后处理的 DB rowId（用于断线重连时传 afterSeq） */
  lastRowId: number;
  /** 连接建立时间戳 */
  connectedAt: number | null;
  /** 最后收到事件的时间戳 */
  lastEventAt: number | null;
}

type RunEventHandler = (event: RunEvent, meta: { rowId: number; clientRequestId?: string }) => void;

interface MultiAttachStoreState {
  /** 各 session 的 SSE 连接状态 */
  sessions: Map<string, MultiAttachSessionStatus>;
  /** 各 session 注册的事件处理器（由 useTeamConversationState 注册） */
  handlers: Map<string, Set<RunEventHandler>>;
  /** 各 session 已处理的 rowId 集合（去重，防止多 handler 实例重复处理） */
  processedRowIds: Map<string, Set<number>>;

  /** 注册事件处理器 */
  registerHandler: (sessionId: string, handler: RunEventHandler) => () => void;

  /** 分发事件到对应 session 的所有处理器（带 rowId 去重） */
  dispatchEvent: (
    sessionId: string,
    event: RunEvent,
    meta: { rowId: number; clientRequestId?: string },
  ) => void;

  /** 更新 session 连接状态 */
  setSessionState: (sessionId: string, state: MultiAttachConnectionState) => void;

  /** 更新 session 的活跃流信息 */
  setActiveClientRequestId: (sessionId: string, clientRequestId: string | null) => void;

  /** 更新最后处理的 rowId */
  setLastRowId: (sessionId: string, rowId: number) => void;

  /** 更新最后事件时间戳 */
  setLastEventAt: (sessionId: string, timestamp: number) => void;

  /** 设置连接建立时间 */
  setConnectedAt: (sessionId: string, timestamp: number | null) => void;

  /** 移除 session 的所有状态（连接关闭后清理） */
  removeSession: (sessionId: string) => void;

  /** 判断某 session 是否有多路 SSE 活跃连接 */
  isSessionAttached: (sessionId: string) => boolean;
}

export const useMultiAttachStore = create<MultiAttachStoreState>((set, get) => ({
  sessions: new Map(),
  handlers: new Map(),
  processedRowIds: new Map(),

  registerHandler: (sessionId, handler) => {
    const current = get().handlers.get(sessionId) ?? new Set<RunEventHandler>();
    current.add(handler);
    set((state) => {
      const next = new Map(state.handlers);
      next.set(sessionId, current);
      return { handlers: next };
    });

    return () => {
      const existing = get().handlers.get(sessionId);
      if (!existing) return;
      existing.delete(handler);
      if (existing.size === 0) {
        set((state) => {
          const nextHandlers = new Map(state.handlers);
          nextHandlers.delete(sessionId);
          const nextProcessed = new Map(state.processedRowIds);
          nextProcessed.delete(sessionId);
          return { handlers: nextHandlers, processedRowIds: nextProcessed };
        });
      }
    };
  },

  dispatchEvent: (sessionId, event, meta) => {
    // R-2 fix: deduplicate by rowId — if multiple TeamConversationView
    // instances are mounted for the same session, each registers a handler.
    // Without dedup, the same text_delta would be accumulated N times.
    if (meta.rowId > 0) {
      const processed = get().processedRowIds.get(sessionId) ?? new Set<number>();
      if (processed.has(meta.rowId)) {
        return; // Already dispatched to handlers
      }
      processed.add(meta.rowId);
      // Cap the set to prevent unbounded growth (keep last 1000)
      if (processed.size > 1000) {
        const toRemove = processed.size - 1000;
        const iter = processed.values();
        for (let i = 0; i < toRemove; i++) {
          const val = iter.next().value;
          if (val !== undefined) processed.delete(val);
        }
      }
      set((state) => {
        const next = new Map(state.processedRowIds);
        next.set(sessionId, processed);
        return { processedRowIds: next };
      });
    }

    const handlers = get().handlers.get(sessionId);
    if (!handlers || handlers.size === 0) return;
    for (const handler of [...handlers]) {
      try {
        handler(event, meta);
      } catch (error) {
        console.error('[multi-attach] handler failed', {
          error: error instanceof Error ? error.message : String(error),
          eventType: event.type,
          sessionId,
        });
      }
    }
  },

  setSessionState: (sessionId, state) =>
    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(sessionId);
      next.set(sessionId, {
        sessionId,
        state: existing?.state ?? 'idle',
        activeClientRequestId: existing?.activeClientRequestId ?? null,
        lastRowId: existing?.lastRowId ?? 0,
        connectedAt: existing?.connectedAt ?? null,
        lastEventAt: existing?.lastEventAt ?? null,
        ...existing,
        state,
      });
      return { sessions: next };
    }),

  setActiveClientRequestId: (sessionId, clientRequestId) =>
    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(sessionId);
      if (!existing) return { sessions: next };
      next.set(sessionId, { ...existing, activeClientRequestId: clientRequestId });
      return { sessions: next };
    }),

  setLastRowId: (sessionId, rowId) =>
    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(sessionId);
      if (!existing) return { sessions: next };
      next.set(sessionId, { ...existing, lastRowId: Math.max(existing.lastRowId, rowId) });
      return { sessions: next };
    }),

  setLastEventAt: (sessionId, timestamp) =>
    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(sessionId);
      if (!existing) return { sessions: next };
      next.set(sessionId, { ...existing, lastEventAt: timestamp });
      return { sessions: next };
    }),

  setConnectedAt: (sessionId, timestamp) =>
    set((s) => {
      const next = new Map(s.sessions);
      const existing = next.get(sessionId);
      if (!existing) return { sessions: next };
      next.set(sessionId, { ...existing, connectedAt: timestamp });
      return { sessions: next };
    }),

  removeSession: (sessionId) =>
    set((s) => {
      const next = new Map(s.sessions);
      next.delete(sessionId);
      return { sessions: next };
    }),

  isSessionAttached: (sessionId) => {
    const status = get().sessions.get(sessionId);
    return status?.state === 'connected';
  },
}));
