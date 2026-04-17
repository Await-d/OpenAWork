import { useCallback } from 'react';
import type {
  Session,
  SessionActiveStream,
  SessionMessageRatingRecord,
  SessionTask,
  PendingPermissionRequest,
  PendingQuestionRequest,
} from '@openAwork/web-client';
import type { ChatMessage } from './support.js';
import type { SessionStateStatus, SessionTodoItem } from './session-runtime.js';
import type { RecoveredActiveAssistantStream } from './stream-recovery.js';
import { createSessionsClient } from '@openAwork/web-client';
import type { ChatRightPanelState } from '../chat-stream-state.js';
import { reconcileSnapshotChatMessages } from './support.js';
import {
  prepareSessionRecoveryState,
  buildRightPanelStateFromSessionSnapshot,
} from './chat-page-utils.js';
import { getRecoveryPendingInteractions } from './recovery-read-model.js';
import {
  flattenSessionTodoLanes,
  mergeChildSessions,
  mergeSessionTasks,
} from './session-runtime.js';
import { recoverActiveAssistantStream } from './stream-recovery.js';

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
  setPendingPermissions: (
    value:
      | PendingPermissionRequest[]
      | ((prev: PendingPermissionRequest[]) => PendingPermissionRequest[]),
  ) => void;
  setPendingQuestions: (
    value:
      | PendingQuestionRequest[]
      | ((prev: PendingQuestionRequest[]) => PendingQuestionRequest[]),
  ) => void;
  setSessionStateStatus: (value: SessionStateStatus | null) => void;
  setRecoveredStreamSnapshot: (value: RecoveredActiveAssistantStream | null) => void;
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
  ) => void;
  loadCurrentSessionSnapshot: (
    targetSessionId: string,
    options?: {
      expectedSessionViewEpoch?: number;
      replaceMessages?: boolean;
      signal?: AbortSignal;
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
    setPendingPermissions,
    setPendingQuestions,
    setSessionStateStatus,
    setRecoveredStreamSnapshot,
    setIsSessionSnapshotReady,
  } = setters;

  const loadSessionRuntimeSnapshot = useCallback(
    async (targetSessionId: string, signal?: AbortSignal, expectedSessionViewEpoch?: number) => {
      if (!token) return;
      const sessionViewEpoch = expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const recovery = await createSessionsClient(gatewayUrl).getRecovery(token, targetSessionId, {
        signal,
      });
      if (signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch)) return;
      const pendingInteractions = getRecoveryPendingInteractions(recovery);
      setSessionTodos(flattenSessionTodoLanes(recovery.todoLanes));
      setChildSessions((previous) => mergeChildSessions(previous, recovery.children));
      setSessionTasks((previous) => mergeSessionTasks(previous, recovery.tasks));
      setPendingPermissions(pendingInteractions.pendingPermissions);
      setPendingQuestions(pendingInteractions.pendingQuestions);
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
    ],
  );

  const syncRecoveredStreamSnapshot = useCallback(
    (
      session: Session,
      nextSessionStateStatus: SessionStateStatus | null,
      activeStream: SessionActiveStream | null,
    ) => {
      setRecoveredStreamSnapshot(
        recoverActiveAssistantStream({
          activeStreamStartedAt: activeStream?.startedAtMs ?? null,
          hasActiveStream: activeStream !== null,
          runEvents: Array.isArray(session.runEvents) ? session.runEvents : [],
          sessionStateStatus: nextSessionStateStatus,
        }),
      );
    },
    [setRecoveredStreamSnapshot],
  );

  const loadCurrentSessionSnapshot = useCallback(
    async (
      targetSessionId: string,
      options?: {
        expectedSessionViewEpoch?: number;
        replaceMessages?: boolean;
        signal?: AbortSignal;
      },
    ) => {
      if (!token) return;
      const sessionViewEpoch =
        options?.expectedSessionViewEpoch ?? currentSessionViewRef.current.epoch;
      const recovery = await createSessionsClient(gatewayUrl).getRecovery(token, targetSessionId, {
        signal: options?.signal,
      });
      if (options?.signal?.aborted || !isCurrentSessionView(targetSessionId, sessionViewEpoch))
        return;

      const prepared = prepareSessionRecoveryState(recovery);
      if (options?.replaceMessages === true) {
        setMessages(prepared.normalizedMessages);
      } else if (streamingRef.current) {
        // skip reconciliation during streaming
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
      setPendingPermissions(prepared.pendingPermissions);
      setPendingQuestions(prepared.pendingQuestions);
      setSessionStateStatus(prepared.sessionStateStatus);
      syncRecoveredStreamSnapshot(
        prepared.session,
        prepared.sessionStateStatus,
        recovery.activeStream,
      );
      setIsSessionSnapshotReady(true);
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
      setPendingPermissions,
      setPendingQuestions,
      setSessionStateStatus,
      setIsSessionSnapshotReady,
    ],
  );

  return { loadSessionRuntimeSnapshot, syncRecoveredStreamSnapshot, loadCurrentSessionSnapshot };
}
