/**
 * 会话「附着到活跃流 / 恢复」effect 的逻辑体（P3 原样搬家）。
 *
 * 由 `ChatPage` 的 `useEffect` 原位调用：依赖对象在 effect 回调**内部**构造，
 * 保留原有 effect 执行顺序，并避免「后声明的值被急切求值」的 TDZ 问题。
 */
import { evaluateAttachStormGuard } from '../../../components/conversation-runtime/attach/attach-storm-guard.js';
import {
  resolveAttachEffectDisposition,
  shouldAttemptAttachToSession,
  shouldResetAttachAttempt,
} from '../../../components/conversation-runtime/attach/attach-stream-eligibility.js';
import {
  createAttachStreamReconnectWiring,
  type AttachStreamCloseReason,
} from '../../../components/conversation-runtime/attach/attach-stream-reconnect-wiring.js';
import { handleInterruptedAttachStream } from '../../../components/conversation-runtime/attach/attach-stream-reconnect.js';
import type { ScheduleStreamAttachRetryInput } from '../../../components/conversation-runtime/attach/use-stream-attach-retry.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
import type { RightPanelTabId } from '../panels/right-panel-tabs.js';
import {
  applyPermissionDecisionToLocalAssistantMessages,
  applyToolResultToLocalAssistantMessages,
  dismissPermissionEventMessage,
  hasActivePendingPermissionRequest,
  parseToolCallInputText,
  upsertPermissionEventMessage,
} from '../../../components/conversation-runtime/messages/support.js';
import type {
  AssistantTraceToolCall,
  ChatMessage,
  ChatMessagePart,
} from '../../../components/conversation-runtime/messages/support.js';
import { shouldShowRunEventInTranscript } from '../../../components/conversation-runtime/messages/transcript-visibility.js';
import { isAutoAcceptEnabled } from '../../../components/conversation-runtime/session/permission-auto-respond.js';
import {
  createRoundAssistantRequestId,
  resolveNextAssistantRoundIndex,
} from '../../../components/conversation-runtime/stream/round-request-id.js';
import type { RecoveredActiveAssistantStream } from '../../../components/conversation-runtime/stream/stream-recovery.js';
import {
  hasGatewayAdvancedRound,
  resolveNextRoundIndex,
  shouldStartNewRound,
} from '../../../components/conversation-runtime/stream/stream-round-boundary.js';
import { mergeChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import {
  appendStreamingTextDelta,
  appendStreamingThinkingDelta,
  applyToolProgressToStreamingSegment,
  markStreamingReasoningSegmentEnded,
  upsertStreamingToolSegment,
} from '../../../components/conversation-runtime/stream/streaming-segments.js';
import {
  appendStreamingThinkingChunk,
  buildStreamingThinkingChunkDeliveryKey,
  joinStreamingThinkingTexts,
  markStreamingThinkingChunkEnded,
} from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import type { UseSessionTerminalsResult } from '../../../components/conversation-runtime/terminals/use-session-terminals.js';
import {
  formatGatewayStreamErrorMessage,
  useGatewayClient,
} from '../../../hooks/gateway/useGatewayClient.js';
import type { ChatSettingsModel } from '../../../utils/chat/chat-session-defaults.js';
import { logger } from '../../../utils/log/logger.js';
import { resolveStreamTerminalStatus } from '../state/resolve-stream-terminal-status.js';
import { replyPermissionRequest } from '../../../utils/permission/permission-reply.js';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
} from '../../../utils/session/session-list-events.js';
import {
  applySessionChildRuntimeEvent,
  applyTaskUpdateRuntimeEvent,
} from '.././conversation/render/apply-session-runtime-event.js';
import {
  applyStreamToolProgress,
  applyStreamToolResult,
} from '.././conversation/render/apply-stream-tool-event.js';
import { buildStreamAssistantTrace } from '.././conversation/render/build-stream-assistant-trace.js';
import { isImmediatelyRenderableStructuredContent } from '.././conversation/render/chat-page-utils.js';
import type { LiveToolCallState } from '.././conversation/render/chat-page-utils.js';
import { commitStreamingRound } from '.././conversation/render/commit-streaming-round.js';
import { detectTerminalDevServer } from '.././conversation/render/detect-terminal-dev-server.js';
import { finalizeStreamMessage } from '.././conversation/render/finalize-stream-message.js';
import { handlePendingInteractionEvent } from '.././conversation/render/handle-pending-interaction-event.js';
import {
  applyChatRightPanelChunk,
  applyChatRightPanelEvent,
  clearResolvedPendingPermissionToolCalls,
} from '.././state/chat-stream-state.js';
import type { ChatRightPanelState } from '.././state/chat-stream-state.js';
import type {
  PendingPermissionRequest,
  RunEvent,
  UpstreamRouteDescriptor,
  UpstreamStreamSummary,
} from '@openAwork/shared';
import {
  createPendingPermissionRequestSnapshot,
  createClientErrorReporter,
  createSessionsClient,
  dedupePendingPermissionRequests,
  isClientSyntheticStreamErrorCode,
} from '@openAwork/web-client';
import type {
  PendingQuestionRequest,
  Session,
  SessionActiveStream,
  SessionTask,
} from '@openAwork/web-client';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

/**
 * attach 风暴熔断：固定窗口内的绝对次数上限。
 *
 * 不能用「两次间隔是否够长」来重置计数：重连退避是 400ms + 网络往返 + 快照加载，
 * 单轮很容易超过 2s，一重置就永远熔断不了（上一版就是这么失效的）。窗口过期才清零，
 * 保证最坏情况下循环也在有限次数内停住。
 */
const ATTACH_STORM_WINDOW_MS = 60_000;
const ATTACH_STORM_MAX_ATTEMPTS = 10;
/**
 * 连续多少次重连时 `lastSeq` 完全没有前进，就判定流已僵死并停止重连。
 *
 * 正常流式期间每次断开前都会有新事件（`lastSeq` 前进），计数会被重置；只有
 * 「网关报活跃、SSE 打开即结束」的僵死状态才会连续命中。
 */
/**
 * 反复中断时的重连退避序列。
 *
 * 与 `SILENT_CLOSE_RETRY_DELAYS_MS` 的区别：这里对应的是「attach 建立过、收到过事件、
 * 又断开」——即连接**真的建立过又掉了**，比 0 事件的等待更可疑，因此起步更慢
 * （800ms）以便尽快恢复，同时逐级退避，避免退化成高频循环。
 *
 * 关键点：退避基数**不能**依赖 `useStreamAttachRetry` 内部的 `retryAttemptRef`——
 * 它会在每次 attach 成功后被 `cancelAttachRetry()` 清零，于是「成功 → 又断开」
 * 永远是第一次尝试、恒定 400ms，并在每轮全量重载快照。这就是页面卡死的成因之一，
 * 也是本页最初的故障现象。
 */
export const DISCONNECT_RETRY_DELAYS_MS = [
  800, 1_600, 3_200, 6_400, 12_800, 25_600, 30_000,
] as const;

export function resolveDisconnectRetryDelayMs(disconnects: number): number {
  const index = Math.min(Math.max(disconnects - 1, 0), DISCONNECT_RETRY_DELAYS_MS.length - 1);
  return DISCONNECT_RETRY_DELAYS_MS[index]!;
}

/**
 * 连接至少稳定存活该时长，才认为「上次的中断是偶发」，允许把失败计数归零。
 *
 * 立刻归零会让「秒断」场景退回固定 400ms 循环；永，归零则一次网络抖动后要等很久
 * 才能恢复正常。30s 是权衡点：超过它才认为这条连接真的稳定过。
 */
const STABLE_ATTACH_WINDOW_MS = 30_000;

/**
 * 等待新输出时的退避序列。
 *
 * 工具执行（bash / mcp / 长思考）期间网关不产生 run event，attach 只会「打开 → 0
 * 事件 → EOF」。此时应低频重挂等待，而不是高频重连：每轮重连都会清空流缓冲并全量
 * 重载一次会话快照，工具跑得越久卡顿越明显。
 *
 * 封顶 10s（不是 30s）：每次尝试的开销只是「一次活跃流查询 + 一次 SSE 建连」，
 * 不含快照重载，10s 一次完全可以承受；而工具一旦结束，输出最迟 10s 内就能接上。
 */
export const SILENT_CLOSE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 10_000] as const;

export function resolveSilentCloseRetryDelayMs(silentCloses: number): number {
  const index = Math.min(Math.max(silentCloses - 1, 0), SILENT_CLOSE_RETRY_DELAYS_MS.length - 1);
  return SILENT_CLOSE_RETRY_DELAYS_MS[index]!;
}

/**
 * attach 连续性状态：跨 effect 运行持久，用于识别「无进展」的重连循环。
 */
export interface AttachProgressState {
  /** 上次记录归属的会话。 */
  sessionId: string | null;
  /** 上次确认到的服务端事件游标。 */
  lastSeq: number;
  /** 连续「打开后 0 事件」的次数。 */
  silentCloses: number;
  /** 连续「游标没有前进」的重连次数。 */
  stalledReconnects: number;
  /**
   * 连续「attach 建立后又断开」的次数。
   *
   * **不因 attach 成功而清零**：只有连接稳定存活 `STABLE_ATTACH_WINDOW_MS` 后才归零
   * （见 `handleAttachReconnect`）。否则秒断场景会退回固定 400ms 循环。
   */
  disconnects: number;
  /** 本次 attach 建立连接的时刻，用于判断连接是否稳定存活过。 */
  attachedAt: number;
}

export function createInitialAttachProgressState(): AttachProgressState {
  return {
    attachedAt: 0,
    disconnects: 0,
    lastSeq: -1,
    sessionId: null,
    silentCloses: 0,
    stalledReconnects: 0,
  };
}

