/**
 * 会话切换 effect 的逻辑体（P2 原样搬家）。
 *
 * 由 `ChatPage` 的 `useEffect` 原位调用：依赖对象在 effect 回调**内部**构造，
 * 既保留原有 effect 执行顺序，又避免「后声明的值被急切求值」的 TDZ 问题。
 * 返回原 effect 的 cleanup（若有）。
 */
import type { ChatView } from '../../../stores/ui/uiState.js';
import { reconcileSnapshotChatMessages } from '../../../components/conversation-runtime/messages/support.js';
import type { AssistantTraceToolCall, ChatMessage, ChatMessagePart, ReasoningEffort } from '../../../components/conversation-runtime/messages/support.js';
import type { RecoveredActiveAssistantStream } from '../../../components/conversation-runtime/stream/stream-recovery.js';
import type { ChatBackendUsageSnapshot } from '../../../components/conversation-runtime/stream/stream-usage.js';
import type { StreamingThinkingBlock } from '../../../components/conversation-runtime/stream/streaming-thinking.js';
import { useDisplayPreferencesStore } from '../../../stores/settings/display-preferences.js';
import { extractWorkingDirectory } from '../../../utils/session/session-metadata.js';
import type { SessionViewCacheReturn } from '../conversation/snapshot/use-session-view-cache.js';
import { SESSION_SWITCH_DEFER_THRESHOLD, buildRightPanelStateFromSessionSnapshot, createSessionMetadataSnapshot, prepareSessionRecoveryState } from '.././conversation/render/chat-page-utils.js';
import { resolveModelSelectionSourceFromMetadata } from '.././conversation/settings/model-selection-source.js';
import type { ModelSelectionSource } from '.././conversation/settings/model-selection-source.js';
import { shouldPreserveActiveLocalStream } from '.././conversation/snapshot/session-reload-transition.js';
import type { SessionViewStreamingSnapshot } from '../conversation/snapshot/use-session-view-cache.js';
import type { DialogueMode } from '.././mode/dialogue-mode.js';
import { createInitialChatRightPanelState, getToolCallCards } from '.././state/chat-stream-state.js';
import type { ChatRightPanelState } from '.././state/chat-stream-state.js';
import type { PendingPermissionRequest, SessionPermissionMode, UpstreamStreamSummary, WorkflowRuntimeState } from '@openAwork/shared';
import { createSessionsClient } from '@openAwork/web-client';
import type { PendingQuestionRequest, Session, SessionActiveStream, SessionMessageRatingRecord, SessionTask, SessionTodo } from '@openAwork/web-client';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction, TransitionStartFunction } from 'react';

