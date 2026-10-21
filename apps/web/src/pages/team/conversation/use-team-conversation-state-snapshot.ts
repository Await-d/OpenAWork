import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunEvent, SubagentNotice } from '@openAwork/shared';
import { collectSubagentNotices } from '../../../components/conversation-runtime/messages/subagent-notices.js';
import {
  createSessionsClient,
  type PendingPermissionRequest,
  type PendingQuestionRequest,
} from '@openAwork/web-client';
import type {
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import {
  normalizeChatMessages,
  reconcileSnapshotChatMessages,
} from '../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../components/conversation-runtime/session/session-runtime.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import {
  publishSessionPendingPermission,
  publishSessionPendingQuestion,
  publishSessionRunState,
} from '../../../utils/session/session-list-events.js';
import { toSessionPendingPermissionState } from '../../../utils/permission/pending-permission-state.js';
import {
  useLayerStore,
  useTeamEventsConnectionStore,
  useTeamNotificationStore,
} from '../../../stores/team/team-events.js';
import { nextTeamEventWatermark, shouldReloadForTeamEvents } from './team-event-reload-policy.js';
import { clearRollbackScope } from '../../../stores/team/rollback-tombstones.js';
import { writeRefCurrent } from '../../../utils/ref/ref-current.js';
import {
  computeTeamConversationRecoveryRetryDelay,
  formatTeamConversationRecoveryLoadError,
  isSessionBusyForSidebar,
  resolveSessionSidebarRunState,
  TEAM_CONVERSATION_INITIAL_TURN_LIMIT,
  TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT,
  TEAM_RECOVERY_RUN_EVENT_LIMIT,
  toTeamRoleLayer,
} from './team-conversation-load-policy.js';
import { useRecoverableRetryController } from '../hooks/use-recoverable-retry.js';

export interface UseTeamConversationSnapshotOptions {
  sessionId: string | null;
  gatewayUrl: string;
  token: string | null;
  enabled: boolean;
  streaming: boolean;
  multiAttachActive: boolean;
  streamingRef: React.MutableRefObject<boolean>;
  scrollRegionRef: React.RefObject<HTMLDivElement | null>;
  setActiveProviderId: React.Dispatch<React.SetStateAction<string>>;
  setActiveModelId: React.Dispatch<React.SetStateAction<string>>;
  setStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStoppingStream: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBuffer: React.Dispatch<React.SetStateAction<string>>;
  setStreamThinkingBlocks: React.Dispatch<React.SetStateAction<StreamingThinkingBlock[]>>;
  setStreamingSegments: React.Dispatch<React.SetStateAction<ChatMessagePart[]>>;
  setReportedStreamUsage: React.Dispatch<React.SetStateAction<ChatBackendUsageSnapshot | null>>;
  setStreamError: React.Dispatch<React.SetStateAction<string | null>>;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  setShowScrollToBottom: React.Dispatch<React.SetStateAction<boolean>>;
  setHasPendingFollowContent: React.Dispatch<React.SetStateAction<boolean>>;
}

export interface UseTeamConversationSnapshotResult {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  /** 子代理完成通知（`role: 'synthetic'`），与 `messages` 同源解析但走独立通道。 */
  subagentNotices: SubagentNotice[];
  childSessions: Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>;
  setChildSessions: React.Dispatch<
    React.SetStateAction<Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>>
  >;
  sessionStateStatus: SessionStateStatus | null;
  setSessionStateStatus: React.Dispatch<React.SetStateAction<SessionStateStatus | null>>;
  isSessionSnapshotReady: boolean;
  isSessionLoading: boolean;
  snapshotError: string | null;
  setSnapshotError: React.Dispatch<React.SetStateAction<string | null>>;
  sessionTodos: SessionTodoItem[];
  pendingPermissions: PendingPermissionRequest[];
  setPendingPermissions: React.Dispatch<React.SetStateAction<PendingPermissionRequest[]>>;
  pendingQuestions: PendingQuestionRequest[];
  setPendingQuestions: React.Dispatch<React.SetStateAction<PendingQuestionRequest[]>>;
  runEvents: RunEvent[];
  setRunEvents: React.Dispatch<React.SetStateAction<RunEvent[]>>;
  roleLayer: string | null;
  substate: string | null;
  sessionMetadata: Record<string, unknown> | null;
  serverTotalTurnCount: number | null;
  isLoadingEarlier: boolean;
  reload: () => Promise<void>;
  loadEarlierMessagesWithAnchor: () => Promise<void>;
}