export interface SessionAttachDeps {
  readonly activeGatewayStreamSessionId: string | null;
  readonly activeModelOption: ChatSettingsModel | undefined;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly activeStreamStartedAt: number | null;
  readonly appendAssistantEventMessages: (
    events: RunEvent[],
    options?: { excludeCompaction?: boolean | undefined } | undefined,
  ) => void;
  readonly attachAttemptedSessionRef: RefObject<string | null>;
  /**
   * attach 重连风暴熔断窗口：固定时间窗内允许的自动 attach 次数。
   *
   * 见 `ChatPage` 里该 ref 的说明。超限后停止自动 attach 并给出明确错误，避免
   * 「attach → 断开 → 重置 → 再 attach」的无限循环把主线程占满、页面卡死。
   */
  readonly attachAttemptWindowRef: RefObject<{
    startedAt: number;
    count: number;
    sessionId: string | null;
  }>;
  /**
   * attach 的「无进展」检测状态：网关可能长期返回已僵死的活跃流快照，此时
   * `lastSeq` 不再前进、SSE 打开即结束。连续多次重连没有任何进展，就应停止
   * 重连并收敛，而不是无限重建传输。见 `AttachProgressState`。
   */
  readonly attachProgressRef: MutableRefObject<AttachProgressState>;
  /**
   * 已做过「终态收尾」的会话 id。
   *
   * attach effect 会因流式状态高频重跑，而终态分支里的 `loadCurrentSessionSnapshot`
   * 是全量快照（getRecovery + normalize + setMessages）。没有这个去重，抖动期间
   * 会一轮接一轮地跑数百毫秒的长任务，直接表现为页面卡死。
   */
  readonly attachTerminalReloadRef: MutableRefObject<string | null>;
  readonly attachEligibilitySignatureRef: RefObject<string | null>;
  /**
   * 当前已建立 attach 传输的会话 id；无 attach 在途时为 null。
   *
   * 必须与 `attachAttemptedSessionRef` 分开：后者在重试调度、终态复位等
   * 路径上会被置空，无法表达「传输仍属于哪个会话」。cleanup 需要据此判断
   * 「本次 effect 重跑只是 token delta」还是「用户真的切走了会话」——前者
   * 必须保留传输，后者必须掐断它。
   */
  readonly attachOwnerSessionIdRef: RefObject<string | null>;
  readonly attachRetryExhausted: boolean;
  readonly attachRetryScheduledSessionId: string | null;
  readonly cancelAttachRetry: () => void;
  readonly client: ReturnType<typeof useGatewayClient>;
  readonly currentAssistantStreamMessageIdRef: MutableRefObject<string | null>;
  readonly currentSessionId: string | null;
  readonly currentSessionViewRef: MutableRefObject<{ epoch: number; sessionId: string | null }>;
  readonly devServerDetectedTerminalIdsRef: RefObject<Set<string>>;
  readonly effectiveAgentId: string | undefined;
  readonly effectiveModelId: string;
  readonly effectiveProviderId: string;
  readonly gatewayUrl: string;
  readonly isCurrentSessionRequest: (targetSessionId: string, expectedEpoch: number) => boolean;
  readonly isFollowingRef: MutableRefObject<boolean>;
  readonly isPageActive: boolean;
  readonly isSessionSnapshotReady: boolean;
  readonly lastAttachAttemptTimestampRef: RefObject<number>;
  readonly loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?:
      | {
          expectedSessionViewEpoch?: number | undefined;
          messageLimit?: number | undefined;
          replaceMessages?: boolean | undefined;
          signal?: AbortSignal | undefined;
          since?: number | undefined;
        }
      | undefined,
  ) => Promise<void>;
  readonly loadPendingQuestionForSession: (
    targetSessionId: string,
    requestId: string,
  ) => Promise<void>;
  /**
   * 已提交消息的 ref 镜像。attach 需要从**已落库的历史**反推续跑轮次
   * （`resolveNextAssistantRoundIndex`）——提问 / 审批暂停时 `/recovery` 的
   * `runEvents` 为空，恢复快照可能是若干轮之前的旧值，只按它推会铸出与历史
   * 同键的 `clientRequestId`，本地副本在判重时顶掉旧槽位导致顺序漂移。
   */
  readonly messagesRef: RefObject<ChatMessage[]>;
  readonly pendingStreamRevealFrameRef: MutableRefObject<number | null>;
  readonly prefersReducedMotion: boolean;
  readonly recoveredStreamSnapshot: RecoveredActiveAssistantStream | null;
  readonly recoveryActiveStream: SessionActiveStream | null;
  readonly resetStreamState: () => void;
  readonly resolveAssistantCapabilityKind: (toolName: string) => AssistantTraceToolCall['kind'];
  readonly rightOpenRef: MutableRefObject<boolean>;
  readonly scheduleAttachRetry: (input: ScheduleStreamAttachRetryInput) => void;
  readonly scheduleStreamReveal: (opts: { prefersReducedMotion: boolean }) => void;
  readonly sessionModesHydrated: boolean;
  readonly sessionStateStatus: 'idle' | 'running' | 'paused' | null | undefined;
  readonly sessionTerminals: UseSessionTerminalsResult;
  readonly setActiveStreamFirstTokenLatencyMs: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamRoundStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly setActiveStreamStartedAt: Dispatch<SetStateAction<number | null>>;
  readonly setBrowserPreviewUrl: (url: string | null) => void;
  readonly setChildSessions: Dispatch<SetStateAction<Session[]>>;
  readonly setEditorMode: (v: boolean) => void;
  readonly setHasPendingFollowContent: Dispatch<SetStateAction<boolean>>;
  readonly setLatestUpstreamSummary: Dispatch<SetStateAction<UpstreamStreamSummary | null>>;
  readonly setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  readonly setPendingPermissions: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  readonly setPendingQuestions: Dispatch<SetStateAction<PendingQuestionRequest[]>>;
  readonly setRecoveredStreamSnapshot: Dispatch<
    SetStateAction<RecoveredActiveAssistantStream | null>
  >;
  readonly setReportedStreamUsage: Dispatch<SetStateAction<ChatBackendUsageSnapshot | null>>;
  readonly setRightPanelState: Dispatch<SetStateAction<ChatRightPanelState>>;
  readonly setRightTab: Dispatch<SetStateAction<RightPanelTabId>>;
  readonly setSessionStateStatus: Dispatch<
    SetStateAction<'idle' | 'running' | 'paused' | null | undefined>
  >;
  readonly setSessionTasks: Dispatch<SetStateAction<SessionTask[]>>;
  readonly setStoppingStream: Dispatch<SetStateAction<boolean>>;
  readonly setStreamBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreamError: (action: SetStateAction<string | null>) => void;
  readonly setStreamThinkingBlocks: Dispatch<SetStateAction<StreamingThinkingBlock[]>>;
  readonly setStreamThinkingBuffer: Dispatch<SetStateAction<string>>;
  readonly setStreaming: Dispatch<SetStateAction<boolean>>;
  readonly setStreamingSegments: Dispatch<SetStateAction<ChatMessagePart[]>>;
  readonly stoppingStreamRef: MutableRefObject<boolean>;
  readonly streamRevealNextAllowedAtRef: MutableRefObject<number>;
  readonly streamRevealTargetCodePointsRef: MutableRefObject<string[]>;
  readonly streamRevealTargetRef: MutableRefObject<string>;
  readonly streamRevealVisibleCodePointCountRef: MutableRefObject<number>;
  readonly streamRevealVisibleRef: MutableRefObject<string>;
  readonly streaming: boolean;
  readonly streamingRef: MutableRefObject<boolean>;
  readonly token: string | null;
  readonly visibleLatestUpstreamSummary: UpstreamStreamSummary | null;
  readonly INITIAL_TURN_LIMIT: 10;
}

