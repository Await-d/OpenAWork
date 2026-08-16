import { startTransition, useCallback } from 'react';
import type { UpstreamStreamSummary, WorkflowRuntimeState } from '@openAwork/shared';
import type {
  Session,
  SessionActiveStream,
  SessionMessageRatingRecord,
  SessionTask,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from '@openAwork/web-client';
import type { ChatMessage } from '../../../../components/conversation-runtime/messages/support.js';
import type {
  SessionStateStatus,
  SessionTodoItem,
} from '../../../../components/conversation-runtime/session/session-runtime.js';
import type { RecoveredActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatRightPanelState } from '../../state/chat-stream-state.js';
import { reconcileSnapshotChatMessages } from '../../../../components/conversation-runtime/messages/support.js';
import {
  prepareSessionRecoveryState,
  buildRightPanelStateFromSessionSnapshot,
} from '../render/chat-page-utils.js';
import { getRecoveryPendingInteractions } from '../../../../components/conversation-runtime/session/recovery-read-model.js';
import {
  flattenSessionTodoLanes,
  mergeChildSessions,
  mergeSessionTasks,
} from '../../../../components/conversation-runtime/session/session-runtime.js';
import { recoverActiveAssistantStream } from '../../../../components/conversation-runtime/stream/stream-recovery.js';

export interface SessionSnapshotLoaderRefs {
  currentSessionViewRef: React.MutableRefObject<{ epoch: number; sessionId: string | null }>;
  streamingRef: React.MutableRefObject<boolean>;
}

export interface SessionSnapshotLoaderSetters {
  setMessages: (value: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => void;
  setMessageRatings: (
    value:
      | Record<string, SessionMessageRatingRecord>
      | ((
          prev: Record<string, SessionMessageRatingRecord>,
        ) => Record<string, SessionMessageRatingRecord>),
  ) => void;
  setRightPanelState: (
    value: ChatRightPanelState | ((prev: ChatRightPanelState) => ChatRightPanelState),
  ) => void;
  setSessionTodos: (
    value: SessionTodoItem[] | ((prev: SessionTodoItem[]) => SessionTodoItem[]),
  ) => void;
  setChildSessions: (value: Session[] | ((prev: Session[]) => Session[])) => void;
  setSessionTasks: (value: SessionTask[] | ((prev: SessionTask[]) => SessionTask[])) => void;
  setWorkflowRuntime: (value: WorkflowRuntimeState | null) => void;
  setPendingPermissions: (
    value:
      | PendingPermissionRequest[]
      | ((prev: PendingPermissionRequest[]) => PendingPermissionRequest[]),
  ) => void;
  setPendingQuestions: (
    value:
      PendingQuestionRequest[] | ((prev: PendingQuestionRequest[]) => PendingQuestionRequest[]),
  ) => void;
  setSessionStateStatus: (value: SessionStateStatus | null) => void;
  setRecoveryActiveStream: (value: SessionActiveStream | null) => void;
  setLatestUpstreamSummary: (value: UpstreamStreamSummary | null) => void;
  setRecoveredStreamSnapshot: (
    value:
      | RecoveredActiveAssistantStream
      | null
      | ((prev: RecoveredActiveAssistantStream | null) => RecoveredActiveAssistantStream | null),
  ) => void;
  setIsSessionSnapshotReady: (value: boolean) => void;
}

export interface SessionSnapshotLoaderReturn {
  loadSessionRuntimeSnapshot: (
    targetSessionId: string,
    signal?: AbortSignal,
    expectedSessionViewEpoch?: number,
  ) => Promise<void>;
  syncRecoveredStreamSnapshot: (
    session: Session,
    nextSessionStateStatus: SessionStateStatus | null,
    activeStream: SessionActiveStream | null,
    messages: ChatMessage[],
  ) => void;
  loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?: {
      expectedSessionViewEpoch?: number;
      messageLimit?: number;
      replaceMessages?: boolean;
      signal?: AbortSignal;
      since?: number;
    },
  ) => Promise<void>;
}

export function useSessionSnapshotLoader(
  gatewayUrl: string,
  token: string | null,
  isCurrentSessionView: (targetSessionId: string, expectedEpoch: number) => boolean,
  refs: SessionSnapshotLoaderRefs,
  setters: SessionSnapshotLoaderSetters,
): SessionSnapshotLoaderReturn {
  const { currentSessionViewRef, streamingRef } = refs;
  const {
    setMessages,
    setMessageRatings,
    setRightPanelState,
    setSessionTodos,
    setChildSessions,
    setSessionTasks,
    setWorkflowRuntime,
    setPendingPermissions,
    setPendingQuestions,
    setSessionStateStatus,
    setRecoveryActiveStream,
    setLatestUpstreamSummary,
    setRecoveredStreamSnapshot,
    setIsSessionSnapshotReady,
  } = setters;

  const loadSessionRuntimeSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal, expectedSessionViewEpoch?: number) => {
      if (!token) return;
      const sessionViewEpoch = expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const status = await createSessionsClient(gatewayUrl).getStatus(token, targetSessionId, {
        signal,
      });
      if (signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch)) return;
      const pendingInteractions = getRecoveryPendingInteractions(status);
      setSessionTodos(flattenSessionTodoLanes(status.todoLanes));
      setChildSessions((previous) => mergeChildSessions(previous, status.children));
      setSessionTasks((previous) => mergeSessionTasks(previous, status.tasks));
      setPendingPermissions(pendingInteractions.pendingPermissions);
      setPendingQuestions(pendingInteractions.pendingQuestions);
      setRecoveryActiveStream(status.activeStream);
      setWorkflowRuntime(status.workflowRuntime);
    },
    [
      gatewayUrl,
      isCurrentSessionView,
      token,
      currentSessionViewRef,
      setSessionTodos,
      setChildSessions,
      setSessionTasks,
      setPendingPermissions,
      setPendingQuestions,
      setRecoveryActiveStream,
      setWorkflowRuntime,
    ],
  );

  const syncRecoveredStreamSnapshot = useCallback(
    (
      session: Session,
      nextSessionStateStatus: SessionStateStatus | null,
      activeStream: SessionActiveStream | null,
      messages: ChatMessage[],
    ) => {
      const next = recoverActiveAssistantStream({
        activeStreamStartedAt: activeStream?.startedAtMs ?? null,
        hasActiveStream: activeStream !== null,
        messages,
        runEvents: Array.isArray(session.runEvents) ? session.runEvents : [],
        sessionStateStatus: nextSessionStateStatus,
      });
      if (next !== null) {
        setLatestUpstreamSummary(next.upstreamSummary ?? null);
        setRecoveredStreamSnapshot(next);
        return;
      }
      // When recovery yields no renderable snapshot but the session is still
      // running (or paused), keep any previously cached snapshot — for example
      // one populated from useSessionViewCache when switching back into a
      // mid-flight session — until the attach pipeline overwrites it.
      const sessionStillStreaming =
        activeStream !== null ||
        nextSessionStateStatus === 'running' ||
        nextSessionStateStatus === 'paused';
      if (!sessionStillStreaming) {
        setLatestUpstreamSummary(null);
      }
      setRecoveredStreamSnapshot((previous) => (sessionStillStreaming ? previous : null));
    },
    [setLatestUpstreamSummary, setRecoveredStreamSnapshot],
  );

  const loadCurrentSessionSnapshot = useCallback(
    async (
      targetSessionId: string,
      options?: {
        expectedSessionViewEpoch?: number;
        messageLimit?: number;
        replaceMessages?: boolean;
        signal?: AbortSignal;
        since?: number;
      },
    ) => {
      if (!token) return;
      const sessionViewEpoch =
        options?.expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const recovery = await createSessionsClient(gatewayUrl).getRecovery(token, targetSessionId, {
        messageLimit: options?.messageLimit,
        signal: options?.signal,
        since: options?.since,
      });
      if (options?.signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch))
        return;

      const prepared = prepareSessionRecoveryState(recovery);
      // Mark recovery-driven state syncs as a transition so React can split
      // the commit across frames and yield to higher-priority work (input,
      // SSE `message` handler). Without this, a fresh recovery payload of
      // ~10 messages with reasoning + tool cards lands as a single ~400ms
      // synchronous render — surfacing as `[Violation] 'message' handler`
      // because React's Scheduler dispatches commits via MessageChannel.
      startTransition(() => {
        if (options?.replaceMessages === true) {
          setMessages(prepared.normalizedMessages);
        } else if (streamingRef.current) {
          // skip reconciliation during streaming
        } else if (prepared.normalizedMessages.length === 0) {
          // skip — server returned empty snapshot, don't wipe local messages
        } else {
          setMessages((previous) =>
            reconcileSnapshotChatMessages(previous, prepared.normalizedMessages),
          );
        }
        setMessageRatings(prepared.messageRatings);
        setRightPanelState(
          buildRightPanelStateFromSessionSnapshot(prepared.session, prepared.normalizedMessages),
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
    },
    [
      gatewayUrl,
      isCurrentSessionView,
      syncRecoveredStreamSnapshot,
      token,
      currentSessionViewRef,
      streamingRef,
      setMessages,
      setMessageRatings,
      setRightPanelState,
      setSessionTodos,
      setChildSessions,
      setSessionTasks,
      setWorkflowRuntime,
      setPendingPermissions,
      setPendingQuestions,
      setSessionStateStatus,
      setRecoveryActiveStream,
      setIsSessionSnapshotReady,
    ],
  );

  return { loadSessionRuntimeSnapshot, syncRecoveredStreamSnapshot, loadCurrentSessionSnapshot };
}
