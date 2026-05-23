/**
 * ChatPage 会话生命周期域 hook（域 A · Phase A）
 *
 * 聚合"会话本身"的状态与视图守卫：
 * - `currentSessionId` 与会话切换重置相关 state
 * - `messages` / `messageRatings` 及其 ref 镜像
 * - 分页状态（`visibleMessageCount` / `serverTotalTurnCount`）
 * - 加载态（`isSessionLoading` / `sessionReloadNonce`）
 * - 流式追随状态（`hasPendingFollowContent`）
 * - 8 个 ref（active/loaded/epoch/view/route bookkeeping）
 * - 嵌入式依赖：`useWorkspace`、`useSessionViewCache`、`useSessionViewGuard`
 * - 派生回调：`handleToggleMessageRating`
 * - 兼容性 effect：会话路由 ↔ ref 镜像 + sessionListEvents 订阅
 *
 * 设计原则：
 *   1. 本 hook 只提供"状态容器 + 视图守卫 + 派生回调"。
 *      跨域协调（snapshot loader、session-switch 大 effect、
 *      attach-stream 大 effect）继续留在父组件 ChatPage。
 *   2. `messagesRef.current = messages` 的"渲染期同步赋值"是性能必备：
 *      让流式回调可以在不订阅 messages 的前提下读到最新值。这里
 *      显式保留 — React Compiler 会跳过该 hook 的 memoization,
 *      代价是接受这条公认的反模式（参考拆分计划风险 1）。
 *   3. `previousRouteSessionIdRef` 这一个 ref 虽属于会话生命周期,
 *      但唯一消费方是父组件清空 `manualAgentId` 的 effect（属设置域）,
 *      因此对应 effect 留在父组件,这里只暴露 ref。
 *
 * @see docs/architecture/chat-page-split-plan.md 域 A
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createSessionsClient,
  type SessionMessageRatingRecord,
  type SessionMessageRatingValue,
} from '@openAwork/web-client';
import type { ChatMessage } from '../../../components/conversation-runtime/messages/support.js';
import { useWorkspace } from '../../../hooks/workspace/useWorkspace.js';
import { logger } from '../../../utils/log/logger.js';
import { subscribeCurrentSessionRefresh } from '../../../utils/session/session-list-events.js';
import { useSessionViewCache } from '../conversation/snapshot/use-session-view-cache.js';
import {
  useSessionViewGuard,
  type SessionViewGuardReturn,
} from '../conversation/snapshot/use-session-view-guard.js';

export interface UseChatSessionLifecycleOptions {
  /** 路由参数中的 sessionId（来自 react-router）。 */
  routeSessionId: string | undefined;
  /** 网关地址（用于 sessions client）。 */
  gatewayUrl: string;
  /** 当前用户访问令牌；为 null 时跳过远程调用。 */
  token: string | null;
  /** 单页可见消息条数的初始值。 */
  defaultVisibleMessageCount: number;
}

export interface ChatSessionLifecycle {
  // ─── 主要 state ───────────────────────────────────────────────────────
  currentSessionId: string | null;
  setCurrentSessionId: React.Dispatch<React.SetStateAction<string | null>>;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  messageRatings: Record<string, SessionMessageRatingRecord>;
  setMessageRatings: React.Dispatch<
    React.SetStateAction<Record<string, SessionMessageRatingRecord>>
  >;
  sessionReloadNonce: number;
  setSessionReloadNonce: React.Dispatch<React.SetStateAction<number>>;
  hasPendingFollowContent: boolean;
  setHasPendingFollowContent: React.Dispatch<React.SetStateAction<boolean>>;
  isSessionLoading: boolean;
  setIsSessionLoading: React.Dispatch<React.SetStateAction<boolean>>;
  visibleMessageCount: number;
  setVisibleMessageCount: React.Dispatch<React.SetStateAction<number>>;
  serverTotalTurnCount: number | null;
  setServerTotalTurnCount: React.Dispatch<React.SetStateAction<number | null>>;