/**
 * 解析会话 `metadata_json`；失败或非对象时返回 null（原语义：catch 分支与「无
 * metadataJson」分支都会把 metadata 置 null）。
 *
 * 必须留在模块级：try 内的 `&&` / 三元是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
function parseSessionMetadataOnce(metadataJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 从子会话的 `metadata_json` 解析 teamRoleInstance 的展示名与 personaKey；解析失败返回双 null。
 *
 * 必须留在模块级：try 内的 `&&` / `!Array.isArray(...)` / `typeof` 都是值块，会让编译器报
 * "Support value blocks ... within a try/catch statement" 并放弃优化整个 hook（实测）。
 */
function parseChildRoleInstance(metadataJson: string | null | undefined): {
  displayName: string | null;
  personaKey: string | null;
} {
  if (!metadataJson) {
    return { displayName: null, personaKey: null };
  }
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const metadata = parsed as Record<string, unknown>;
      const roleInstance = metadata['teamRoleInstance'] as Record<string, unknown> | undefined;
      if (roleInstance) {
        return {
          displayName:
            typeof roleInstance['displayName'] === 'string' ? roleInstance['displayName'] : null,
          personaKey:
            typeof roleInstance['personaKey'] === 'string' ? roleInstance['personaKey'] : null,
        };
      }
    }
  } catch {
    // ignore parse errors
  }
  return { displayName: null, personaKey: null };
}