export interface ChatSessionSwitchDeps {
  readonly activateSessionView: (nextSessionId: string | null, options?: { incrementEpoch?: boolean | undefined; } | undefined) => number;
  readonly activeSessionRef: MutableRefObject<string | null>;
  readonly activeStreamStartedAtRef: RefObject<number | null>;
  readonly attachAttemptedSessionRef: RefObject<string | null>;
  readonly cancelAttachRetry: () => void;
  readonly chatView: ChatView;
  readonly clearSessionMetadataDirty: () => void;
  readonly currentAssistantStreamMessageIdRef: MutableRefObject<string | null>;
  readonly currentLoadedSessionIdRef: MutableRefObject<string | null>;
  readonly gatewayUrl: string;
  readonly isCurrentSessionView: (targetSessionId: string, expectedEpoch: number) => boolean;
  readonly lastPersistedSessionMetadataSnapshotRef: RefObject<string | null>;
  readonly latestUpstreamSummary: UpstreamStreamSummary | null;
  readonly messagesRef: MutableRefObject<ChatMessage[]>;
  readonly navigateToHome: () => void;
  readonly navigateToSession: () => void;
  readonly pendingBootstrapSessionRef: MutableRefObject<string | null>;
  readonly pendingSessionNormalizeTimeoutRef: MutableRefObject<number | null>;
  readonly reportedStreamUsageRef: RefObject<ChatBackendUsageSnapshot | null>;
  readonly resetStreamState: () => void;
  readonly restoreScrollTop: (top: number) => void;
  readonly rightPanelStateRef: RefObject<ChatRightPanelState>;
  readonly scrollRegionRef: RefObject<HTMLDivElement | null>;
  readonly sessionId: string | undefined;
  readonly sessionMetadataDirtyRef: RefObject<boolean>;
  readonly sessionModelSelectionSourceRef: RefObject<ModelSelectionSource | null>;
  readonly sessionReloadNonce: number;
  readonly sessionRestoredFromCacheRef: RefObject<boolean>;
  readonly sessionStateStatus: "idle" | "running" | "paused" | null | undefined;
  readonly sessionViewCache: SessionViewCacheReturn;
  readonly setActiveModelId: Dispatch<SetStateAction<string>>;
  readonly setActiveProviderId: Dispatch<SetStateAction<string>>;
  readonly setChildSessions: Dispatch<SetStateAction<Session[]>>;
  readonly setCurrentSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setDialogueMode: Dispatch<SetStateAction<DialogueMode>>;
  readonly setIsSessionLoading: Dispatch<SetStateAction<boolean>>;
  readonly setIsSessionSnapshotReady: Dispatch<SetStateAction<boolean>>;
  readonly setManualAgentId: Dispatch<SetStateAction<string>>;
  readonly setMessageRatings: Dispatch<SetStateAction<Record<string, SessionMessageRatingRecord>>>;
  readonly setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  readonly setPendingPermissions: Dispatch<SetStateAction<PendingPermissionRequest[]>>;
  readonly setPendingQuestions: Dispatch<SetStateAction<PendingQuestionRequest[]>>;
  readonly setPermissionMode: Dispatch<SetStateAction<SessionPermissionMode>>;
  readonly setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  readonly setRecoveredStreamSnapshot: Dispatch<SetStateAction<RecoveredActiveAssistantStream | null>>;
  readonly setRecoveryActiveStream: Dispatch<SetStateAction<SessionActiveStream | null>>;
  readonly setRightPanelState: Dispatch<SetStateAction<ChatRightPanelState>>;
  readonly setSelectedChildSessionId: Dispatch<SetStateAction<string | null>>;
  readonly setServerTotalTurnCount: Dispatch<SetStateAction<number | null>>;
  readonly setSessionModesHydrated: Dispatch<SetStateAction<boolean>>;
  readonly setSessionStateStatus: Dispatch<SetStateAction<"idle" | "running" | "paused" | null | undefined>>;
  readonly setSessionTasks: Dispatch<SetStateAction<SessionTask[]>>;
  readonly setSessionTodos: Dispatch<SetStateAction<SessionTodo[]>>;
  readonly setShowSkeletonAfterDelay: Dispatch<SetStateAction<boolean>>;
  readonly setThinkingEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setVisibleMessageCount: Dispatch<SetStateAction<number>>;
  readonly setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  readonly setWorkflowRuntime: Dispatch<SetStateAction<WorkflowRuntimeState | null>>;
  readonly skeletonDelayTimerRef: RefObject<number | null>;
  readonly startSessionSwitchTransition: TransitionStartFunction;
  readonly streamBufferRef: RefObject<string>;
  readonly streamThinkingBlocksRef: RefObject<StreamingThinkingBlock[]>;
  readonly streamingRef: MutableRefObject<boolean>;
  readonly streamingSegmentsRef: RefObject<ChatMessagePart[]>;
  readonly syncRecoveredStreamSnapshot: (session: Session, nextSessionStateStatus: "idle" | "running" | "paused" | null | undefined, activeStream: SessionActiveStream | null, messages: ChatMessage[]) => void;
  readonly token: string | null;
  readonly webSearchAvailable: boolean;
  readonly DEFAULT_VISIBLE_MESSAGE_COUNT: 20;
  readonly INITIAL_TURN_LIMIT: 10;
}