export function runSessionAttachEffect(deps: SessionAttachDeps): (() => void) | void {
  const {
    activeGatewayStreamSessionId,
    activeModelOption,
    activeSessionRef,
    activeStreamStartedAt,
    appendAssistantEventMessages,
    attachAttemptedSessionRef,
    attachAttemptWindowRef,
    attachProgressRef,
    attachTerminalReloadRef,
    attachEligibilitySignatureRef,
    attachOwnerSessionIdRef,
    attachRetryExhausted,
    attachRetryScheduledSessionId,
    cancelAttachRetry,
    client,
    currentAssistantStreamMessageIdRef,
    currentSessionId,
    currentSessionViewRef,
    devServerDetectedTerminalIdsRef,
    effectiveAgentId,
    effectiveModelId,
    effectiveProviderId,
    gatewayUrl,
    isCurrentSessionRequest,
    isFollowingRef,
    isPageActive,
    isSessionSnapshotReady,
    lastAttachAttemptTimestampRef,
    loadCurrentSessionSnapshot,
    loadPendingQuestionForSession,
    messagesRef,
    pendingStreamRevealFrameRef,
    prefersReducedMotion,
    recoveredStreamSnapshot,
    recoveryActiveStream,
    resetStreamState,
    resolveAssistantCapabilityKind,
    rightOpenRef,
    scheduleAttachRetry,
    scheduleStreamReveal,
    sessionModesHydrated,
    sessionStateStatus,
    sessionTerminals,
    setActiveStreamFirstTokenLatencyMs,
    setActiveStreamRoundStartedAt,
    setActiveStreamStartedAt,
    setBrowserPreviewUrl,
    setChildSessions,
    setEditorMode,
    setHasPendingFollowContent,
    setLatestUpstreamSummary,
    setMessages,
    setPendingPermissions,
    setPendingQuestions,
    setRecoveredStreamSnapshot,
    setReportedStreamUsage,
    setRightPanelState,
    setRightTab,
    setSessionStateStatus,
    setSessionTasks,
    setStoppingStream,
    setStreamBuffer,
    setStreamError,
    setStreamThinkingBlocks,
    setStreamThinkingBuffer,
    setStreaming,
    setStreamingSegments,
    stoppingStreamRef,
    streamRevealNextAllowedAtRef,
    streamRevealTargetCodePointsRef,
    streamRevealTargetRef,
    streamRevealVisibleCodePointCountRef,
    streamRevealVisibleRef,
    streaming,
    streamingRef,
    token,
    visibleLatestUpstreamSummary,
    INITIAL_TURN_LIMIT,
  } = deps;

  const attachEligibility = {
    activeGatewayStreamSessionId,
    currentSessionId,
    isPageActive,
    isSessionSnapshotReady,
    recoveryActiveStreamPresent: recoveryActiveStream !== null,
    sessionModesHydrated,
    sessionStateStatus,
    streaming: streaming || streamingRef.current,
  };
  const shouldAttemptAttach = shouldAttemptAttachToSession(attachEligibility);
  // The effect re-runs on every token delta because `streaming` /
  // `sessionStateStatus` mutate frequently, so log only when the decision
  // surface actually changes — otherwise the console becomes unreadable
  // during normal streams. Track the last signature on the ref attached
  // earlier in this component instead of allocating a new ref per render.
  const eligibilitySignature = `${currentSessionId ?? 'none'}|${shouldAttemptAttach ? 1 : 0}|${attachEligibility.sessionStateStatus ?? 'null'}|${attachEligibility.streaming ? 1 : 0}|${attachEligibility.recoveryActiveStreamPresent ? 1 : 0}|${attachEligibility.activeGatewayStreamSessionId ?? 'null'}|${attachEligibility.isSessionSnapshotReady ? 1 : 0}|${attachEligibility.sessionModesHydrated ? 1 : 0}|${attachEligibility.isPageActive ? 1 : 0}|${attachAttemptedSessionRef.current ?? 'none'}`;
  if (attachEligibilitySignatureRef.current !== eligibilitySignature) {
    attachEligibilitySignatureRef.current = eligibilitySignature;
    console.log('[ATTACH_ELIGIBILITY]', currentSessionId, {
      shouldAttemptAttach,
      ...attachEligibility,
      attachAttempted: attachAttemptedSessionRef.current,
    });
  }

  /**
   * 本次 effect 运行的清理：只在「用户真的切走了会话」时掐断 attach 传输。
   *
   * 本 effect 因 token delta 高频重跑（`streaming` / `sessionStateStatus`
   * 每次变更都触发），因此 cleanup **不能** 无条件关闭传输 —— 否则流式进行中
   * 会被自己反复掐断。判据是传输归属的会话（`attachOwnerSessionIdRef`，
   * 跨运行持久的 ref）与本次运行的 `currentSessionId` 是否一致：
   *
   * - 一致 → 只是 delta 引发的重跑，传输保留
   * - 不一致 → 切走了会话，旧 EventSource 必须关闭
   *
   * 此前该 effect 的所有出口都是 `return;`，从不返回 cleanup，导致切到
   * 不需要 attach 的会话时旧 SSE 永久泄漏，并继续触发
   * `requestSessionListRefresh()` 造成「幽灵 /sessions」。
   */
  const cleanupAttachTransport = () => {
    const ownerSessionId = attachOwnerSessionIdRef.current;
    if (ownerSessionId === null) {
      return;
    }
    // 判据必须是「当前视图会话」而不是本次 effect run 的闭包值：切走时先执行的是
    // 旧 run 的 cleanup，此时闭包里的 `currentSessionId` 仍是旧会话，会把「已切走」
    // 误判成「没切走」而漏关旧 SSE——它的 onerror / onDone 迟到回调正是污染新会话
    // 的入口。
    if (ownerSessionId === currentSessionViewRef.current.sessionId) {
      return;
    }
    attachOwnerSessionIdRef.current = null;
    client.closeTransports();
  };

  /**
   * 释放「本地活跃流提示」与权威状态之间的矛盾态。
   *
   * `activeGatewayStreamSessionId` 是客户端快照（跨刷新存于 sessionStorage），
   * 而会话已被权威判为 `idle`、网关也没有 activeStream——这个提示就是陈旧的。
   * 不释放的话它会一直把 `shouldAttemptAttachToSession` 的第三个条件点亮，
   * 于是每次 effect 重跑都「attach → 网关回无活跃流 → settleAsEnded → 全量重拉」，
   * 对已停止的会话表现为「放着不动界面自己刷新」。
   *
   * 硬失败的 attach 已经在 `settleAsEnded()` 里清过；这里补的是**走了 skip 分支**
   * （因新准入条件而不再 attach）的那一类——否则陈旧键会一直留在 sessionStorage 里。
   * 只清属于本会话的快照：client 是组件级单例，别的会话的现场不能碰。
   */
  const releaseStaleActiveStreamHint = () => {
    if (activeGatewayStreamSessionId === null) {
      return;
    }
    if (activeGatewayStreamSessionId !== currentSessionId) {
      return;
    }
    if (sessionStateStatus !== 'idle' || recoveryActiveStream !== null) {
      return;
    }
    if (client.getActiveStreamSessionId() !== currentSessionId) {
      return;
    }
    client.clearActiveStreamSnapshot();
  };

  switch (
    resolveAttachEffectDisposition({
      eligibility: attachEligibility,
      retryScheduledSessionId: attachRetryScheduledSessionId,
      retryExhausted: attachRetryExhausted,
    })
  ) {
    case 'terminal': {
      cancelAttachRetry();
      setStreamError(null);
      // 终态收尾只需一次。该 effect 会因 `streaming` / `sessionStateStatus` 频繁
      // 重跑，若每次都 `loadCurrentSessionSnapshot`（全量 getRecovery + normalize +
      // setMessages），在 attach 抖动期间就是一轮接一轮的数百毫秒长任务——这是
      // 「页面卡死」里最容易观察到的重复开销之一。
      if (currentSessionId && attachTerminalReloadRef.current !== currentSessionId) {
        attachTerminalReloadRef.current = currentSessionId;
        // 刻意不用 `replaceMessages`：收尾时上游可能**还没把这一轮的消息持久化完**，
        // 整体替换会把刚渲染出来的用户消息与助手回复一起覆盖成一份更短的历史，
        // 界面直接变空，且此后不会再触发加载——只能刷新或切会话才恢复。
        // 走 loader 的 reconcile 路径：服务端更完整时合并，缺少时保留本地。
        void loadCurrentSessionSnapshot(currentSessionId, {
          expectedSessionViewEpoch: currentSessionViewRef.current.epoch,
          messageLimit: INITIAL_TURN_LIMIT,
        }).catch(() => undefined);
      }
      return cleanupAttachTransport;
    }

    case 'cancel_retry': {
      cancelAttachRetry();
      attachAttemptedSessionRef.current = null;
      return cleanupAttachTransport;
    }

    case 'skip': {
      // 只在会话切换时重置 attach 标记，避免同一会话内重复触发 attach
      // 额外保护：如果上次 attach 尝试在 10 秒内，不要重置（防止 attach 刚完成就被重置导致重复触发）
      const timeSinceLastAttach = Date.now() - lastAttachAttemptTimestampRef.current;
      if (
        shouldResetAttachAttempt(attachEligibility) &&
        attachAttemptedSessionRef.current !== currentSessionId &&
        timeSinceLastAttach > 10000
      ) {
        attachAttemptedSessionRef.current = null;
      }
      releaseStaleActiveStreamHint();
      return cleanupAttachTransport;
    }

    case 'proceed':
      break;
  }

  // proceed 分支由 shouldAttemptAttachToSession 保证，此处仅为类型收窄。
  if (!currentSessionId) {
    return cleanupAttachTransport;
  }

  // 换了会话必须重置熔断窗口：否则 A 触发熔断后切到 B，B 会在窗口剩余的几十秒内
  // 被直接判定为风暴并「永久无法 attach」，表现为切过去的会话卡住不出内容。
  // 判据用窗口自带的归属会话，不能借用 `attachAttemptedSessionRef`——重试路径会
  // 把它清空，那样每轮重试都会重置窗口，熔断又永远不触发。
  if (attachAttemptWindowRef.current.sessionId !== currentSessionId) {
    attachAttemptWindowRef.current = {
      count: 0,
      sessionId: currentSessionId,
      startedAt: 0,
    };
  }

  if (attachAttemptedSessionRef.current === currentSessionId) {
    return cleanupAttachTransport;
  }

  // 如果本地流式刚开始（2秒内），阻止 attach 触发，避免覆盖本地刚添加的用户消息。
  // 这个保护确保用户发送第一条消息后，本地状态有足够时间稳定，不会被 attach 流程覆盖。
  if (activeStreamStartedAt !== null && Date.now() - activeStreamStartedAt < 2000) {
    return cleanupAttachTransport;
  }

  // ── 重连风暴熔断（固定窗口 + 绝对次数）─────────────────────────────
  // 「attach 成功 → 断开 → 重置 → 再 attach」一旦自激，就会无限关闭/重建传输、
  // 重放事件、甚至全量重载快照，几秒内占满主线程、页面卡死。窗口内超过上限即停止
  // 自动重连并明确报错，把「无限循环」降级为「有界重试 + 可操作页面」。
  const attachNow = Date.now();
  const attemptWindow = attachAttemptWindowRef.current;
  const stormGuard = evaluateAttachStormGuard({
    attemptsInWindow: attemptWindow.count,
    maxAttempts: ATTACH_STORM_MAX_ATTEMPTS,
    now: attachNow,
    windowMs: ATTACH_STORM_WINDOW_MS,
    windowStartedAt: attemptWindow.startedAt,
  });
  attemptWindow.count = stormGuard.attemptsInWindow;
  attemptWindow.startedAt = stormGuard.windowStartedAt;
  // **只记录，不再中止重连。**
  //
  // 曾经的「熔断」在这里 return 并弹「连接反复中断，已暂停自动重连」，但它的两个
  // 终止条件都会自己被绕过：循环本身会把 `sessionStateStatus` 置成 `running`（于是
  // running 豁免让它永不触发），而每次 attach 成功都会 `cancelAttachRetry()` 重置重试
  // 计数（于是 8 次上限也永达不到）。结果是它既挡不住真正的死循环，又会在工具执行
  // 期间误伤正常等待。
  //
  // 现在把「不产生高频循环」这件事完全交给退避（silent 1s→10s、disconnect 800ms→30s，
  // 两者的频率上限都 ≤1 次/10s），主线程不会被占用；而重连永远保持可用，工具跑完
  // 一定能接上。真正结束时网关会返回「无活跃流」，走 `settleAsEnded()` 正常收敛。
  // 仅在「刚好跨过阈值」时打一次，避免高频循环把控制台刷爆。
  if (!stormGuard.allowed && attemptWindow.count === ATTACH_STORM_MAX_ATTEMPTS + 1) {
    console.warn('[ATTACH] high attach rate, continuing with backoff', {
      attemptsInWindow: attemptWindow.count,
      sessionId: currentSessionId,
      windowMs: ATTACH_STORM_WINDOW_MS,
    });
  }

  attachAttemptedSessionRef.current = currentSessionId;
  attachTerminalReloadRef.current = null;
  lastAttachAttemptTimestampRef.current = Date.now();
  console.log('[ATTACH_ELIGIBILITY] proceeding with attach for', currentSessionId);

  const sid = currentSessionId;
  // 传输归属登记：cleanup 依赖它区分「delta 重跑」与「切走会话」。
  attachOwnerSessionIdRef.current = sid;
  const attachSessionViewEpoch = currentSessionViewRef.current.epoch;
  const initialText = recoveredStreamSnapshot?.text ?? '';
  const initialThinkingBlocks = recoveredStreamSnapshot?.thinkingBlocks ?? [];
  const initialThinking = joinStreamingThinkingTexts(initialThinkingBlocks);
  const initialUsage = recoveredStreamSnapshot?.usage ?? null;
  const requestStartedAt = recoveredStreamSnapshot?.startedAt ?? Date.now();
  const requestProviderId = effectiveProviderId || undefined;
  const requestModelLabel = (activeModelOption?.label ?? effectiveModelId) || undefined;
  const requestAgentId = effectiveAgentId || undefined;
  // attach 连接建立后从 gatewayClient 读取本次活跃流的 rid；提交闭包在事件
  // 到达时才执行，因此先声明、attach resolve 后赋值。
  let attachStreamClientRequestId: string | null = null;
  // 与主链路一致：客户端合成的传输错误在网关侧没有记录，靠 best-effort 上报
  // 补一条 `status='error'` 消息，否则刷新页面后 attach 期间的错误会消失。
  const clientErrorReporter = createClientErrorReporter(gatewayUrl);
  const reportClientSideStreamError = (
    code: string,
    resolvedMessage: string,
    technicalDetail: string | undefined,
  ): void => {
    if (!token || !isClientSyntheticStreamErrorCode(code)) return;
    const clientRequestId = attachStreamClientRequestId;
    if (!clientRequestId) return;
    void clientErrorReporter
      .reportClientStreamError(token, {
        clientRequestId,
        code,
        message: resolvedMessage,
        sessionId: sid,
        ...(technicalDetail ? { technicalDetail } : {}),
      })
      .then((result) => {
        if (!result.ok) {
          logger.warn(
            'attach stream error report failed',
            `${code}: ${result.errorMessage ?? '未知原因'}`,
          );
        }
      });
  };
  const recoveredModifiedFilesSummary = recoveredStreamSnapshot?.modifiedFilesSummary;
  const requestTextCodePoints = Array.from(initialText);
  let attachStateInitialized = false;
  let accumulated = initialText;
  let accumulatedThinking = initialThinking;
  let accumulatedThinkingBlocks = initialThinkingBlocks;
  let accumulatedUsage = initialUsage;
  // Mirror the live-stream path: keep a wire-faithful ordered segment list
  // so attach-rendered messages preserve the same reasoning/text/tool
  // interleaving as the gateway recorded. Initial value is empty because
  // the recovery snapshot's reasoning/text/toolCalls are reconstructed via
  // ensureAttachStateInitialized below.
  let accumulatedSegments: ChatMessagePart[] = [];
  // 轮次边界状态：恢复快照里的 usage.round 属于「已完成的轮次」，因此当前正在
  // 累积的是它的下一轮。
  let lastCompletedRoundIndex: number | null = initialUsage?.round ?? null;
  let currentRoundIndex = (lastCompletedRoundIndex ?? 0) + 1;
  /**
   * 提交本轮时实际使用的轮次号。
   *
   * 不能只信 `currentRoundIndex`：AskUserQuestion / 审批暂停会把 runtime thread
   * 清掉，`/recovery` 的 `runEvents` 随之为空，恢复快照可能是**若干轮之前**的旧值
   * （`initialUsage.round` 偏小）。按它推出来的轮次会与历史里已存在的某一轮**同键**，
   * 本地提交的那条随即在 `deduplicateOverlappingMessages` 里被当成同一回合并顶掉
   * 旧槽位 —— 用户看到的就是「历史消息相对顺序变化」。
   *
   * 因此提交时再从已落库消息里反推一次（与网关 `deriveResumeRound` 同一语义），
   * 取两者较大值：既不重复历史轮次，也不回退已推进的本地轮次。
   */
  const resolveCommitRoundIndex = (): number => {
    const fallbackRound = Math.max((lastCompletedRoundIndex ?? 0) + 1, currentRoundIndex);
    const requestId = attachStreamClientRequestId;
    if (!requestId) {
      return fallbackRound;
    }
    return resolveNextAssistantRoundIndex({
      clientRequestId: requestId,
      fallbackRound,
      messages: messagesRef.current,
    });
  };
  const reasoningSegmentMeta = new Map<string, { blockKey: string }>();
  let pendingThinkingFlushFrame: number | null = null;
  let pendingSegmentsFlushFrame: number | null = null;
  const flushThinkingState = () => {
    pendingThinkingFlushFrame = null;
    // Late RAF after attach was torn down (session switch / cancel /
    // round-close) must not overwrite the cleared buffer with stale text.
    if (!streamingRef.current || !isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
      return;
    }
    setStreamThinkingBlocks(accumulatedThinkingBlocks);
    setStreamThinkingBuffer(accumulatedThinking);
  };
  const scheduleThinkingFlush = () => {
    if (pendingThinkingFlushFrame !== null) return;
    pendingThinkingFlushFrame = window.requestAnimationFrame(flushThinkingState);
  };
  const cancelThinkingFlush = () => {
    if (pendingThinkingFlushFrame !== null) {
      window.cancelAnimationFrame(pendingThinkingFlushFrame);
      pendingThinkingFlushFrame = null;
    }
  };
  const flushSegmentsState = () => {
    pendingSegmentsFlushFrame = null;
    if (!streamingRef.current || !isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
      return;
    }
    setStreamingSegments(accumulatedSegments);
  };
  const scheduleSegmentsFlush = () => {
    if (pendingSegmentsFlushFrame !== null) return;
    pendingSegmentsFlushFrame = window.requestAnimationFrame(flushSegmentsState);
  };
  const cancelSegmentsFlush = () => {
    if (pendingSegmentsFlushFrame !== null) {
      window.cancelAnimationFrame(pendingSegmentsFlushFrame);
      pendingSegmentsFlushFrame = null;
    }
  };
  let firstTokenObservedAt: number | null = null;
  const deliveredAttachThinkingChunkKeys = new Set<string>();
  let pausedForPermission = false;
  let pausedForQuestion = false;
  let latestUpstreamRoute: UpstreamRouteDescriptor | null =
    recoveredStreamSnapshot?.upstreamRoute ?? null;
  let latestRoundUpstreamSummary: UpstreamStreamSummary | null = null;
  let currentRoundStartedAt = requestStartedAt;
  let firstTokenLatencyAttached = false;
  const resolveRoundModelLabel = (summary?: UpstreamStreamSummary | null): string | undefined =>
    summary?.modelId ?? latestUpstreamRoute?.modelId ?? requestModelLabel;
  const resolveRoundProviderId = (summary?: UpstreamStreamSummary | null): string | undefined =>
    summary?.providerId ?? latestUpstreamRoute?.providerId ?? requestProviderId;
  const toolCallIds = new Set<string>();
  const liveToolCalls = new Map<string, LiveToolCallState>();
  let attachStreamTerminalized = false;
  const buildAttachToolCalls = (): AssistantTraceToolCall[] => {
    return Array.from(liveToolCalls.values()).map((toolCallState) => {
      const hasPendingPermission = hasActivePendingPermissionRequest({
        isError: toolCallState.isError,
        pendingPermissionRequestId: toolCallState.pendingPermissionRequestId,
        resumedAfterApproval: toolCallState.resumedAfterApproval,
        status: toolCallState.status,
      });
      const status: 'running' | 'paused' | 'completed' | 'failed' =
        toolCallState.status === 'error'
          ? 'failed'
          : toolCallState.status === 'paused'
            ? 'paused'
            : toolCallState.status === 'completed'
              ? 'completed'
              : 'running';

      const durationMs =
        toolCallState.completedAt && toolCallState.createdAt
          ? toolCallState.completedAt - toolCallState.createdAt
          : undefined;

      return {
        kind: resolveAssistantCapabilityKind(toolCallState.toolName),
        toolCallId: toolCallState.toolCallId,
        toolName: toolCallState.toolName,
        input: {
          ...parseToolCallInputText(toolCallState.inputText),
          ...(toolCallState.batchProgress ? { _batchProgress: toolCallState.batchProgress } : {}),
        },
        output: toolCallState.output,
        isError: toolCallState.isError,
        ...(hasPendingPermission
          ? {
              pendingPermissionRequestId: toolCallState.pendingPermissionRequestId,
            }
          : {}),
        resumedAfterApproval: toolCallState.resumedAfterApproval,
        status,
        ...(durationMs !== undefined ? { durationMs } : {}),
      } satisfies AssistantTraceToolCall;
    });
  };
  const buildAttachTraceMessage = (
    messageId: string,
    textContent: string,
    finalStatus?: 'completed' | 'error' | 'cancelled' | 'paused',
  ) =>
    buildStreamAssistantTrace({
      accumulatedThinkingBlocks,
      finalStatus,
      messageId,
      modifiedFilesSummary: recoveredModifiedFilesSummary,
      resolveAssistantCapabilityKind,
      textContent,
      toolCalls: liveToolCalls,
    });

  // Mirror the main stream handler's round-boundary commit logic so attach
  // (session-recovery) keeps the same per-round assistant-message structure
  // the gateway persists.
  const closeCurrentAttachRoundIntoMessage = (timestamp: number) => {
    // Cancel pending RAF before resetting thinking buffers below.
    cancelThinkingFlush();
    cancelSegmentsFlush();
    const commitRoundIndex = resolveCommitRoundIndex();
    const committed = commitStreamingRound({
      accumulated,
      accumulatedSegments,
      accumulatedThinking,
      accumulatedThinkingBlocks,
      buildTraceMessage: (messageId, textContent) =>
        buildAttachTraceMessage(messageId, textContent, 'completed'),
      clientRequestId: attachStreamClientRequestId
        ? createRoundAssistantRequestId(attachStreamClientRequestId, commitRoundIndex)
        : undefined,
      currentAssistantStreamMessageIdRef,
      currentRoundStartedAt,
      firstTokenLatencyAttached,
      firstTokenObservedAt,
      liveToolCalls,
      requestAgentId,
      requestModelLabel: resolveRoundModelLabel(),
      requestProviderId: resolveRoundProviderId(),
      requestStartedAt,
      setMessages,
      setStreamBuffer,
      setStreamThinkingBlocks,
      setStreamThinkingBuffer,
      setStreamingSegments,
      streamRevealNextAllowedAtRef,
      streamRevealTargetCodePointsRef,
      streamRevealTargetRef,
      streamRevealVisibleCodePointCountRef,
      streamRevealVisibleRef,
      timestamp,
    });
    if (!committed) return;
    accumulated = committed.accumulated;
    accumulatedThinking = committed.accumulatedThinking;
    accumulatedThinkingBlocks = committed.accumulatedThinkingBlocks;
    accumulatedSegments = committed.accumulatedSegments;
    reasoningSegmentMeta.clear();
    liveToolCalls.clear();
    firstTokenLatencyAttached = committed.firstTokenLatencyAttached;
    currentRoundStartedAt = committed.currentRoundStartedAt;
  };

  /** attach 链路上与主链路等价的网关驱动轮次边界（见 `closeRoundIfGatewayAdvanced`）。 */
  const closeRoundIfGatewayAdvanced = (options?: { gatewayOnly?: boolean }) => {
    const boundary = options?.gatewayOnly
      ? hasGatewayAdvancedRound({
          currentRoundIndex,
          lastCompletedRound: lastCompletedRoundIndex,
        })
      : shouldStartNewRound({
          currentRoundIndex,
          lastCompletedRound: lastCompletedRoundIndex,
          toolCalls: liveToolCalls.values(),
        });
    if (!boundary) {
      return;
    }
    const boundaryAt = Date.now();
    closeCurrentAttachRoundIntoMessage(boundaryAt);
    setActiveStreamRoundStartedAt(boundaryAt);
    currentRoundIndex = resolveNextRoundIndex({
      currentRoundIndex,
      lastCompletedRound: lastCompletedRoundIndex,
    });
  };

  const getActiveSessionId = () => activeSessionRef.current;

  /**
   * 记录「这条流刚刚有活动」，用于把等待类计数清零。
   *
   * 只要收到任何真实输出（run event / 文本 / 思考 / 工具调用），就证明连接是通的：
   * 「静默关闭」与「游标停滞」的计数必须清零，否则一次长时间工具执行会把退避永久
   * 顶在封顶值上，之后每次等待都要等满封顶才接上输出。
   *
   * 必须挂在**所有**产出型回调上（不只 `onEvent`）：纯文本与纯思考回复走的是
   * `onDelta` / `onThinkingDelta`，它们不产生 run event——只清 `onEvent` 会让退避
   * 比预期更快爬到封顶。
   */
  const noteAttachActivity = () => {
    attachProgressRef.current.silentCloses = 0;
    attachProgressRef.current.stalledReconnects = 0;
  };

  const handleAttachReconnect = (reason?: AttachStreamCloseReason, technicalDetail?: string) => {
    // 会话已切走（或视图代次已变）：下面所有写入都是「当前会话级」状态，迟到回调
    // 一旦落地就会把别的会话强制打成 idle、清掉它的活跃流快照、弹出属于旧会话的
    // 错误条。传输层无法区分「这个 ES 属于哪个会话」，守卫只能放在这里。
    if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
      return;
    }

    /**
     * 网关权威确认「没有活跃流」后的收尾：这是**正常结束**，不是中断。
     *
     * 刻意不调 `handleInterruptedAttachStream`——那条路径会强制 `running` 并调度
     * 重连，正是死循环的来源。这里清掉本地活跃流快照（否则
     * `activeGatewayStreamSessionId` 恒指向当前会话，attach 判定永不进入终态）、
     * 取消自动重连、把状态收敛到 idle，并做一次快照加载补齐最后一次输出。
     */
    const settleAsEnded = () => {
      cancelAttachRetry();
      attachAttemptedSessionRef.current = sid;
      attachAttemptWindowRef.current = { count: 0, sessionId: sid, startedAt: Date.now() };
      attachProgressRef.current = createInitialAttachProgressState();
      // 只清属于本会话的快照：gateway client 是组件级单例，若快照已经被别的会话
      // 接管（用户切走后又开了新流），这里无条件清空会掐掉那个会话的续接依据。
      if (client.getActiveStreamSessionId() === sid) {
        client.clearActiveStreamSnapshot();
      }
      setStreamError(null);
      setStreaming(false);
      setStoppingStream(false);
      setSessionStateStatus('idle');
      // 同样不用 `replaceMessages`：收尾瞬间上游持久化可能尚未完成，整体替换
      // 会把刚渲染的对话覆盖成更短的历史（表现为「发完消息对话不见了」）。
      void loadCurrentSessionSnapshot(sid, {
        expectedSessionViewEpoch: attachSessionViewEpoch,
        messageLimit: INITIAL_TURN_LIMIT,
      }).catch(() => undefined);
      requestSessionListRefresh();
    };

    const reconnectNow = () => {
      // 双保险：`reconnectNow` 也由 `!token` 分支直接调用，不能依赖调用方守卫。
      if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      // 单次中断一律静默重连，不再向用户抛「实时流连接已断开」。
      //
      // attach 是「续接已有运行」的通道，断开后会自动重试并重放游标之后的事件，
      // 大多数情况下用户根本感知不到；而这条错误条是**持久化**的（sessionStorage，
      // 5 分钟内切回来还在），来回切换会话时会被反复看到，正是「老是提示断流重连」
      // 的来源。真正需要用户知晓的是「重连彻底失败」（熔断 / 重试耗尽），那两处
      // 仍然保留提示。这里只留诊断日志。
      if (technicalDetail) {
        console.warn('[ATTACH] reconnect required (silent retry)', {
          detail: technicalDetail,
          sessionId: sid,
        });
      }
      // 重连延迟由**连续中断次数**推导，而不是固定 400ms。
      //
      // `useStreamAttachRetry` 内部的退避基数会在每次 attach 成功后被
      // `cancelAttachRetry()` 清零，所以固定传 400ms 会让「attach → 收到事件 → 又断开」
      // 永远停在第一次尝试，形成 400ms 死循环；每轮 `handleInterruptedAttachStream`
      // 还会全量重载一次会话快照，几秒内就能把主线程占满——这正是最初的卡死成因。
      // `disconnects` 只在连接稳定存活 30s 后才归零（见 `handleAttachReconnect`），
      // 因此偶发抖动仍是快速恢复，反复抖动则指数退避到 30s 封顶。
      const disconnectCount = attachProgressRef.current.disconnects;
      handleInterruptedAttachStream({
        retryDelayMs: resolveDisconnectRetryDelayMs(disconnectCount),
        actions: {
          cancelPendingRevealAnimation: () => {
            if (pendingStreamRevealFrameRef.current !== null) {
              cancelAnimationFrame(pendingStreamRevealFrameRef.current);
              pendingStreamRevealFrameRef.current = null;
            }
          },
          clearCurrentAssistantStreamMessageId: () => {
            currentAssistantStreamMessageIdRef.current = null;
          },
          clearStreamingBuffers: () => {
            setStreamBuffer('');
            setStreamThinkingBuffer('');
            setStreamThinkingBlocks([]);
            setStreamingSegments([]);
          },
          getActiveSessionId,
          isCurrentSessionRequest,
          // 重连时补上 `messageLimit`：不传的话服务端会回一整段历史（实测单会话
          // 363 个 part / 1535KB），而重连会反复触发，主线程被打满。
          //
          // 这里同时在两个层面收敛成本：一是限制返回条数，二是让这次请求与 ChatPage
          // 1s 轮询的在途请求**共用同一 key**（单飞层按 sessionId+messageLimit 复用），
          // 从而不再额外多发一次完整往返。重连真正需要的是活跃流的 run events，
          // 历史消息只是背景。
          loadCurrentSessionSnapshot: (targetSessionId, options) =>
            loadCurrentSessionSnapshot(targetSessionId, {
              ...options,
              messageLimit: INITIAL_TURN_LIMIT,
            }),
          requestSessionListRefresh,
          resetAttachAttempt: () => {
            attachAttemptedSessionRef.current = null;
          },
          resetRevealState: () => {
            stoppingStreamRef.current = false;
            streamRevealTargetRef.current = '';
            streamRevealVisibleRef.current = '';
            streamRevealTargetCodePointsRef.current = [];
            streamRevealVisibleCodePointCountRef.current = 0;
            streamRevealNextAllowedAtRef.current = 0;
            streamingRef.current = false;
          },
          scheduleAttachRetry,
          setActiveStreamFirstTokenLatencyMs,
          setActiveStreamStartedAt,
          setRecoveredStreamSnapshot,
          setSessionStateStatus,
          setStoppingStream,
          setStreaming,
        },
        attachSessionViewEpoch,
        sessionId: sid,
        state: {
          accumulatedText: accumulated,
          accumulatedThinkingBlocks,
          accumulatedUsage,
          attachStateInitialized,
          currentAssistantStreamMessageId: currentAssistantStreamMessageIdRef.current,
          parts: accumulatedSegments,
          ...(visibleLatestUpstreamSummary
            ? { latestUpstreamSummary: visibleLatestUpstreamSummary }
            : {}),
          ...(recoveredModifiedFilesSummary ? { recoveredModifiedFilesSummary } : {}),
          requestStartedAt,
          toolCalls: buildAttachToolCalls(),
        },
      });
    };

    // ── 权威确认：先问网关「这条流还在不在」，再决定是结束还是重连 ────────
    // EventSource 在服务端正常结束（EOF / 关闭响应）时同样会触发 `onerror`。
    // 不确认就无条件重连，会形成「attach 成功 → EOF → 当成断线重连 → 又 attach」
    // 的死循环：每轮都重放事件、强制 running、再全量 reload 一次快照，几秒内就把
    // 主线程占满（页面卡死、刷新后重新开始循环）。
    if (!token) {
      reconnectNow();
      return;
    }

    // ── 静默结束（打开后 0 事件）＝「服务端暂时没有可推送的内容」──────────
    //
    // 绝大多数情况这是**正常状态**：模型正在执行 bash / mcp 等长耗时工具，或仍在
    // 思考，网关在这段时间不产生新的 run event，attach 于是「打开 → 0 事件 → EOF」。
    // 此时既不该判定连接异常，也不该提示用户，更不该高频重连（每轮都会清缓冲 +
    // 全量 reload，工具跑得越久越卡）。
    //
    // 因此这里**无条件**低频等待：递增退避重挂，不碰流状态、不 reload、不提示。
    // 不再设「达到次数就停止并报错」的分支——那个判据依赖 `sessionStateStatus`，
    // 而循环自身会把它置成 `running`（见下），所以它既不可达，又会在工具执行
    // 期间弹「实时流长时间没有新输出，已停止自动重连」。会话是否真的结束，由网关
    // 权威回答：下面 `getActiveStream()` 返回 null 时走 `settleAsEnded()` 正常收敛。
    if (reason === 'attach_stream_silent_close') {
      const silentProgress = attachProgressRef.current;
      // 跨会话重置「静默」相关计数；`disconnects` / `attachedAt` 属于断线维度，
      // 跨会话同样无意义，但保留结构更清晰——这里整体重置即可。
      if (silentProgress.sessionId !== sid) {
        attachProgressRef.current = { ...createInitialAttachProgressState(), sessionId: sid };
      }
      attachProgressRef.current.silentCloses += 1;
      const silentCloses = attachProgressRef.current.silentCloses;

      setSessionStateStatus('running');
      scheduleAttachRetry({
        delayMs: resolveSilentCloseRetryDelayMs(silentCloses),
        sessionId: sid,
        silent: true,
        beforeRetry: () => {
          if (getActiveSessionId() !== sid) {
            return 'abort';
          }
          attachAttemptedSessionRef.current = null;
          return 'proceed';
        },
      });
      return;
    } else if (reason === 'attach_stream_disconnected') {
      // 真实中断：连接建立过又掉了。累加失败计数（**不**在这里归零——归零只发生在
      // 连接稳定存活满 `STABLE_ATTACH_WINDOW_MS` 之后），并重置静默计数。
      const disconnectProgress = attachProgressRef.current;
      const livedLongEnough =
        disconnectProgress.attachedAt > 0 &&
        Date.now() - disconnectProgress.attachedAt >= STABLE_ATTACH_WINDOW_MS;
      if (livedLongEnough) {
        // 上一条连接稳定存在过：这次中断视为偶发，退避回到起步值。
        disconnectProgress.disconnects = 0;
      } else {
        disconnectProgress.disconnects += 1;
      }
      disconnectProgress.silentCloses = 0;
      disconnectProgress.stalledReconnects = 0;
    }

    void createSessionsClient(gatewayUrl)
      .getActiveStream(token, sid)
      .then((activeStream) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          return;
        }
        if (!activeStream) {
          attachProgressRef.current = createInitialAttachProgressState();
          settleAsEnded();
          return;
        }

        // 游标停滞只用于**诊断**：网关可能返回一个已僵死的活跃流快照（`lastSeq`
        // 不再前进）。这里既不收敛也不提示——工具执行期间游标本来就不动，而真正
        // 结束的情况网关会返回 null（上面已 `settleAsEnded()`）。统计结果只写进
        // 日志，便于排查「反复 attach 却收不到事件」。
        const progress = attachProgressRef.current;
        if (progress.sessionId !== sid) {
          progress.sessionId = sid;
          progress.lastSeq = activeStream.lastSeq;
          progress.stalledReconnects = 0;
        } else if (activeStream.lastSeq <= progress.lastSeq) {
          progress.stalledReconnects += 1;
        } else {
          progress.lastSeq = activeStream.lastSeq;
          progress.stalledReconnects = 0;
        }

        reconnectNow();
      })
      .catch(() => {
        // 查询失败（网关不可达 / 鉴权异常）：按原逻辑重连，由熔断兜底。
        if (isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          reconnectNow();
        }
      });
  };
  const attachReconnectWiring = createAttachStreamReconnectWiring({
    attachSessionViewEpoch,
    handleAttachReconnect,
    isCurrentSessionRequest,
    requestSessionListRefresh,
    sessionId: sid,
  });

  const ensureAttachStateInitialized = () => {
    if (attachStateInitialized) {
      return;
    }
    attachStateInitialized = true;
    currentAssistantStreamMessageIdRef.current =
      recoveredStreamSnapshot?.messageId ?? makeOrderedMessageId();
    for (const [index, recoveredToolCall] of (recoveredStreamSnapshot?.toolCalls ?? []).entries()) {
      const recoveredToolCallId =
        recoveredToolCall.toolCallId ??
        `${currentAssistantStreamMessageIdRef.current ?? 'recovered-stream'}:tool:${index}`;
      toolCallIds.add(recoveredToolCallId);

      let recoveredInputText = '';
      try {
        recoveredInputText = JSON.stringify(recoveredToolCall.input);
      } catch (error) {
        logger.warn('failed to serialize recovered tool input', error);
      }

      liveToolCalls.set(recoveredToolCallId, {
        createdAt: requestStartedAt,
        ...(recoveredToolCall.durationMs !== undefined
          ? { completedAt: requestStartedAt + recoveredToolCall.durationMs }
          : {}),
        inputText: recoveredInputText,
        output: recoveredToolCall.output,
        isError: recoveredToolCall.isError,
        pendingPermissionRequestId: recoveredToolCall.pendingPermissionRequestId,
        resumedAfterApproval: recoveredToolCall.resumedAfterApproval,
        toolCallId: recoveredToolCallId,
        status:
          recoveredToolCall.status === 'paused'
            ? 'paused'
            : recoveredToolCall.status === 'completed'
              ? 'completed'
              : recoveredToolCall.status === 'failed'
                ? 'error'
                : 'streaming',
        toolName: recoveredToolCall.toolName,
      });
    }
    // Recovery already replays runEvents into wire-ordered parts. Reuse
    // those parts directly so tools remain between the text/reasoning
    // segments that surrounded them before a refresh or session switch.
    //
    const seededSegments = (recoveredStreamSnapshot?.parts ?? []).map((part) => {
      if (part.type === 'reasoning') {
        const recoveredBlock = initialThinkingBlocks.find(
          (block) => block.text === part.text && block.startedAt === part.startedAt,
        );
        reasoningSegmentMeta.set(part.id, {
          blockKey: recoveredBlock?.key ?? `recovered:${part.id}`,
        });
      }
      if (part.type === 'tool') {
        return {
          ...part,
          kind: resolveAssistantCapabilityKind(part.toolName) as
            'agent' | 'mcp' | 'skill' | 'tool' | undefined,
        };
      }
      return part;
    });
    accumulatedSegments = seededSegments;
    stoppingStreamRef.current = false;
    streamingRef.current = true;
    setStreaming(true);
    setStoppingStream(false);
    setSessionStateStatus('running');
    setReportedStreamUsage(initialUsage);
    setActiveStreamStartedAt(requestStartedAt);
    // 恢复快照代表的就是当前这一轮的已完成片段，因此本轮起点沿用它。
    setActiveStreamRoundStartedAt(requestStartedAt);
    setActiveStreamFirstTokenLatencyMs(null);
    setStreamBuffer(initialText);
    setStreamThinkingBuffer(initialThinking);
    setStreamThinkingBlocks(initialThinkingBlocks);
    setStreamingSegments(seededSegments);
    setRecoveredStreamSnapshot(null);
    streamRevealTargetRef.current = initialText;
    streamRevealVisibleRef.current = initialText;
    streamRevealTargetCodePointsRef.current = requestTextCodePoints;
    streamRevealVisibleCodePointCountRef.current = requestTextCodePoints.length;
    streamRevealNextAllowedAtRef.current = 0;
  };

  void client
    .attachToActiveStream(sid, {
      onEvent: (event) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          return;
        }
        noteAttachActivity();
        ensureAttachStateInitialized();

        if (event.type === 'upstream_route') {
          latestUpstreamRoute = {
            modelId: event.modelId,
            ...(event.providerId ? { providerId: event.providerId } : {}),
          };
        }

        if ((event.type === 'done' || event.type === 'error') && event.upstreamSummary) {
          latestRoundUpstreamSummary = event.upstreamSummary;
          const nextRouteModelId = event.upstreamSummary.modelId ?? latestUpstreamRoute?.modelId;
          const nextRouteProviderId =
            event.upstreamSummary.providerId ?? latestUpstreamRoute?.providerId;
          if (nextRouteModelId) {
            latestUpstreamRoute = {
              modelId: nextRouteModelId,
              ...(nextRouteProviderId ? { providerId: nextRouteProviderId } : {}),
            };
          }
          setLatestUpstreamSummary(event.upstreamSummary);
        }

        if (
          event.type === 'tool_call_delta' ||
          event.type === 'tool_result' ||
          event.type === 'tool_progress'
        ) {
          toolCallIds.add(event.toolCallId);
        }

        if (event.type === 'tool_call_delta') {
          // Mirror the main stream handler: capture first-token latency on
          // the first tool_call_delta when no text has arrived yet, so
          // attach replays of reasoning-heavy rounds also show "首 token X"
          // instead of "首 token --".
          if (firstTokenObservedAt === null) {
            firstTokenObservedAt = event.occurredAt ?? Date.now();
            setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
          }
          // 与主链路一致：新一轮可能以裸工具调用开头，只用网关轮次信号切轮。
          closeRoundIfGatewayAdvanced({ gatewayOnly: true });
          const previous = liveToolCalls.get(event.toolCallId);
          const nextInputText = `${previous?.inputText ?? ''}${event.inputDelta}`;
          liveToolCalls.set(event.toolCallId, {
            createdAt: previous?.createdAt ?? event.occurredAt ?? Date.now(),
            inputText: nextInputText,
            output: previous?.output,
            isError: previous?.isError,
            resumedAfterApproval: previous?.resumedAfterApproval,
            toolCallId: event.toolCallId,
            status: 'streaming',
            toolName: event.toolName,
          });
          // Mirror into the attach segment list so re-rendered messages
          // preserve the gateway's wire ordering. First delta opens a new
          // tool segment at the current end; later deltas update its input.
          accumulatedSegments = upsertStreamingToolSegment(accumulatedSegments, {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            input: parseToolCallInputText(nextInputText),
            status: 'running',
            kind: resolveAssistantCapabilityKind(event.toolName) as
              'agent' | 'mcp' | 'skill' | 'tool' | undefined,
          });
          scheduleSegmentsFlush();
        }

        if (event.type === 'tool_progress') {
          applyStreamToolProgress({ event, liveToolCalls });
          // 断线重连 / 附着到活跃流时同样要把实时进度镜像到渲染分段，
          // 否则重连后只会看到“运行中”而没有输出。
          accumulatedSegments = applyToolProgressToStreamingSegment(accumulatedSegments, event);
          scheduleSegmentsFlush();
        }

        if (event.type === 'tool_result') {
          const hasPendingPermission = hasActivePendingPermissionRequest(event);
          const { accumulatedSegments: nextSegments, rawPendingPermissionRequestId } =
            applyStreamToolResult({
              accumulatedSegments,
              event,
              hasPendingPermission,
              liveToolCalls,
            });
          accumulatedSegments = nextSegments;
          scheduleSegmentsFlush();
          setMessages((previousMessages) => {
            const nextMessages = applyToolResultToLocalAssistantMessages(previousMessages, event);
            return typeof rawPendingPermissionRequestId === 'string' &&
              rawPendingPermissionRequestId.length > 0 &&
              !hasPendingPermission
              ? dismissPermissionEventMessage(nextMessages, rawPendingPermissionRequestId)
              : nextMessages;
          });
          if (
            typeof rawPendingPermissionRequestId === 'string' &&
            rawPendingPermissionRequestId.length > 0 &&
            !hasPendingPermission
          ) {
            setPendingPermissions((previousPermissions) =>
              previousPermissions.filter(
                (permission) => permission.requestId !== rawPendingPermissionRequestId,
              ),
            );
          }
        }

        if (event.type === 'usage') {
          // 与主链路一致：记录网关回报的已完成轮次，边界在下一轮内容到达时应用。
          lastCompletedRoundIndex = Math.max(lastCompletedRoundIndex ?? 0, event.round);
          accumulatedUsage = mergeChatBackendUsageSnapshot(accumulatedUsage, event);
          setReportedStreamUsage((previous) => mergeChatBackendUsageSnapshot(previous, event));
        }

        if (
          event.type === 'terminal_started' ||
          event.type === 'terminal_output' ||
          event.type === 'terminal_exited'
        ) {
          sessionTerminals.applyRunEvent(event);

          // Auto-detect dev-server URLs from terminal output (attach path)
          if (
            (event.type === 'terminal_output' || event.type === 'terminal_started') &&
            !devServerDetectedTerminalIdsRef.current.has(
              (event as { terminalId: string }).terminalId,
            )
          ) {
            const terminalEvent =
              event.type === 'terminal_output'
                ? {
                    type: 'terminal_output' as const,
                    outputTail: (event as { outputTail: string }).outputTail,
                    terminalId: (event as { terminalId: string }).terminalId,
                  }
                : {
                    type: 'terminal_started' as const,
                    command: (event as { command: string }).command,
                    terminalId: (event as { terminalId: string }).terminalId,
                  };
            const detected = detectTerminalDevServer({
              detectedTerminalIds: devServerDetectedTerminalIdsRef.current,
              event: terminalEvent,
            });
            if (detected.shouldMarkTerminalHandled) {
              devServerDetectedTerminalIdsRef.current.add(terminalEvent.terminalId);
            }
            if (detected.detectedUrl) {
              setBrowserPreviewUrl(detected.detectedUrl);
              // Open the editor pane with browser preview
              setEditorMode(true);
            }
          }
        }

        if (event.type === 'session_child') {
          setChildSessions((previous) => applySessionChildRuntimeEvent(previous, event));
        }

        if (event.type === 'task_update') {
          setSessionTasks((previous) => applyTaskUpdateRuntimeEvent(previous, event));
        }

        if (
          event.type === 'permission_asked' ||
          event.type === 'permission_replied' ||
          event.type === 'question_asked' ||
          event.type === 'question_replied'
        ) {
          const handledPendingInteraction = handlePendingInteractionEvent({
            event,
            gatewayUrl,
            isAutoAcceptEnabled,
            onPermissionAsked: (permissionEvent) => {
              setSessionStateStatus('paused');
              setMessages((previous) => upsertPermissionEventMessage(previous, permissionEvent));
              setPendingPermissions((previous) => {
                return dedupePendingPermissionRequests([
                  createPendingPermissionRequestSnapshot(permissionEvent, sid),
                  ...previous,
                ]);
              });
            },
            onPermissionAskedAutoReplyFallback: (permissionEvent) => {
              setSessionStateStatus('paused');
              setMessages((previous) => upsertPermissionEventMessage(previous, permissionEvent));
            },
            onPermissionReplied: (permissionEvent) => {
              if (permissionEvent.decision !== 'reject') {
                setSessionStateStatus('running');
              }
              setMessages((previous) =>
                dismissPermissionEventMessage(
                  applyPermissionDecisionToLocalAssistantMessages(
                    previous,
                    permissionEvent.requestId,
                    permissionEvent.decision,
                    permissionEvent.feedback,
                  ),
                  permissionEvent.requestId,
                ),
              );
              setPendingPermissions((previous) =>
                previous.filter((permission) => permission.requestId !== permissionEvent.requestId),
              );
              setRightPanelState((previous) =>
                clearResolvedPendingPermissionToolCalls(
                  previous,
                  permissionEvent.requestId,
                  permissionEvent.decision,
                ),
              );
            },
            onQuestionAsked: (questionEvent) => {
              // 与 `onPermissionAsked` 对称：提问是「流暂停等输入」，不清流式状态。
              // `resetStreamState()` 会清空正在输出的内容、并把
              // `recoveryActiveStream` / 助手消息 id 一并抹掉——回答后重启的输出
              // 因此接不回来（表现为「提问一出现就断流」），同一轮还会被拆成两条消息。
              setSessionStateStatus('paused');
              void loadPendingQuestionForSession(sid, questionEvent.requestId);
            },
            onQuestionReplied: (questionEvent) => {
              setSessionStateStatus(questionEvent.status === 'answered' ? 'running' : 'idle');
              setPendingQuestions((previous) =>
                previous.filter((q) => q.requestId !== questionEvent.requestId),
              );
            },
            pausedForPermission,
            pausedForQuestion,
            refreshCurrentSession: () => requestCurrentSessionRefresh(sid),
            requestSessionListRefresh,
            replyPermissionRequest,
            sessionId: sid,
            token,
          });
          pausedForPermission = handledPendingInteraction.pausedForPermission;
          pausedForQuestion = handledPendingInteraction.pausedForQuestion;
        }

        setRightPanelState((prev) => {
          if (
            event.type === 'tool_call_delta' ||
            event.type === 'tool_search' ||
            event.type === 'done' ||
            event.type === 'error'
          ) {
            return applyChatRightPanelChunk(prev, event);
          }
          return applyChatRightPanelEvent(prev, event);
        });

        if (!isFollowingRef.current) {
          setHasPendingFollowContent((previous) => previous || true);
        }

        if (
          shouldShowRunEventInTranscript(event) &&
          event.type !== 'audit_ref' &&
          event.type !== 'permission_replied' &&
          event.type !== 'question_replied'
        ) {
          appendAssistantEventMessages([event]);
        }
      },
      onDelta: (delta) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
          return;
        }
        noteAttachActivity();
        ensureAttachStateInitialized();
        if (firstTokenObservedAt === null) {
          firstTokenObservedAt = Date.now();
          setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
        }
        // Mirror the main stream handler: the next round's content closes the
        // round the gateway already finished.
        closeRoundIfGatewayAdvanced();
        accumulated += delta;
        // Mirror into the ordered attach segment list so live re-attach
        // renders preserve wire-arrival order. Coalesces consecutive text
        // deltas with the trailing text segment when no other segment was
        // recorded between them.
        const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        accumulatedSegments = appendStreamingTextDelta(accumulatedSegments, delta, messageId);
        scheduleSegmentsFlush();
        streamRevealTargetRef.current = accumulated;
        streamRevealTargetCodePointsRef.current.push(...Array.from(delta));
        const shouldRevealStructuredContentImmediately =
          isImmediatelyRenderableStructuredContent(accumulated);
        if (prefersReducedMotion || shouldRevealStructuredContentImmediately) {
          streamRevealVisibleRef.current = accumulated;
          streamRevealVisibleCodePointCountRef.current =
            streamRevealTargetCodePointsRef.current.length;
          streamRevealNextAllowedAtRef.current = 0;
          setStreamBuffer(accumulated);
        } else {
          scheduleStreamReveal({ prefersReducedMotion });
        }
        if (!isFollowingRef.current) {
          setHasPendingFollowContent((previous) => previous || true);
        }
      },
      onThinkingDelta: (chunk) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
          return;
        }
        noteAttachActivity();
        ensureAttachStateInitialized();
        // Mirror the main stream handler: reasoning chunks are real model
        // output, so capturing first-token latency here keeps the assistant
        // footer showing "首 token X" on attach replays of reasoning-heavy
        // rounds instead of "首 token --".
        if (firstTokenObservedAt === null) {
          firstTokenObservedAt = Date.now();
          setActiveStreamFirstTokenLatencyMs(firstTokenObservedAt - requestStartedAt);
        }
        const thinkingChunkKey = buildStreamingThinkingChunkDeliveryKey(chunk);
        if (deliveredAttachThinkingChunkKeys.has(thinkingChunkKey)) return;
        deliveredAttachThinkingChunkKeys.add(thinkingChunkKey);
        closeRoundIfGatewayAdvanced();
        accumulatedThinkingBlocks = appendStreamingThinkingChunk(accumulatedThinkingBlocks, chunk, {
          forceNewBlock: accumulatedSegments[accumulatedSegments.length - 1]?.type !== 'reasoning',
        });
        accumulatedThinking = joinStreamingThinkingTexts(accumulatedThinkingBlocks);
        const messageId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        accumulatedSegments = appendStreamingThinkingDelta(
          accumulatedSegments,
          reasoningSegmentMeta,
          chunk,
          messageId,
        );
        scheduleSegmentsFlush();
        // RAF-batched: see comment in main stream handler.
        scheduleThinkingFlush();
      },
      onThinkingEnd: (chunk) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch) || stoppingStreamRef.current) {
          return;
        }
        ensureAttachStateInitialized();
        accumulatedThinkingBlocks = markStreamingThinkingChunkEnded(
          accumulatedThinkingBlocks,
          chunk,
        );
        accumulatedSegments = markStreamingReasoningSegmentEnded(
          accumulatedSegments,
          reasoningSegmentMeta,
          chunk,
        );
        scheduleSegmentsFlush();
        scheduleThinkingFlush();
      },
      onToolCall: (chunk) => {
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          return;
        }
        noteAttachActivity();
        ensureAttachStateInitialized();
        toolCallIds.add(chunk.toolCallId);
        if (!rightOpenRef.current) {
          setRightTab('tools');
        }
      },
      onDone: (stopReason, streamAgentId, cancellation, upstreamSummary) => {
        if (attachStreamTerminalized) {
          return;
        }
        attachStreamTerminalized = true;
        if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
          requestSessionListRefresh();
          return;
        }
        // question_asked already called resetStreamState(), so an unexpected onDone
        // would create a duplicate assistant message with a fresh ID. Bail out.
        if (pausedForQuestion) {
          requestSessionListRefresh();
          return;
        }
        const resolvedUpstreamSummary = upstreamSummary ?? latestRoundUpstreamSummary;
        if (resolvedUpstreamSummary) {
          latestRoundUpstreamSummary = resolvedUpstreamSummary;
          setLatestUpstreamSummary(resolvedUpstreamSummary);
        }
        ensureAttachStateInitialized();
        const finishedAt = Date.now();
        const resolvedStopReason = stopReason ?? 'end_turn';
        const wasCancelled = String(resolvedStopReason) === 'cancelled';
        const isPausedForPermission = resolvedStopReason === 'tool_permission';
        const finalAccumulatedText = wasCancelled ? streamRevealVisibleRef.current : accumulated;
        const traceFinalStatus = wasCancelled
          ? 'cancelled'
          : resolvedStopReason === 'error'
            ? 'error'
            : isPausedForPermission
              ? 'paused'
              : 'completed';
        const resolvedMessageModel = resolveRoundModelLabel(resolvedUpstreamSummary);
        const resolvedMessageProviderId = resolveRoundProviderId(resolvedUpstreamSummary);
        const hasRenderableAssistantReply =
          finalAccumulatedText.trim().length > 0 ||
          accumulatedThinking.trim().length > 0 ||
          toolCallIds.size > 0;
        const messageStatus: 'completed' | 'error' | 'cancelled' = wasCancelled
          ? 'cancelled'
          : resolvedStopReason === 'error'
            ? 'error'
            : 'completed';
        if (hasRenderableAssistantReply || !wasCancelled) {
          const attachMsgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          const finalized = finalizeStreamMessage({
            accumulatedSegments,
            accumulatedThinking,
            agentId: streamAgentId || requestAgentId,
            buildTraceMessage: (messageId, textContent) =>
              buildAttachTraceMessage(messageId, textContent, traceFinalStatus),
            clientRequestId: attachStreamClientRequestId ?? undefined,
            contentText: finalAccumulatedText,
            createdAt: finishedAt,
            currentRoundStartedAt,
            firstTokenLatencyAttached,
            firstTokenObservedAt,
            messageId: attachMsgId,
            model: resolvedMessageModel,
            providerId: resolvedMessageProviderId,
            requestStartedAt,
            setMessages,
            status: messageStatus,
            stopReason: resolvedStopReason,
            toolCallIds: new Set(liveToolCalls.keys()),
            traceFinalStatus,
          });
          firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
        } else if (wasCancelled) {
          const attachMsgId = currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
          const finalized = finalizeStreamMessage({
            accumulatedSegments,
            accumulatedThinking,
            agentId: streamAgentId || requestAgentId,
            buildTraceMessage: (messageId, textContent) =>
              buildAttachTraceMessage(messageId, textContent, traceFinalStatus),
            clientRequestId: attachStreamClientRequestId ?? undefined,
            contentText: '已停止',
            createdAt: finishedAt,
            currentRoundStartedAt,
            firstTokenLatencyAttached,
            firstTokenObservedAt,
            messageId: attachMsgId,
            model: resolvedMessageModel,
            providerId: resolvedMessageProviderId,
            requestStartedAt,
            setMessages,
            status: 'cancelled',
            stopReason: resolvedStopReason,
            toolCallIds: new Set(liveToolCalls.keys()),
            traceFinalStatus,
          });
          firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
        }
        // attach 也可能收到暂停前旧流迟到的 done：若回复操作已把状态乐观置为
        // running，不能让这个终态事件把后台续跑重新降级为 paused/idle。
        setSessionStateStatus((currentStatus) => {
          return resolveStreamTerminalStatus({
            currentStatus,
            pausedForPermission,
            pausedForQuestion,
          });
        });
        resetStreamState();
        // 流式完成后延迟快照恢复，给服务器足够时间持久化消息。
        window.setTimeout(() => {
          void loadCurrentSessionSnapshot(sid, {
            expectedSessionViewEpoch: attachSessionViewEpoch,
            messageLimit: INITIAL_TURN_LIMIT,
          }).catch(() => undefined);
        }, 800);
        requestSessionListRefresh();
      },
      onError: (code, message, technicalDetail) => {
        if (attachReconnectWiring.handleAttachDisconnectError(code) === 'handled') {
          return;
        }
        ensureAttachStateInitialized();
        if (pausedForPermission || pausedForQuestion) {
          requestSessionListRefresh();
          return;
        }
        const finishedAt = Date.now();
        const resolvedMessage = formatGatewayStreamErrorMessage(code, message, technicalDetail);
        const errorContent = `[错误: ${code}] ${resolvedMessage}`;
        logger.error('attach stream error', `${code}: ${resolvedMessage}`);
        reportClientSideStreamError(code, resolvedMessage, technicalDetail);
        const attachErrorMsgId =
          currentAssistantStreamMessageIdRef.current ?? makeOrderedMessageId();
        const resolvedMessageModel = resolveRoundModelLabel(latestRoundUpstreamSummary);
        const resolvedMessageProviderId = resolveRoundProviderId(latestRoundUpstreamSummary);
        const finalized = finalizeStreamMessage({
          accumulatedSegments: [],
          accumulatedThinking,
          agentId: requestAgentId,
          buildTraceMessage: (messageId, textContent) =>
            buildAttachTraceMessage(messageId, textContent, 'error'),
          clientRequestId: attachStreamClientRequestId ?? undefined,
          contentText: errorContent,
          createdAt: finishedAt,
          currentRoundStartedAt,
          firstTokenLatencyAttached,
          firstTokenObservedAt,
          messageId: attachErrorMsgId,
          model: resolvedMessageModel,
          providerId: resolvedMessageProviderId,
          requestStartedAt,
          setMessages,
          status: 'error',
          stopReason: 'error',
          toolCallIds: new Set(liveToolCalls.keys()),
        });
        firstTokenLatencyAttached = finalized.firstTokenLatencyAttached;
        setSessionStateStatus('idle');
        resetStreamState();
        setStreamError(resolvedMessage);
        // 错误后的快照恢复可以更快，因为不需要等待服务器持久化。
        window.setTimeout(() => {
          void loadCurrentSessionSnapshot(sid, {
            expectedSessionViewEpoch: attachSessionViewEpoch,
            messageLimit: INITIAL_TURN_LIMIT,
          }).catch(() => undefined);
        }, 500);
        requestSessionListRefresh();
      },
      onReconnectRequired: (reason, technicalDetail) => {
        attachReconnectWiring.handleReconnectRequired(reason, technicalDetail);
      },
    })
    .then((attachResult) => {
      if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      switch (attachResult.status) {
        case 'attached': {
          attachStreamClientRequestId = client.getActiveStreamClientRequestId();
          // 记录连接建立时刻：只有它稳定存活满 `STABLE_ATTACH_WINDOW_MS`，下一次
          // 中断才被当作偶发、把重连退避重置回起步值。`cancelAttachRetry()` 依旧
          // 要调（取消待触发的重试），但它内部会清空退避基数，所以真正的退避由
          // `attachProgressRef.disconnects` 独立承担。
          attachProgressRef.current.attachedAt = Date.now();
          cancelAttachRetry();
          setStreamError(null);
          // 标记这个会话的 attach 已成功完成，防止后续重复触发
          console.log('[ATTACH_ELIGIBILITY] attach succeeded for', sid);
          return;
        }

        case 'no_active_stream': {
          // 网关此刻没有活跃流，但会话状态仍为 running：典型场景是权限批准后的
          // 续跑正在执行被批准的工具 / 模型轮尚未注册运行线程，或运行线程刚被
          // 清理。此时若按「正常终态」直接放弃，续跑输出永远接不上、界面表现为
          // 「批准后卡住」——改为有界重试，等活跃流出现后再 attach。会话真正
          // 结束（idle + 无恢复流）时 disposition 会转入 terminal 并取消重试，
          // 因此重试天然有界，不会形成空转循环。
          if (sessionStateStatus === 'running') {
            scheduleAttachRetry({
              sessionId: sid,
              delayMs: 1000,
              beforeRetry: () => {
                if (getActiveSessionId() !== sid) {
                  return 'abort';
                }

                attachAttemptedSessionRef.current = null;
                return 'proceed';
              },
            });
          } else {
            cancelAttachRetry();
          }
          setStreamError(null);
          void loadCurrentSessionSnapshot(sid, {
            expectedSessionViewEpoch: attachSessionViewEpoch,
            messageLimit: INITIAL_TURN_LIMIT,
          }).catch(() => undefined);
          return;
        }

        case 'stale': {
          // 归属已变化（会话已切换或更新的请求已接管），本次 attach 作废、不重试。
          cancelAttachRetry();
          return;
        }

        case 'transport_failed': {
          scheduleAttachRetry({
            sessionId: sid,
            delayMs: 1500,
            beforeRetry: () => {
              if (getActiveSessionId() !== sid) {
                return 'abort';
              }

              attachAttemptedSessionRef.current = null;
              return 'proceed';
            },
          });

          void loadCurrentSessionSnapshot(sid, {
            expectedSessionViewEpoch: attachSessionViewEpoch,
            messageLimit: INITIAL_TURN_LIMIT,
          }).catch(() => undefined);
          return;
        }
      }
    });

  return cleanupAttachTransport;
}
