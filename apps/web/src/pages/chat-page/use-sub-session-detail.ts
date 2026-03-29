import { useCallback, useEffect, useRef, useState } from 'react';
import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type { PendingPermissionRequest, Session, SessionTask } from '@openAwork/web-client';
import { normalizeChatMessages, type ChatMessage } from './support.js';

export interface SubSessionDetailState {
  error: string | null;
  loading: boolean;
  messages: ChatMessage[];
  pendingPermissions: PendingPermissionRequest[];
  session: Session | null;
  tasks: SessionTask[];
}

export function useSubSessionDetail(
  childSessionId: string | null,
  gatewayUrl: string,
  token: string | null,
) {
  const [state, setState] = useState<SubSessionDetailState>({
    error: null,
    loading: false,
    messages: [],
    pendingPermissions: [],
    session: null,
    tasks: [],
  });
  const refreshNonceRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!childSessionId || !token) {
      setState({
        error: null,
        loading: false,
        messages: [],
        pendingPermissions: [],
        session: null,
        tasks: [],
      });
      return;
    }

    const requestId = refreshNonceRef.current + 1;
    refreshNonceRef.current = requestId;
    setState((previous) => ({ ...previous, error: null, loading: true }));

    try {
      const sessionsClient = createSessionsClient(gatewayUrl);
      const permissionsClient = createPermissionsClient(gatewayUrl);
      const [session, tasksResult, permissionsResult] = await Promise.all([
        sessionsClient.get(token, childSessionId),
        sessionsClient
          .getTasks(token, childSessionId)
          .then((tasks) => ({ ok: true as const, tasks }))
          .catch(() => ({ ok: false as const, tasks: [] as SessionTask[] })),
        permissionsClient
          .listPending(token, childSessionId)
          .then((perms) => ({ ok: true as const, perms }))
          .catch(() => ({ ok: false as const, perms: [] as PendingPermissionRequest[] })),
      ]);

      if (refreshNonceRef.current !== requestId) {
        return;
      }

      setState({
        error: null,
        loading: false,
        messages: normalizeChatMessages(session.messages),
        pendingPermissions: permissionsResult.perms,
        session,
        tasks: tasksResult.tasks,
      });
    } catch (error) {
      if (refreshNonceRef.current !== requestId) {
        return;
      }

      setState({
        error: error instanceof Error ? error.message : '加载子代理详情失败',
        loading: false,
        messages: [],
        pendingPermissions: [],
        session: null,
        tasks: [],
      });
    }
  }, [childSessionId, gatewayUrl, token]);

  useEffect(() => {
    if (!childSessionId || !token) {
      setState({
        error: null,
        loading: false,
        messages: [],
        pendingPermissions: [],
        session: null,
        tasks: [],
      });
      return;
    }

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, 2500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [childSessionId, refresh, token]);

  return {
    ...state,
    refresh,
  };
}