export function useTeamConversationSnapshot(
  options: UseTeamConversationSnapshotOptions,
): UseTeamConversationSnapshotResult {
  const {
    sessionId,
    gatewayUrl,
    token,
    enabled,
    streaming,
    multiAttachActive,
    streamingRef,
    scrollRegionRef,
    setActiveProviderId,
    setActiveModelId,
    setStreaming,
    setStoppingStream,
    setStreamBuffer,
    setStreamThinkingBuffer,
    setStreamThinkingBlocks,
    setStreamingSegments,
    setReportedStreamUsage,
    setStreamError,
    setInput,
    setShowScrollToBottom,
    setHasPendingFollowContent,
  } = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /**
   * 子代理完成通知（网关注入的 `role: 'synthetic'` 消息）。
   * 与 `messages` 同源解析；通知不进 transcript，由渲染层按时间位置插入消息群组之间。
   */
  const [subagentNotices, setSubagentNotices] = useState<SubagentNotice[]>([]);
  const [childSessions, setChildSessions] = useState<
    Array<{ id: string; role_layer?: string | null; messages: ChatMessage[] }>
  >([]);
  const [sessionStateStatus, setSessionStateStatus] = useState<SessionStateStatus | null>(null);
  const [isSessionSnapshotReady, setIsSessionSnapshotReady] = useState(false);
  const [isSessionLoading, setIsSessionLoading] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [sessionTodos, _setSessionTodos] = useState<SessionTodoItem[]>([]);
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);
  const [pendingQuestions, setPendingQuestions] = useState<PendingQuestionRequest[]>([]);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [roleLayer, setRoleLayer] = useState<string | null>(null);
  const [substate, setSubstate] = useState<string | null>(null);
  const [serverTotalTurnCount, setServerTotalTurnCount] = useState<number | null>(null);
  const [sessionMetadata, setSessionMetadata] = useState<Record<string, unknown> | null>(null);
  const [resolvedParentSessionId, setResolvedParentSessionId] = useState<string | null>(null);
  const hasRecoverySnapshotRef = useRef(false);
  const requestedTurnLimitRef = useRef(TEAM_CONVERSATION_INITIAL_TURN_LIMIT);
  const reloadPromiseRef = useRef<{ promise: Promise<void>; sessionId: string | null } | null>(
    null,
  );
  const latestSessionIdRef = useRef<string | null>(sessionId);
  const previousSessionIdRef = useRef<string | null>(sessionId);
  // 渲染期直接写 ref 会被编译器判为 "Cannot update ref during render" 并放弃优化整个 hook，
  // 故改为 effect 同步；读取点都在事件 / 异步回调里（晚于提交）。
  useEffect(() => {
    latestSessionIdRef.current = sessionId;
  }, [sessionId]);
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);
  const { clearRetry, resetRetry, scheduleRetry } = useRecoverableRetryController();

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    publishSessionPendingPermission(sessionId, toSessionPendingPermissionState(pendingPermissions));
  }, [pendingPermissions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }
    publishSessionPendingQuestion(
      sessionId,
      pendingQuestions.find((question) => question.status === 'pending') ?? null,
    );
  }, [pendingQuestions, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    publishSessionRunState(sessionId, resolveSessionSidebarRunState(streaming, sessionStateStatus));

    return () => {
      if (isSessionBusyForSidebar(streaming, sessionStateStatus)) {
        return;
      }
      publishSessionRunState(sessionId, 'idle');
    };
  }, [sessionId, sessionStateStatus, streaming]);

  useEffect(
    () => () => {
      if (!sessionId) {
        return;
      }
      publishSessionPendingPermission(sessionId, null);
      publishSessionPendingQuestion(sessionId, null);
    },
    [sessionId],
  );

  useEffect(() => {
    requestedTurnLimitRef.current = TEAM_CONVERSATION_INITIAL_TURN_LIMIT;
    setServerTotalTurnCount(null);
  }, [sessionId]);

  // `reload` 内部会递归触发自己；直接写 `void reload()` 会被编译器判为
  // "Cannot access variable before it is declared" 并放弃优化整个 hook，故走 ref 间接调用
  // （ref 在下面的 effect 里同步）。
  const reloadRef = useRef<(() => Promise<void>) | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (reloadPromiseRef.current?.sessionId === sessionId) {
      return reloadPromiseRef.current.promise;
    }
    const reloadSessionId = sessionId;

    const reloadPromise = (async () => {
      clearRetry();

      if (!reloadSessionId || !token || !enabled) {
        hasRecoverySnapshotRef.current = false;
        resetRetry();
        setMessages([]);
        setChildSessions([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(false);
        setPendingPermissions([]);
        setPendingQuestions([]);
        setRunEvents([]);
        setRoleLayer(null);
        setSubstate(null);
        setServerTotalTurnCount(null);
        setSessionMetadata(null);
        setSnapshotError(null);
        setIsSessionLoading(false);
        return;
      }

      const hasCachedSnapshot = hasRecoverySnapshotRef.current;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        resetRetry();
        setIsSessionLoading(false);
        setSnapshotError(
          formatTeamConversationRecoveryLoadError({
            hasCachedSnapshot,
            result: {
              errorMessage: '当前网络离线，团队会话快照暂时不可用。',
              retryable: true,
            },
          }),
        );
        return;
      }

      setIsSessionLoading(!hasCachedSnapshot);
      setSnapshotError(null);
      const sessionsClient = createSessionsClient(gatewayUrl);
      const result = await sessionsClient.getRecoveryResult(token, reloadSessionId, {
        messageLimit: requestedTurnLimitRef.current,
        // 这里的 runEvents 只喂 TeamRunEventsPreview（合并文本事件后取最后 8 条），
        // 不参与任何累加重建，因此按有界窗口取即可。省略它会让服务端在会话 running
        // 期间每 2.5s 全量读 + 逐行 JSON.parse + 整包回传本轮 run 的全部 delta 行 ——
        // 而活跃 scope 的行数只增不减（retention 只按 scope 保留，在飞 scope 永不清理），
        // 正是「会话活跃时 /recovery 容易超时」的主因。
        runEventLimit: TEAM_RECOVERY_RUN_EVENT_LIMIT,
      });
      if (reloadSessionId !== latestSessionIdRef.current) {
        return;
      }
      if (!result.ok || !result.recovery) {
        const nextRetryAtMs = scheduleRetry({
          computeDelay: computeTeamConversationRecoveryRetryDelay,
          onRetry: () => {
            // 经 ref 间接调用：`reload` 不能在自己的函数体内引用自己（见上方声明处注释）。
            void reloadRef.current?.();
          },
          retryable: result.retryable,
        });
        if (!hasCachedSnapshot) {
          setIsSessionSnapshotReady(false);
        }
        setIsSessionLoading(false);
        setSnapshotError(
          formatTeamConversationRecoveryLoadError({
            hasCachedSnapshot,
            nextRetryAtMs,
            result,
          }),
        );
        return;
      }

      const recovery = result.recovery;

      const normalized = normalizeChatMessages(recovery.session?.messages ?? []);
      if (!streamingRef.current) {
        setMessages((previous) => reconcileSnapshotChatMessages(previous, normalized));
      }
      setSubagentNotices(collectSubagentNotices(recovery.session?.messages ?? []));

      setChildSessions(
        recovery.children.map((child) => {
          // 从 child.metadata_json 中解析 teamRoleInstance 信息
          // 解析（含 try/catch 与值块）下沉到模块级 `parseChildRoleInstance`。
          const { displayName, personaKey } = parseChildRoleInstance(child.metadata_json);
          return {
            id: child.id,
            role_layer: typeof child.role_layer === 'string' ? child.role_layer : null,
            messages: normalizeChatMessages(child.messages ?? []),
            displayName,
            personaKey,
          };
        }),
      );
      setServerTotalTurnCount(
        typeof recovery.totalTurnCount === 'number' ? recovery.totalTurnCount : null,
      );

      const stateStatus = (recovery.session?.state_status ?? null) as SessionStateStatus | null;
      setSessionStateStatus(stateStatus);
      setIsSessionSnapshotReady(true);

      // L1.8 / L1.3 字段：后端 sessions 表已扩展 role_layer（Phase B），
      // substate 待 L1.3 改造 2 落地。两者都用 unknown cast 读取，缺失时为 null。
      const sessionRow = recovery.session as unknown as Record<string, unknown> | undefined;
      const recoveryParentSessionId =
        typeof sessionRow?.['parentSessionId'] === 'string'
          ? (sessionRow['parentSessionId'] as string)
          : typeof sessionRow?.['team_parent_session_id'] === 'string'
            ? (sessionRow['team_parent_session_id'] as string)
            : null;
      const roleLayerValue =
        typeof sessionRow?.['role_layer'] === 'string'
          ? (sessionRow['role_layer'] as string)
          : null;
      const substateValue =
        typeof sessionRow?.['substate'] === 'string' ? (sessionRow['substate'] as string) : null;
      setRoleLayer(roleLayerValue);
      setSubstate(substateValue);

      // sessions.metadata_json：后端写入的 team session 结构（teamDefinition 等）。
      // 解析失败时不抛错，让消费方按 null 处理；前端只读，不回写不重试。
      const metadataJson =
        typeof sessionRow?.['metadata_json'] === 'string'
          ? (sessionRow['metadata_json'] as string)
          : null;
      // 解析（含 try/catch 与值块）下沉到模块级 `parseSessionMetadataOnce`。
      const parsedMetadata = metadataJson ? parseSessionMetadataOnce(metadataJson) : null;
      setSessionMetadata(parsedMetadata);
      if (parsedMetadata) {
        const metadataProviderId =
          typeof parsedMetadata['providerId'] === 'string' ? parsedMetadata['providerId'] : '';
        const metadataModelId =
          typeof parsedMetadata['modelId'] === 'string' ? parsedMetadata['modelId'] : '';
        if (metadataProviderId && metadataModelId) {
          setActiveProviderId(metadataProviderId);
          setActiveModelId(metadataModelId);
        }
        const metadataParentSessionId =
          typeof parsedMetadata['parentSessionId'] === 'string'
            ? (parsedMetadata['parentSessionId'] as string)
            : null;
        setResolvedParentSessionId(recoveryParentSessionId ?? metadataParentSessionId);
      } else {
        setResolvedParentSessionId(recoveryParentSessionId);
      }

      // pending permissions / questions（来自 recovery，避免再发请求）
      setPendingPermissions(recovery.pendingPermissions ?? []);
      setPendingQuestions(recovery.pendingQuestions ?? []);
      setRunEvents(Array.isArray(recovery.session?.runEvents) ? recovery.session.runEvents : []);
      hasRecoverySnapshotRef.current = true;
      resetRetry();
      setSnapshotError(null);
      setIsSessionLoading(false);
    })();

    reloadPromiseRef.current = { promise: reloadPromise, sessionId: reloadSessionId };
    // 用 `promise.finally()` 取代 try/finally：编译器不支持 finally 子句（会让整个 hook
    // 脱靶）。语义一致——无论成功 / 失败都在结算后清引用，异常照旧向上抛。
    await reloadPromise.finally(() => {
      if (reloadPromiseRef.current?.promise === reloadPromise) {
        reloadPromiseRef.current = null;
      }
    });
    // 补齐编译器推断出的依赖（setter / ref，见 apps/web/AGENTS.md ②）。
  }, [
    clearRetry,
    enabled,
    gatewayUrl,
    resetRetry,
    scheduleRetry,
    sessionId,
    setActiveModelId,
    setActiveProviderId,
    streamingRef,
    token,
  ]);

  // Keep a ref to reload for use in effects that need to trigger a refresh
  // without adding it to their dependency array (avoids re-registration churn).
  // 渲染期直接写 ref 会被编译器判为 "Cannot update ref during render"，故改为 effect 同步。
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  // ─── 加载更早消息（滚动到顶部触发 + 手动按钮） ───────────────────
  // 加载前记录滚动位置，加载后恢复 —— 防止新消息插入顶部后视口跳到底部
  // ref 用于同步防抖，state 用于驱动 UI
  const isLoadingEarlierRef = useRef(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);

  const loadEarlierMessagesWithAnchor = useCallback(async (): Promise<void> => {
    if (isLoadingEarlierRef.current) return;
    isLoadingEarlierRef.current = true;
    setIsLoadingEarlier(true);

    const sr = scrollRegionRef.current;
    const prevScrollHeight = sr?.scrollHeight ?? 0;
    const prevScrollTop = sr?.scrollTop ?? 0;

    requestedTurnLimitRef.current += TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT;
    await reload();

    // 加载完成后恢复滚动位置：新插入的消息高度 = 新 scrollHeight - 旧 scrollHeight
    requestAnimationFrame(() => {
      if (sr) {
        const newScrollHeight = sr.scrollHeight;
        const heightDiff = newScrollHeight - prevScrollHeight;
        sr.scrollTop = prevScrollTop + Math.max(0, heightDiff);
      }
      isLoadingEarlierRef.current = false;
      setIsLoadingEarlier(false);
    });
  }, [reload, scrollRegionRef]);

  // ─── 当 sessionId 变化时自动 reload ─────────────────────────────
  useEffect(() => {
    if (previousSessionIdRef.current === sessionId) {
      return;
    }
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = sessionId;
    // 离开的会话不再需要作废窗口兜底（窗口只服务于当前视图；再次进入会拉权威快照），
    // 只清它自己的 scope，其它会话的窗口保持有效。
    if (previousSessionId) {
      clearRollbackScope(previousSessionId);
    }
    hasRecoverySnapshotRef.current = false;
    setMessages([]);
    setChildSessions([]);
    setSessionStateStatus(null);
    setIsSessionSnapshotReady(false);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setRunEvents([]);
    setRoleLayer(null);
    setSubstate(null);
    setServerTotalTurnCount(null);
    setSessionMetadata(null);
    setResolvedParentSessionId(null);
    setSnapshotError(null);
    // 重置流式状态：session 切换时旧 attach/stream 连接已由 useGatewayClient
    // 内部 closeExistingTransports 关闭，这里同步清理本地 streaming 标记。
    // streamingRef 由调用方创建后作为参数传入（跨 hook 边界的共享 ref 池），直接写 .current
    // 会被编译器判为「修改函数返回值」；写入统一走收敛函数（见 utils/ref/ref-current.ts）。
    writeRefCurrent(streamingRef, false);
    setStreaming(false);
    setStoppingStream(false);
    setStreamBuffer('');
    setStreamThinkingBuffer('');
    setStreamThinkingBlocks([]);
    setStreamingSegments([]);
    setReportedStreamUsage(null);
    setStreamError(null);
    // 重置 composer 输入和滚动状态，防止上一个会话的草稿/滚动位置残留
    setInput('');
    setShowScrollToBottom(false);
    setHasPendingFollowContent(false);
    setIsSessionLoading(Boolean(sessionId && token && enabled));
  }, [enabled, sessionId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    return () => {
      clearRetry();
    };
  }, [clearRetry]);

  useEffect(() => {
    if (!sessionId || !enabled || typeof window === 'undefined') {
      return undefined;
    }
    const handleOnline = () => {
      resetRetry();
      void reload();
    };
    const handleOffline = () => {
      resetRetry();
      setIsSessionLoading(false);
      setSnapshotError(
        formatTeamConversationRecoveryLoadError({
          hasCachedSnapshot: hasRecoverySnapshotRef.current,
          result: {
            errorMessage: '当前网络离线，团队会话快照暂时不可用。',
            retryable: true,
          },
        }),
      );
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled, reload, resetRetry, sessionId]);

  useEffect(() => {
    if (!sessionId || !enabled || !teamEventsRecoveredAt) {
      return;
    }
    resetRetry();
    void reload();
  }, [enabled, reload, resetRetry, sessionId, teamEventsRecoveredAt]);

  // ─── 订阅 team events：reception orchestrator 异步落 ack 消息后，
  //     通过 'session.inbound.submitted' / 'session.substate.changed'
  //     事件通知前端再 reload。也覆盖 handoff completed / failed 之后
  //     pm1 在子 session 写产物完后 reception 端自动刷新。
  //     判定逻辑（按 payload 两端匹配 + 扫整批事件）见 team-event-reload-policy.ts。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    let lastSeenTimestamp = 0;
    const unsub = useTeamNotificationStore.subscribe((state) => {
      const events = state.events;
      if (events.length === 0) return;
      const shouldReload = shouldReloadForTeamEvents({
        events,
        sessionId,
        lastSeenTimestamp,
      });
      lastSeenTimestamp = nextTeamEventWatermark(events, lastSeenTimestamp);
      if (shouldReload) {
        void reload();
      }
    });
    return () => {
      unsub();
    };
  }, [sessionId, enabled, reload]);

  // ─── 从 layer store 实时读取 substate ──────────────────────────────
  // dispatchTeamEvent 收到 session.substate.changed 事件后会实时更新 layer store，
  // 这里订阅 layer store 中当前 session 的 substate，无需等待 HTTP reload。
  // 这让进度条（TeamSubstateProgressBar）能在 substate 变更后立即更新。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    const unsub = useLayerStore.subscribe((state) => {
      const node = state.nodes.get(sessionId);
      if (node?.substate !== undefined) {
        setSubstate(node.substate);
      }
    });
    return () => {
      unsub();
    };
  }, [sessionId, enabled]);

  // ─── 高频 polling：当 session 处于 running 状态时自动刷新 ──────────
  // e/f/g 层用 runSessionInBackground 跑 stream 时，消息实时写入 DB。
  // 前端通过每 2.5s reload 一次来"准实时"看到新消息。
  // 当 session 回到 idle/completed 时停止 polling。
  // **多路 SSE 活跃时跳过轮询**：multi-attach store 的 SSE 连接已提供
  // 逐 token 实时流式，无需再靠轮询拉消息。仅在 multi-attach 未连接时
  // 回退到轮询。P0-2 fix: `multiAttachActive` 在依赖数组中，断开时自动重建轮询。
  useEffect(() => {
    if (!sessionId || !enabled) return undefined;
    if (sessionStateStatus !== 'running') return undefined;
    // 如果多路 SSE 已连接，跳过轮询（effect 会在 multiAttachActive 变化时重新执行）
    if (multiAttachActive) return undefined;
    // 使用 visibility check：只在 tab 可见时 poll
    let active = true;
    const interval = setInterval(() => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      void reload();
    }, 2500);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [sessionId, enabled, sessionStateStatus, reload, multiAttachActive]);

  // ─── 把"当前正在看的这个 session"注册到 layer store ────────────────
  // 「层级流动 / 层级 / 消息」三个 tab 的数据源是 useLayerStore.nodes +
  // useHandoffStore.handoffs，它们靠 /team/runtime 快照 + WS 事件填充。但一个
  // 只做了直答、还没派发任何 handoff 的 reception 会话，快照里可能尚未把它当成
  // 团队节点回灌（或时序上晚于本视图），导致这三个 tab 全空——用户会以为坏了。
  // 这里在会话加载出 roleLayer 后，主动把它 upsert 进 layer store，保证「层级」
  // 视图至少能看到当前这层的节点，handoff 链路一旦展开再由 WS/快照补全。
  useEffect(() => {
    if (!sessionId || !enabled || !roleLayer) return;
    const normalizedRoleLayer = toTeamRoleLayer(roleLayer);
    if (!normalizedRoleLayer) return;
    const existingNode = useLayerStore.getState().nodes.get(sessionId);
    const metadataParentSessionId =
      typeof sessionMetadata?.['parentSessionId'] === 'string'
        ? (sessionMetadata['parentSessionId'] as string)
        : null;
    const parentSessionId =
      resolvedParentSessionId ?? metadataParentSessionId ?? existingNode?.parentSessionId ?? null;
    const rawRoleInstance = sessionMetadata?.['teamRoleInstance'];
    const roleInstance =
      typeof rawRoleInstance === 'object' &&
      rawRoleInstance !== null &&
      !Array.isArray(rawRoleInstance)
        ? (rawRoleInstance as Record<string, unknown>)
        : null;
    const rootSessionId =
      typeof roleInstance?.['rootSessionId'] === 'string' &&
      roleInstance['rootSessionId'].trim().length > 0
        ? roleInstance['rootSessionId'].trim()
        : null;
    const personaKey =
      typeof roleInstance?.['personaKey'] === 'string' &&
      roleInstance['personaKey'].trim().length > 0
        ? roleInstance['personaKey'].trim()
        : null;
    const displayName =
      typeof roleInstance?.['displayName'] === 'string' &&
      roleInstance['displayName'].trim().length > 0
        ? roleInstance['displayName'].trim()
        : null;
    const existing = existingNode;
    // 已存在且核心字段一致就不重复写（避免无谓 set 触发渲染）。
    if (
      existing &&
      existing.roleLayer === roleLayer &&
      existing.parentSessionId === parentSessionId &&
      (existing.rootSessionId ?? null) === rootSessionId &&
      existing.displayName === displayName &&
      existing.personaKey === personaKey
    ) {
      return;
    }
    useLayerStore.getState().addNode({
      sessionId,
      roleLayer: normalizedRoleLayer,
      parentSessionId,
      // 用远端运行状态映射节点状态；未知时给 idle（store 接受 'idle'）。
      state:
        sessionStateStatus === 'running'
          ? 'running'
          : sessionStateStatus === 'paused'
            ? 'claimed'
            : 'idle',
      ...(rootSessionId ? { rootSessionId } : {}),
      ...(personaKey ? { personaKey } : {}),
      ...(displayName ? { displayName } : {}),
      ...(typeof sessionMetadata?.['title'] === 'string'
        ? { title: sessionMetadata['title'] as string }
        : {}),
    });
  }, [sessionId, enabled, roleLayer, resolvedParentSessionId, sessionMetadata, sessionStateStatus]);

  const loadEarlierMessages = useCallback(async (): Promise<void> => {
    requestedTurnLimitRef.current += TEAM_CONVERSATION_LOAD_MORE_TURN_INCREMENT;
    await reload();
  }, [reload]);

  return {
    messages,
    setMessages,
    subagentNotices,
    childSessions,
    setChildSessions,
    sessionStateStatus,
    setSessionStateStatus,
    isSessionSnapshotReady,
    isSessionLoading,
    snapshotError,
    setSnapshotError,
    sessionTodos,
    pendingPermissions,
    setPendingPermissions,
    pendingQuestions,
    setPendingQuestions,
    runEvents,
    setRunEvents,
    roleLayer,
    substate,
    sessionMetadata,
    serverTotalTurnCount,
    isLoadingEarlier,
    reload,
    loadEarlierMessagesWithAnchor,
  };
}