  // ─── refs (会话视图簿记) ─────────────────────────────────────────────
  /** 渲染期同步镜像 messages,供流式回调零订阅读取最新值。 */
  messagesRef: React.MutableRefObject<ChatMessage[]>;
  /** 当前活跃会话 id 的 ref 镜像（被流式回调用作"是否是我的请求"判断）。 */
  activeSessionRef: React.MutableRefObject<string | null>;
  /** 已加载快照对应的会话 id（用于检测软重载分支）。 */
  currentLoadedSessionIdRef: React.MutableRefObject<string | null>;
  /** 单调递增的会话视图 epoch — 切换会话或重激活时 +1。 */
  sessionViewEpochRef: React.MutableRefObject<number>;
  /** 当前会话视图（{ epoch, sessionId }）的 ref 视图。 */
  currentSessionViewRef: React.MutableRefObject<{
    epoch: number;
    sessionId: string | null;
  }>;
  /** 等待 bootstrap 完成的会话 id（ensureSession / branch import 创建后置位）。 */
  pendingBootstrapSessionRef: React.MutableRefObject<string | null>;
  /** 上一轮路由 sessionId,用于检测路由切换并清空设置域状态。 */
  previousRouteSessionIdRef: React.MutableRefObject<string | null>;
  /** 会话切换时延迟 normalize 大快照的定时器 handle。 */
  pendingSessionNormalizeTimeoutRef: React.MutableRefObject<number | null>;

  // ─── 嵌入依赖 hook 的返回 ───────────────────────────────────────────
  /** workspace 信息（按当前会话派生）。 */
  workspace: ReturnType<typeof useWorkspace>;
  /** 会话视图缓存（切换会话时保留消息 + scrollTop + 流式快照）。 */
  sessionViewCache: ReturnType<typeof useSessionViewCache>;
  /** 视图守卫：activate / isCurrent* 系列回调。 */
  activateSessionView: SessionViewGuardReturn['activateSessionView'];
  isCurrentSessionView: SessionViewGuardReturn['isCurrentSessionView'];
  isCurrentSessionRequest: SessionViewGuardReturn['isCurrentSessionRequest'];

  // ─── 派生回调 ──────────────────────────────────────────────────────
  /**
   * 切换 / 取消助手消息的评分。重复同 rating → 删除；不同 rating → 覆盖。
   * 仅在 `currentSessionId` 与 `token` 都存在且消息为 assistant 时生效。
   */
  handleToggleMessageRating: (
    message: ChatMessage,
    rating: SessionMessageRatingValue,
  ) => Promise<void>;
}

