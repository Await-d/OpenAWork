import type { PendingQuestionRequest } from '@openAwork/web-client';
import { logger } from '../log/logger.js';
import type { SessionPendingPermissionState } from '../permission/pending-permission-state.js';
export type { SessionPendingPermissionState } from '../permission/pending-permission-state.js';

const SESSION_LIST_REFRESH_EVENT = 'openAwork:sessions-refresh';
const CURRENT_SESSION_REFRESH_EVENT = 'openAwork:current-session-refresh';
const SESSION_PENDING_PERMISSION_EVENT = 'openAwork:session-pending-permission';
const SESSION_PENDING_QUESTION_EVENT = 'openAwork:session-pending-question';
const SESSION_RUN_STATE_EVENT = 'openAwork:session-run-state';

let refreshScheduled = false;
let pendingPermissionDispatchScheduled = false;
let pendingQuestionDispatchScheduled = false;
let runStateDispatchScheduled = false;
const pendingPermissionStateBySession = new Map<string, SessionPendingPermissionState | null>();
const pendingQuestionStateBySession = new Map<string, PendingQuestionRequest | null>();
const runStateBySession = new Map<string, SessionRunState>();
const pendingInteractionSnapshotListeners = new Set<() => void>();

export type SessionRunState = 'idle' | 'running' | 'paused';

export interface SessionPendingInteractionSnapshot {
  pendingPermissionBySession: ReadonlyMap<string, SessionPendingPermissionState>;
  pendingQuestionBySession: ReadonlyMap<string, PendingQuestionRequest>;
}

let pendingInteractionSnapshot: SessionPendingInteractionSnapshot = {
  pendingPermissionBySession: new Map(),
  pendingQuestionBySession: new Map(),
};

function publishPendingInteractionSnapshot(next: SessionPendingInteractionSnapshot): void {
  pendingInteractionSnapshot = next;
  for (const listener of pendingInteractionSnapshotListeners) {
    listener();
  }
}

/** 会话列表刷新监听器：允许返回 Promise，调用方（轮询控制器）可据此等待本轮落定。 */
export type SessionListRefreshListener = () => void | Promise<void>;

const refreshListeners = new Set<SessionListRefreshListener>();

let refreshInFlight: Promise<void> | null = null;

export function requestSessionListRefresh(): void {
  if (typeof window === 'undefined' || refreshScheduled) {
    return;
  }

  refreshScheduled = true;
  queueMicrotask(() => {
    refreshScheduled = false;
    window.dispatchEvent(new Event(SESSION_LIST_REFRESH_EVENT));
  });
}

/**
 * 完成感知的刷新入口：调用所有已注册 listener 并等待它们全部落定。
 * 并发调用会被合并为同一个在途 Promise（单飞），因此调用方可以
 * 「上一次刷新完成后」再排下一拍，而不是固定 interval 叠请求。
 */
export function refreshSessionListsNow(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }
  const pending = Array.from(refreshListeners, (listener) => {
    try {
      return Promise.resolve(listener());
    } catch (error) {
      logger.warn('Session list refresh listener threw synchronously', error);
      return Promise.resolve();
    }
  });
  refreshInFlight = Promise.allSettled(pending)
    .then(() => undefined)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

export function subscribeSessionListRefresh(onRefresh: SessionListRefreshListener): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  refreshListeners.add(onRefresh);

  const handleRefresh = () => {
    void onRefresh();
  };

  window.addEventListener(SESSION_LIST_REFRESH_EVENT, handleRefresh);
  return () => {
    refreshListeners.delete(onRefresh);
    window.removeEventListener(SESSION_LIST_REFRESH_EVENT, handleRefresh);
  };
}

export function requestCurrentSessionRefresh(sessionId: string): void {
  if (typeof window === 'undefined' || sessionId.trim().length === 0) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<{ sessionId: string }>(CURRENT_SESSION_REFRESH_EVENT, {
      detail: { sessionId },
    }),
  );
}

export function subscribeCurrentSessionRefresh(onRefresh: (sessionId: string) => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleRefresh = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    if (sessionId.trim().length > 0) {
      onRefresh(sessionId);
    }
  };

  window.addEventListener(CURRENT_SESSION_REFRESH_EVENT, handleRefresh);
  return () => window.removeEventListener(CURRENT_SESSION_REFRESH_EVENT, handleRefresh);
}

export function publishSessionPendingPermission(
  sessionId: string,
  permission: SessionPendingPermissionState | null,
): void {
  if (typeof window === 'undefined' || sessionId.trim().length === 0) {
    return;
  }

  pendingPermissionStateBySession.set(sessionId, permission);
  const nextPendingPermissionBySession = new Map(
    pendingInteractionSnapshot.pendingPermissionBySession,
  );
  if (permission) {
    nextPendingPermissionBySession.set(sessionId, permission);
  } else {
    nextPendingPermissionBySession.delete(sessionId);
  }
  publishPendingInteractionSnapshot({
    pendingPermissionBySession: nextPendingPermissionBySession,
    pendingQuestionBySession: pendingInteractionSnapshot.pendingQuestionBySession,
  });
  if (pendingPermissionDispatchScheduled) {
    return;
  }

  pendingPermissionDispatchScheduled = true;
  queueMicrotask(() => {
    pendingPermissionDispatchScheduled = false;
    const pendingEntries = Array.from(pendingPermissionStateBySession.entries());
    pendingPermissionStateBySession.clear();

    for (const [pendingSessionId, pendingPermission] of pendingEntries) {
      window.dispatchEvent(
        new CustomEvent<{ permission: SessionPendingPermissionState | null; sessionId: string }>(
          SESSION_PENDING_PERMISSION_EVENT,
          {
            detail: {
              permission: pendingPermission,
              sessionId: pendingSessionId,
            },
          },
        ),
      );
    }
  });
}

