/**
 * 会话「附着到活跃流 / 恢复」effect 的逻辑体（P3 原样搬家）。
 *
 * 由 `ChatPage` 的 `useEffect` 原位调用：依赖对象在 effect 回调**内部**构造，
 * 保留原有 effect 执行顺序，并避免「后声明的值被急切求值」的 TDZ 问题。
 */
import {
  resolveAttachEffectDisposition,
  shouldAttemptAttachToSession,
  shouldResetAttachAttempt,
} from '../../../components/conversation-runtime/attach/attach-stream-eligibility.js';
import { createAttachStreamReconnectWiring } from '../../../components/conversation-runtime/attach/attach-stream-reconnect-wiring.js';
import { handleInterruptedAttachStream } from '../../../components/conversation-runtime/attach/attach-stream-reconnect.js';
import type { ScheduleStreamAttachRetryInput } from '../../../components/conversation-runtime/attach/use-stream-attach-retry.js';
import { makeOrderedMessageId } from '../../../components/conversation-runtime/messages/ordered-id.js';
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
import { createRoundAssistantRequestId } from '../../../components/conversation-runtime/stream/round-request-id.js';
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
  dedupePendingPermissionRequests,
} from '@openAwork/web-client';
import type {
  PendingQuestionRequest,
  Session,
  SessionActiveStream,
  SessionTask,
} from '@openAwork/web-client';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';

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
  readonly attachEligibilitySignatureRef: RefObject<string | null>;
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
  readonly setRightTab: (
    value:
      | 'overview'
      | 'plan'
      | 'tools'
      | 'bookmarks'
      | 'terminals'
      | 'skills'
      | 'snapshots'
      | 'history'
      | 'viz'
      | 'mcp'
      | 'agent'
      | ((
          prev:
            | 'overview'
            | 'plan'
            | 'tools'
            | 'bookmarks'
            | 'terminals'
            | 'skills'
            | 'snapshots'
            | 'history'
            | 'viz'
            | 'mcp'
            | 'agent',
        ) =>
          | 'overview'
          | 'plan'
          | 'tools'
          | 'bookmarks'
          | 'terminals'
          | 'skills'
          | 'snapshots'
          | 'history'
          | 'viz'
          | 'mcp'
          | 'agent'),
  ) => void;
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
    attachEligibilitySignatureRef,
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
      if (currentSessionId) {
        void loadCurrentSessionSnapshot(currentSessionId, {
          expectedSessionViewEpoch: currentSessionViewRef.current.epoch,
          messageLimit: INITIAL_TURN_LIMIT,
          replaceMessages: true,
        }).catch(() => undefined);
      }
      return;
    }

    case 'cancel_retry': {
      cancelAttachRetry();
      attachAttemptedSessionRef.current = null;
      return;
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
      return;
    }

    case 'proceed':
      break;
  }

  // proceed 分支由 shouldAttemptAttachToSession 保证，此处仅为类型收窄。
  if (!currentSessionId) {
    return;
  }

  if (attachAttemptedSessionRef.current === currentSessionId) {
    return;
  }

  // 如果本地流式刚开始（2秒内），阻止 attach 触发，避免覆盖本地刚添加的用户消息。
  // 这个保护确保用户发送第一条消息后，本地状态有足够时间稳定，不会被 attach 流程覆盖。
  if (activeStreamStartedAt !== null && Date.now() - activeStreamStartedAt < 2000) {
    return;
  }

  attachAttemptedSessionRef.current = currentSessionId;
  lastAttachAttemptTimestampRef.current = Date.now();
  console.log('[ATTACH_ELIGIBILITY] proceeding with attach for', currentSessionId);

  const sid = currentSessionId;
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
    const committed = commitStreamingRound({
      accumulated,
      accumulatedSegments,
      accumulatedThinking,
      accumulatedThinkingBlocks,
      buildTraceMessage: (messageId, textContent) =>
        buildAttachTraceMessage(messageId, textContent, 'completed'),
      clientRequestId: attachStreamClientRequestId
        ? createRoundAssistantRequestId(attachStreamClientRequestId, currentRoundIndex)
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

  const handleAttachReconnect = (technicalDetail?: string) => {
    if (technicalDetail) {
      setStreamError(
        formatGatewayStreamErrorMessage(
          'ATTACH_STREAM_DISCONNECTED',
          '实时流连接已断开。',
          technicalDetail,
        ),
      );
    }
    handleInterruptedAttachStream({
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
        loadCurrentSessionSnapshot,
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
              setSessionStateStatus('paused');
              resetStreamState();
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
        setSessionStateStatus(isPausedForPermission ? 'paused' : 'idle');
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
            replaceMessages: true,
          }).catch(() => undefined);
        }, 500);
        requestSessionListRefresh();
      },
      onReconnectRequired: (_reason, technicalDetail) => {
        attachReconnectWiring.handleReconnectRequired(technicalDetail);
      },
    })
    .then((attachResult) => {
      if (!isCurrentSessionRequest(sid, attachSessionViewEpoch)) {
        return;
      }
      switch (attachResult.status) {
        case 'attached': {
          attachStreamClientRequestId = client.getActiveStreamClientRequestId();
          cancelAttachRetry();
          setStreamError(null);
          // 标记这个会话的 attach 已成功完成，防止后续重复触发
          console.log('[ATTACH_ELIGIBILITY] attach succeeded for', sid);
          return;
        }

        case 'no_active_stream': {
          // 网关已权威确认「没有活跃流」：这是正常终态而非断连，绝不能弹出
          // 「自动重连中」横幅。保留 attachAttemptedSessionRef 标记（attach 调用前
          // 已设置），避免 effect 立即重复 attach。
          cancelAttachRetry();
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
}