export function runChatSessionSwitchEffect(
  deps: ChatSessionSwitchDeps,
): (() => void) | void {
  const {
  activateSessionView,
  activeSessionRef,
  activeStreamStartedAtRef,
  attachAttemptedSessionRef,
  cancelAttachRetry,
  chatView,
  clearSessionMetadataDirty,
  currentAssistantStreamMessageIdRef,
  currentLoadedSessionIdRef,
  gatewayUrl,
  isCurrentSessionView,
  lastPersistedSessionMetadataSnapshotRef,
  latestUpstreamSummary,
  messagesRef,
  navigateToHome,
  navigateToSession,
  pendingBootstrapSessionRef,
  pendingSessionNormalizeTimeoutRef,
  reportedStreamUsageRef,
  resetStreamState,
  restoreScrollTop,
  rightPanelStateRef,
  scrollRegionRef,
  sessionId,
  sessionMetadataDirtyRef,
  sessionModelSelectionSourceRef,
  sessionReloadNonce,
  sessionRestoredFromCacheRef,
  sessionStateStatus,
  sessionViewCache,
  setActiveModelId,
  setActiveProviderId,
  setChildSessions,
  setCurrentSessionId,
  setDialogueMode,
  setIsSessionLoading,
  setIsSessionSnapshotReady,
  setManualAgentId,
  setMessageRatings,
  setMessages,
  setPendingPermissions,
  setPendingQuestions,
  setPermissionMode,
  setReasoningEffort,
  setRecoveredStreamSnapshot,
  setRecoveryActiveStream,
  setRightPanelState,
  setSelectedChildSessionId,
  setServerTotalTurnCount,
  setSessionModesHydrated,
  setSessionStateStatus,
  setSessionTasks,
  setSessionTodos,
  setShowSkeletonAfterDelay,
  setThinkingEnabled,
  setVisibleMessageCount,
  setWebSearchEnabled,
  setWorkflowRuntime,
  skeletonDelayTimerRef,
  startSessionSwitchTransition,
  streamBufferRef,
  streamThinkingBlocksRef,
  streamingRef,
  streamingSegmentsRef,
  syncRecoveredStreamSnapshot,
  token,
  webSearchAvailable,
  DEFAULT_VISIBLE_MESSAGE_COUNT,
  INITIAL_TURN_LIMIT
  } = deps;

    const requestedSessionId = sessionId ?? null;
    const shouldPreserveBootstrapState = pendingBootstrapSessionRef.current === requestedSessionId;
    const shouldPreserveActiveStream =
      !shouldPreserveBootstrapState &&
      shouldPreserveActiveLocalStream({
        activeSessionId: activeSessionRef.current,
        isStreaming: streamingRef.current,
        loadedSessionId: currentLoadedSessionIdRef.current,
        requestedSessionId,
      });
    const shouldSoftReloadCurrentSession =
      sessionReloadNonce > 0 &&
      requestedSessionId !== null &&
      requestedSessionId === currentLoadedSessionIdRef.current;
    void sessionReloadNonce;

    const sessionViewEpoch =
      shouldPreserveBootstrapState || shouldPreserveActiveStream || shouldSoftReloadCurrentSession
        ? activateSessionView(requestedSessionId, { incrementEpoch: false })
        : activateSessionView(requestedSessionId);

    if (!requestedSessionId || !token) {
      cancelAttachRetry();
      attachAttemptedSessionRef.current = null;
      setRecoveryActiveStream(null);
      if (currentLoadedSessionIdRef.current !== null) {
        if (chatView !== 'home') {
          navigateToHome();
        }
        setCurrentSessionId(null);
        setSelectedChildSessionId(null);
        setIsSessionLoading(false);
        setMessages([]);
        setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
        setServerTotalTurnCount(null);
        setRightPanelState(createInitialChatRightPanelState());
        setSessionTodos([]);
        setChildSessions([]);
        setSessionTasks([]);
        setWorkflowRuntime(null);
        setPendingPermissions([]);
        setPendingQuestions([]);
        setSessionStateStatus(null);
        setIsSessionSnapshotReady(true);
        setSessionModesHydrated(false);
        clearSessionMetadataDirty();
        lastPersistedSessionMetadataSnapshotRef.current = null;
        resetStreamState();
        setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
        currentLoadedSessionIdRef.current = null;
      }
      return;
    }

    if (shouldPreserveActiveStream) {
      if (chatView !== 'session') {
        navigateToSession();
      }
      return;
    }

    let cancelled = false;
    const runtimeSnapshotController = new AbortController();

    // Save current session view to cache before switching away. When a stream is
    // mid-flight on the previous session, also snapshot the live streaming buffers
    // and right-panel state so that switching back can immediately repaint the
    // in-progress assistant message instead of waiting for an attach event.
    const previousSessionId = currentLoadedSessionIdRef.current;
    if (previousSessionId && previousSessionId !== requestedSessionId) {
      let streamingSnapshot: SessionViewStreamingSnapshot | undefined;
      if (streamingRef.current) {
        const cachedToolCalls: AssistantTraceToolCall[] = getToolCallCards(
          rightPanelStateRef.current,
        ).map((toolCall) => ({
          toolCallId: toolCall.toolCallId,
          toolName: toolCall.toolName,
          input: toolCall.input,
          ...(toolCall.output !== undefined ? { output: toolCall.output } : {}),
          isError: toolCall.isError,
          ...(toolCall.pendingPermissionRequestId
            ? {
                pendingPermissionRequestId: toolCall.pendingPermissionRequestId,
              }
            : {}),
          ...(toolCall.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
          status: toolCall.status,
        }));
        streamingSnapshot = {
          recoveredStream: {
            messageId: currentAssistantStreamMessageIdRef.current,
            parts: streamingSegmentsRef.current,
            startedAt: activeStreamStartedAtRef.current,
            text: streamBufferRef.current,
            thinkingBlocks: streamThinkingBlocksRef.current,
            toolCalls: cachedToolCalls,
            usage: reportedStreamUsageRef.current,
            ...(latestUpstreamSummary ? { upstreamSummary: latestUpstreamSummary } : {}),
          },
          rightPanelState: rightPanelStateRef.current,
        };
      }
      sessionViewCache.save(
        previousSessionId,
        messagesRef.current,
        scrollRegionRef.current,
        streamingSnapshot,
      );
    }

    if (chatView !== 'session') {
      navigateToSession();
    }
    cancelAttachRetry();
    attachAttemptedSessionRef.current = null;
    setRecoveryActiveStream(null);
    setCurrentSessionId(requestedSessionId);

    if (shouldPreserveBootstrapState) {
      setSelectedChildSessionId(null);
      pendingBootstrapSessionRef.current = null;
      setIsSessionLoading(false);
      setIsSessionSnapshotReady(true);
      clearSessionMetadataDirty();
      setSessionModesHydrated(true);
      return () => {
        cancelled = true;
      };
    }

    if (shouldSoftReloadCurrentSession) {
      createSessionsClient(gatewayUrl)
        .getRecovery(token, requestedSessionId, {
          messageLimit: INITIAL_TURN_LIMIT,
          signal: runtimeSnapshotController.signal,
        })
        .then((recovery) => {
          if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
            return;
          }

          const prepared = prepareSessionRecoveryState(recovery);
          startSessionSwitchTransition(() => {
            if (!streamingRef.current) {
              setMessages((previous) =>
                reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
              );
            }
            setMessageRatings(prepared.messageRatings);
            setRightPanelState(
              buildRightPanelStateFromSessionSnapshot(
                prepared.session,
                prepared.normalizedMessages,
              ),
            );
            setSessionTodos(prepared.sessionTodos);
            setChildSessions(recovery.children);
            setSessionTasks(recovery.tasks);
            setWorkflowRuntime(prepared.session.workflowRuntime ?? null);
            setPendingPermissions(prepared.pendingPermissions);
            setPendingQuestions(prepared.pendingQuestions);
            setSessionStateStatus(prepared.sessionStateStatus);
            setRecoveryActiveStream(recovery.activeStream);
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
              prepared.normalizedMessages,
            );
            setIsSessionSnapshotReady(true);
          });
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
        runtimeSnapshotController.abort();
        if (pendingSessionNormalizeTimeoutRef.current !== null) {
          window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
          pendingSessionNormalizeTimeoutRef.current = null;
        }
      };
    }

    // Check cache for the target session to avoid skeleton flash
    const cachedView = sessionViewCache.restore(requestedSessionId);

    setSelectedChildSessionId(null);
    if (cachedView) {
      // Apply cached messages immediately — skip skeleton.
      // Wrap state mutations in `startTransition` so React 19 can yield
      // during the commit. With long histories the cached snapshot
      // applies in one synchronous setState chain; without a transition
      // that's a single ~200–350ms task surfacing as
      // `[Violation] 'message' handler took XYZms`.
      sessionRestoredFromCacheRef.current = true;
      const cachedMessages = cachedView.messages;
      const cachedScrollTop = cachedView.scrollTop;
      startSessionSwitchTransition(() => {
        setMessages(cachedMessages);
        setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
        setIsSessionLoading(false);
      });
      // Restore scroll position after React renders the cached messages.
      // A single rAF ensures at least one paint cycle has completed; the
      // manager's restore primitive performs its own rAF internally to land
      // the position, deriving follow state from that restore. 缓存恢复不是
      // 用户手势：恢复在历史中部会挂起跟随，恢复在真正底部继续跟随；
      // 全程不武装任何忽略窗口。
      requestAnimationFrame(() => {
        if (!cancelled) {
          restoreScrollTop(cachedScrollTop);
        }
      });
    } else {
      sessionRestoredFromCacheRef.current = false;
      startSessionSwitchTransition(() => {
        setIsSessionLoading(true);
        // 如果是同一个会话且对话已完成，不清空消息列表
        // 避免在对话完成后重新加载导致消息短暂消失
        if (
          requestedSessionId !== currentLoadedSessionIdRef.current ||
          sessionStateStatus !== 'idle'
        ) {
          setMessages([]);
        } else {
          console.log('[SESSION_LOAD] 跳过清空消息，同一会话且已完成', {
            requestedSessionId,
            currentLoadedSessionId: currentLoadedSessionIdRef.current,
            sessionStateStatus,
          });
        }
        setVisibleMessageCount(DEFAULT_VISIBLE_MESSAGE_COUNT);
      });
      // 延迟显示骨架屏，避免快速加载时的闪烁
      // 只有在加载时间超过 300ms 时才显示骨架屏
      setShowSkeletonAfterDelay(false);
      if (skeletonDelayTimerRef.current !== null) {
        window.clearTimeout(skeletonDelayTimerRef.current);
      }
      skeletonDelayTimerRef.current = window.setTimeout(() => {
        setShowSkeletonAfterDelay(true);
        skeletonDelayTimerRef.current = null;
      }, 300);
    }
    setRightPanelState(createInitialChatRightPanelState());
    setServerTotalTurnCount(null);
    setChildSessions([]);
    setSessionTasks([]);
    setWorkflowRuntime(null);
    setPendingPermissions([]);
    setPendingQuestions([]);
    setSessionStateStatus(null);
    setRecoveryActiveStream(null);
    setIsSessionSnapshotReady(false);
    setSessionModesHydrated(false);
    // 必须同时重置 ref 和 state —— 如果只 setSessionMetadataDirty(false)，
    // sessionMetadataDirtyRef.current 会保留上一个会话的 dirty 标记，
    // 导致 recovery 回调中 if (!sessionMetadataDirtyRef.current) 判断为 false，
    // 会话 metadata 中的 providerId/modelId 不被应用，输入框显示的是旧模型。
    clearSessionMetadataDirty();
    sessionModelSelectionSourceRef.current = null;
    lastPersistedSessionMetadataSnapshotRef.current = null;
    resetStreamState();
    setDialogueMode(useDisplayPreferencesStore.getState().defaultDialogueMode);
    setManualAgentId('');
    setPermissionMode('ask');
    setWebSearchEnabled(webSearchAvailable);
    setThinkingEnabled(false);
    setReasoningEffort('medium');
    setActiveProviderId('');
    setActiveModelId('');

    // If we cached an in-flight streaming snapshot for this session, replay it
    // immediately so the user sees the in-progress assistant message right away.
    // The subsequent getRecovery + attach pipeline will then take over without
    // a visible "blank" gap.
    if (cachedView?.streamingSnapshot) {
      setRightPanelState(cachedView.streamingSnapshot.rightPanelState);
      setRecoveredStreamSnapshot(cachedView.streamingSnapshot.recoveredStream);
      setSessionStateStatus('running');
    }

    createSessionsClient(gatewayUrl)
      .getRecovery(token, requestedSessionId, {
        messageLimit: INITIAL_TURN_LIMIT,
        signal: runtimeSnapshotController.signal,
      })
      .then((recovery) => {
        console.log('[RECOVERY]', requestedSessionId, {
          activeStream: recovery.activeStream,
          sessionStateStatus: (recovery.session as unknown as Record<string, unknown>)
            ?.state_status,
        });
        if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
          console.log('[RECOVERY] skipped — cancelled or view mismatch');
          return;
        }
        const prepared = prepareSessionRecoveryState(recovery);
        const metadata = prepared.metadata;
        const applySessionPayload = () => {
          if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
            return;
          }

          startSessionSwitchTransition(() => {
            if (streamingRef.current) {
              // While streaming, don't replace messages — the stream is authoritative
            } else if (cachedView) {
              setMessages((previous) =>
                reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
              );
            } else {
              setMessages(prepared.normalizedMessages);
            }
            setMessageRatings(prepared.messageRatings);
            // When the previous in-flight streaming snapshot was just replayed from
            // the view cache, prefer keeping the cached right-panel state — the
            // server-side runEvents typically lag behind the live stream, so
            // rebuilding from them here would visually "lose" the in-progress tool
            // cards until attach catches up. The attach pipeline will continue
            // updating the right-panel state as new events arrive.
            const sessionStillStreamingFromRecovery =
              recovery.activeStream !== null ||
              prepared.sessionStateStatus === 'running' ||
              prepared.sessionStateStatus === 'paused';
            const shouldKeepCachedRightPanel = Boolean(
              cachedView?.streamingSnapshot && sessionStillStreamingFromRecovery,
            );
            if (!shouldKeepCachedRightPanel) {
              setRightPanelState(
                buildRightPanelStateFromSessionSnapshot(
                  prepared.session,
                  prepared.normalizedMessages,
                ),
              );
            }
            setSessionTodos(prepared.sessionTodos);
            setChildSessions(recovery.children);
            setSessionTasks(recovery.tasks);
            setWorkflowRuntime(prepared.session.workflowRuntime ?? null);
            setPendingPermissions(prepared.pendingPermissions);
            setPendingQuestions(prepared.pendingQuestions);
            setSessionStateStatus(prepared.sessionStateStatus);
            setRecoveryActiveStream(recovery.activeStream);
            syncRecoveredStreamSnapshot(
              prepared.session,
              prepared.sessionStateStatus,
              recovery.activeStream,
              prepared.normalizedMessages,
            );
            setIsSessionSnapshotReady(true);
            setServerTotalTurnCount(recovery.totalTurnCount ?? null);
            // 会话切换时的初始恢复 —— 无条件应用 metadata。
            // 之前用 if (!sessionMetadataDirtyRef.current) 守卫，但由于会话切换
            // useEffect 中已通过 clearSessionMetadataDirty() 重置了 ref，
            // 如果 ref 为 true 则说明用户在 recovery 异步窗口内手动改了模型，
            // 此时应当尊重用户选择。但对于 dialogueMode/yoloMode 等非模型设置，
            // 仍然应该在 ref 为 false 时才恢复（它们有自己的 dirty 语义）。
            if (!sessionMetadataDirtyRef.current) {
              setDialogueMode(
                metadata.dialogueMode ?? useDisplayPreferencesStore.getState().defaultDialogueMode,
              );
              setManualAgentId(metadata.agentId ?? '');
              setPermissionMode(metadata.permissionMode);
              setWebSearchEnabled(metadata.webSearchEnabled && webSearchAvailable);
              setThinkingEnabled(metadata.thinkingEnabled);
              setReasoningEffort(metadata.reasoningEffort);
            }
            // 模型选择必须无条件从 metadata 恢复 —— 这是会话绑定的核心数据。
            // 即使 sessionMetadataDirtyRef 在异步窗口中被设为 true（极端竞态），
            // 也应优先采用服务端 metadata 中的值，因为它代表了会话最后一次持久化的状态。
            setActiveProviderId(metadata.providerId ?? '');
            setActiveModelId(metadata.modelId ?? '');
            sessionModelSelectionSourceRef.current = resolveModelSelectionSourceFromMetadata({
              modelSelectionSource: metadata.modelSelectionSource,
              providerId: metadata.providerId,
              modelId: metadata.modelId,
            });
            lastPersistedSessionMetadataSnapshotRef.current = createSessionMetadataSnapshot({
              dialogueMode: metadata.dialogueMode,
              agentId: metadata.agentId,
              permissionMode: metadata.permissionMode,
              yoloMode: metadata.yoloMode,
              webSearchEnabled: metadata.webSearchEnabled,
              thinkingEnabled: metadata.thinkingEnabled,
              reasoningEffort: metadata.reasoningEffort,
              providerId: metadata.providerId,
              modelId: metadata.modelId,
              modelSelectionSource: metadata.modelSelectionSource,
              workingDirectory: extractWorkingDirectory(prepared.session.metadata_json),
            });
            if (!sessionMetadataDirtyRef.current) {
              clearSessionMetadataDirty();
            }
            setSessionModesHydrated(true);
            setIsSessionLoading(false);
            // 清除骨架屏延迟定时器
            if (skeletonDelayTimerRef.current !== null) {
              window.clearTimeout(skeletonDelayTimerRef.current);
              skeletonDelayTimerRef.current = null;
            }
            setShowSkeletonAfterDelay(false);
          });
        };

        if (prepared.normalizedMessages.length > SESSION_SWITCH_DEFER_THRESHOLD) {
          if (pendingSessionNormalizeTimeoutRef.current !== null) {
            window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
          }
          pendingSessionNormalizeTimeoutRef.current = window.setTimeout(() => {
            pendingSessionNormalizeTimeoutRef.current = null;
            applySessionPayload();
          }, 0);
          return;
        }

        applySessionPayload();
      })
      .catch(() => {
        if (cancelled || !isCurrentSessionView(requestedSessionId, sessionViewEpoch)) {
          return null;
        }
        setSessionTodos([]);
        setRightPanelState(createInitialChatRightPanelState());
        setSessionStateStatus(null);
        setRecoveryActiveStream(null);
        setIsSessionSnapshotReady(false);
        clearSessionMetadataDirty();
        setSessionModesHydrated(true);
        setIsSessionLoading(false);
        return null;
      });

    return () => {
      cancelled = true;
      runtimeSnapshotController.abort();
      if (pendingSessionNormalizeTimeoutRef.current !== null) {
        window.clearTimeout(pendingSessionNormalizeTimeoutRef.current);
        pendingSessionNormalizeTimeoutRef.current = null;
      }
    };
}