export function subscribeSessionPendingPermission(
  onChange: (sessionId: string, permission: SessionPendingPermissionState | null) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleChange = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        permission?: SessionPendingPermissionState | null;
        sessionId?: string;
      }>
    ).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    if (sessionId.trim().length === 0) {
      return;
    }

    onChange(sessionId, detail?.permission ?? null);
  };

  window.addEventListener(SESSION_PENDING_PERMISSION_EVENT, handleChange);
  return () => window.removeEventListener(SESSION_PENDING_PERMISSION_EVENT, handleChange);
}

export function publishSessionPendingQuestion(
  sessionId: string,
  question: PendingQuestionRequest | null,
): void {
  if (typeof window === 'undefined' || sessionId.trim().length === 0) {
    return;
  }

  pendingQuestionStateBySession.set(sessionId, question);
  const nextPendingQuestionBySession = new Map(pendingInteractionSnapshot.pendingQuestionBySession);
  if (question && question.status === 'pending') {
    nextPendingQuestionBySession.set(sessionId, question);
  } else {
    nextPendingQuestionBySession.delete(sessionId);
  }
  publishPendingInteractionSnapshot({
    pendingPermissionBySession: pendingInteractionSnapshot.pendingPermissionBySession,
    pendingQuestionBySession: nextPendingQuestionBySession,
  });
  if (pendingQuestionDispatchScheduled) {
    return;
  }

  pendingQuestionDispatchScheduled = true;
  queueMicrotask(() => {
    pendingQuestionDispatchScheduled = false;
    const pendingEntries = Array.from(pendingQuestionStateBySession.entries());
    pendingQuestionStateBySession.clear();

    for (const [pendingSessionId, pendingQuestion] of pendingEntries) {
      window.dispatchEvent(
        new CustomEvent<{ question: PendingQuestionRequest | null; sessionId: string }>(
          SESSION_PENDING_QUESTION_EVENT,
          {
            detail: {
              question: pendingQuestion,
              sessionId: pendingSessionId,
            },
          },
        ),
      );
    }
  });
}

export function subscribeSessionPendingQuestion(
  onChange: (sessionId: string, question: PendingQuestionRequest | null) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleChange = (event: Event) => {
    const detail = (
      event as CustomEvent<{
        question?: PendingQuestionRequest | null;
        sessionId?: string;
      }>
    ).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    if (sessionId.trim().length === 0) {
      return;
    }

    onChange(sessionId, detail?.question ?? null);
  };

  window.addEventListener(SESSION_PENDING_QUESTION_EVENT, handleChange);
  return () => window.removeEventListener(SESSION_PENDING_QUESTION_EVENT, handleChange);
}

export function getSessionPendingInteractionSnapshot(): SessionPendingInteractionSnapshot {
  return pendingInteractionSnapshot;
}

export function subscribeSessionPendingInteractionSnapshot(listener: () => void): () => void {
  pendingInteractionSnapshotListeners.add(listener);
  return () => {
    pendingInteractionSnapshotListeners.delete(listener);
  };
}

export function publishSessionRunState(sessionId: string, state: SessionRunState): void {
  if (typeof window === 'undefined' || sessionId.trim().length === 0) {
    return;
  }

  runStateBySession.set(sessionId, state);
  if (runStateDispatchScheduled) {
    return;
  }

  runStateDispatchScheduled = true;
  queueMicrotask(() => {
    runStateDispatchScheduled = false;
    const runStateEntries = Array.from(runStateBySession.entries());
    runStateBySession.clear();

    for (const [pendingSessionId, pendingState] of runStateEntries) {
      window.dispatchEvent(
        new CustomEvent<{ sessionId: string; state: SessionRunState }>(SESSION_RUN_STATE_EVENT, {
          detail: {
            sessionId: pendingSessionId,
            state: pendingState,
          },
        }),
      );
    }
  });
}

export function subscribeSessionRunState(
  onChange: (sessionId: string, state: SessionRunState) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleChange = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string; state?: SessionRunState }>).detail;
    const sessionId = typeof detail?.sessionId === 'string' ? detail.sessionId : '';
    const state = detail?.state;
    if (
      sessionId.trim().length === 0 ||
      (state !== 'idle' && state !== 'running' && state !== 'paused')
    ) {
      return;
    }

    onChange(sessionId, state);
  };

  window.addEventListener(SESSION_RUN_STATE_EVENT, handleChange);
  return () => window.removeEventListener(SESSION_RUN_STATE_EVENT, handleChange);
}
