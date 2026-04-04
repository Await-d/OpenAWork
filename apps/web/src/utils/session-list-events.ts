const SESSION_LIST_REFRESH_EVENT = 'openAwork:sessions-refresh';
const CURRENT_SESSION_REFRESH_EVENT = 'openAwork:current-session-refresh';
const SESSION_PENDING_PERMISSION_EVENT = 'openAwork:session-pending-permission';
const SESSION_RUN_STATE_EVENT = 'openAwork:session-run-state';

let refreshScheduled = false;
let pendingPermissionDispatchScheduled = false;
let runStateDispatchScheduled = false;
const pendingPermissionStateBySession = new Map<string, SessionPendingPermissionState | null>();
const runStateBySession = new Map<string, SessionRunState>();

export type SessionRunState = 'idle' | 'running' | 'paused';

export interface SessionPendingPermissionState {
  requestId: string;
  toolName: string;
  scope: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  previewAction?: string;
  targetSessionId: string;
}

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

export function subscribeSessionListRefresh(onRefresh: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleRefresh = () => {
    onRefresh();
  };

  window.addEventListener(SESSION_LIST_REFRESH_EVENT, handleRefresh);
  return () => window.removeEventListener(SESSION_LIST_REFRESH_EVENT, handleRefresh);
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
