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
export {
  ATTACH_STORM_MAX_ATTEMPTS,
  ATTACH_STORM_WINDOW_MS,
  DISCONNECT_RETRY_DELAYS_MS,
  SILENT_CLOSE_RETRY_DELAYS_MS,
  STABLE_ATTACH_WINDOW_MS,
  createInitialAttachProgressState,
  resolveDisconnectRetryDelayMs,
  resolveSilentCloseRetryDelayMs,
} from './attach-effect-retry-policy.js';
export type { AttachProgressState } from './attach-effect-retry-policy.js';
import {
  ATTACH_STORM_MAX_ATTEMPTS,
  ATTACH_STORM_WINDOW_MS,
  STABLE_ATTACH_WINDOW_MS,
  createInitialAttachProgressState,
  resolveDisconnectRetryDelayMs,
  resolveSilentCloseRetryDelayMs,
} from './attach-effect-retry-policy.js';
import type { AttachProgressState } from './attach-effect-retry-policy.js';

export type { SessionAttachDeps } from './session-attach-deps.js';
import type { SessionAttachDeps } from './session-attach-deps.js';
import { runAttachReconnect } from './attach-reconnect-handler.js';

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

  const handleAttachReconnect = (reason?: AttachStreamCloseReason, technicalDetail?: string) =>
    runAttachReconnect(
      {
        sid,
        attachSessionViewEpoch,
        attachStateInitialized,
        accumulated,
        accumulatedSegments,
        accumulatedThinkingBlocks,
        accumulatedUsage,
        requestStartedAt,
        recoveredModifiedFilesSummary,
        buildAttachToolCalls,
        getActiveSessionId,
        attachAttemptWindowRef,
        attachAttemptedSessionRef,
        attachProgressRef,
        cancelAttachRetry,
        client,
        currentAssistantStreamMessageIdRef,
        gatewayUrl,
        isCurrentSessionRequest,
        loadCurrentSessionSnapshot,
        pendingStreamRevealFrameRef,
        requestSessionListRefresh,
        scheduleAttachRetry,
        setActiveStreamFirstTokenLatencyMs,
        setRecoveredStreamSnapshot,
        setSessionStateStatus,
        setStoppingStream,
        setStreamBuffer,
        setStreamError,
        setStreaming,
        setStreamingSegments,
        setStreamThinkingBlocks,
        setStreamThinkingBuffer,
        stoppingStreamRef,
        streamRevealNextAllowedAtRef,
        streamRevealTargetCodePointsRef,
        streamRevealTargetRef,
        streamRevealVisibleCodePointCountRef,
        streamRevealVisibleRef,
        streamingRef,
        token,
        visibleLatestUpstreamSummary,
        setActiveStreamStartedAt,
      },
      reason,
      technicalDetail,
    );

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