export function useChatSessionLifecycle(
  options: UseChatSessionLifecycleOptions,
): ChatSessionLifecycle {
  const { routeSessionId, gatewayUrl, token, defaultVisibleMessageCount } = options;

  // ── 主要 state ────────────────────────────────────────────────────────
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(routeSessionId ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageRatings, setMessageRatings] = useState<Record<string, SessionMessageRatingRecord>>(
    {},
  );
  const [sessionReloadNonce, setSessionReloadNonce] = useState(0);
  const [hasPendingFollowContent, setHasPendingFollowContent] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [visibleMessageCount, setVisibleMessageCount] = useState(defaultVisibleMessageCount);
  const [serverTotalTurnCount, setServerTotalTurnCount] = useState<number | null>(null);

  // ── refs ──────────────────────────────────────────────────────────────
  const messagesRef = useRef<ChatMessage[]>([]);
  // 渲染期同步镜像 — 流式回调通过 messagesRef.current 读最新值,
  // 不触发依赖订阅。此处的"渲染期赋值"是 ChatPage 流式架构的明确依赖,
  // 详见拆分计划风险 1。
  messagesRef.current = messages;

  const activeSessionRef = useRef<string | null>(routeSessionId ?? null);
  const currentLoadedSessionIdRef = useRef<string | null>(currentSessionId);
  const sessionViewEpochRef = useRef(0);
  const currentSessionViewRef = useRef<{
    epoch: number;
    sessionId: string | null;
  }>({
    epoch: 0,
    sessionId: routeSessionId ?? null,
  });
  const pendingBootstrapSessionRef = useRef<string | null>(null);
  const previousRouteSessionIdRef = useRef<string | null>(routeSessionId ?? null);
  const pendingSessionNormalizeTimeoutRef = useRef<number | null>(null);

  // ── 嵌入依赖 hook ─────────────────────────────────────────────────────
  const workspace = useWorkspace(currentSessionId);
  const sessionViewCache = useSessionViewCache();
  const { activateSessionView, isCurrentSessionView, isCurrentSessionRequest } =
    useSessionViewGuard({
      activeSessionRef,
      sessionViewEpochRef,
      currentSessionViewRef,
    });

  // ── 同步 ref 镜像 ─────────────────────────────────────────────────────
  // 路由 / 当前 sessionId 变化时把 active/loaded ref 重新指向。
  // 父组件的会话切换大 effect 也会写这两个 ref,但那是切换流程的中间态;
  // 这里负责"提交后"的稳态镜像。`lastParentTaskSyncMarkerRef` 不在
  // 本 hook 范围（属任务同步域）,所以由父组件自行维护。
  useEffect(() => {
    activeSessionRef.current = routeSessionId ?? currentSessionId ?? null;
    currentLoadedSessionIdRef.current = currentSessionId;
  }, [currentSessionId, routeSessionId]);

  // ── 监听外部触发的当前会话刷新 ──────────────────────────────────────
  // 当其他视图（侧栏 / 任务面板等）通过 sessionListEvents 触发刷新当前
  // 会话时,bump nonce 让 ChatPage 的 effect 链重新拉一次快照。
  useEffect(() => {
    return subscribeCurrentSessionRefresh((targetSessionId) => {
      if (targetSessionId === activeSessionRef.current) {
        setSessionReloadNonce((value) => value + 1);
      }
    });
  }, []);

  // ── 派生回调 ─────────────────────────────────────────────────────────
  const handleToggleMessageRating = useCallback(
    async (message: ChatMessage, rating: SessionMessageRatingValue) => {
      if (!token || !currentSessionId || message.role !== 'assistant' || !message.rawContent) {
        return;
      }

      const existingRating = messageRatings[message.id]?.rating;
      const sessionsClient = createSessionsClient(gatewayUrl);

      try {
        if (existingRating === rating) {
          await sessionsClient.deleteMessageRating(token, currentSessionId, message.id);
          setMessageRatings((previous) => {
            const next = { ...previous };
            delete next[message.id];
            return next;
          });
          return;
        }

        const nextRating = await sessionsClient.setMessageRating(
          token,
          currentSessionId,
          message.id,
          { rating },
        );
        setMessageRatings((previous) => ({
          ...previous,
          [message.id]: nextRating,
        }));
      } catch (error) {
        logger.error('message rating failed', error);
      }
    },
    [currentSessionId, gatewayUrl, messageRatings, token],
  );

  return {
    currentSessionId,
    setCurrentSessionId,
    messages,
    setMessages,
    messageRatings,
    setMessageRatings,
    sessionReloadNonce,
    setSessionReloadNonce,
    hasPendingFollowContent,
    setHasPendingFollowContent,
    isSessionLoading,
    setIsSessionLoading,
    visibleMessageCount,
    setVisibleMessageCount,
    serverTotalTurnCount,
    setServerTotalTurnCount,

    messagesRef,
    activeSessionRef,
    currentLoadedSessionIdRef,
    sessionViewEpochRef,
    currentSessionViewRef,
    pendingBootstrapSessionRef,
    previousRouteSessionIdRef,
    pendingSessionNormalizeTimeoutRef,

    workspace,
    sessionViewCache,
    activateSessionView,
    isCurrentSessionView,
    isCurrentSessionRequest,

    handleToggleMessageRating,
  };
}
