import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';
import { readPersistedActiveStreamSessionId } from './useGatewayClient.js';
import {
  createAgentProfilesClient,
  createSessionsClient,
  withTokenRefresh,
  HttpError,
} from '@openAwork/web-client';
import type { TokenStore } from '@openAwork/web-client';
import { toast } from '../components/ToastNotification.js';
import { exportSession } from '../utils/session-transfer.js';
import {
  buildWorkspaceSessionCollections,
  filterSessionTreeGroupsByQuery,
} from '../utils/session-grouping.js';
import {
  subscribeSessionListRefresh,
  subscribeSessionRunState,
  type SessionRunState,
} from '../utils/session-list-events.js';
import {
  getSessionDeleteErrorMessage,
  isSessionAlreadyDeletedError,
} from '../utils/session-delete.js';
import {
  buildSavedChatSessionMetadata,
  loadSavedChatSessionDefaults,
} from '../utils/chat-session-defaults.js';
import { extractParentSessionId, hasTeamWorkspace } from '../utils/session-metadata.js';
import { logger } from '../utils/logger.js';

export interface Session {
  id: string;
  state_status?: 'idle' | 'running' | 'paused';
  title: string | null;
  updated_at: string;
  metadata_json?: string;
}

function resolveDeletedSessionIds(
  result: { deletedSessionIds?: string[] } | void,
  fallbackSessionId: string,
): string[] {
  if (Array.isArray(result?.deletedSessionIds) && result.deletedSessionIds.length > 0) {
    return result.deletedSessionIds;
  }

  return [fallbackSessionId];
}

const MISSING_PARENT_SESSION_CACHE_TTL_MS = 60_000;

export function useSessions() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const accessToken = useAuthStore((s) => s.accessToken);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const tokenStore: TokenStore = useMemo(
    () => ({
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      setTokens: (at: string, rt: string, exp: string) =>
        useAuthStore.getState().setAuth(at, useAuthStore.getState().email ?? '', rt, exp),
      clearAuth: () => useAuthStore.getState().clearAuth(),
    }),
    [],
  );

  const [sessions, setSessions] = useState<Session[]>([]);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [sessionSearch, setSessionSearch] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const fetchRequestIdRef = useRef(0);
  const deletingSessionIdsRef = useRef<Set<string>>(new Set());
  const parentSessionCacheRef = useRef<Map<string, Session>>(new Map());
  const parentSessionInFlightRef = useRef<Map<string, Promise<Session | null>>>(new Map());
  const missingParentSessionExpiryRef = useRef<Map<string, number>>(new Map());
  const runStateOverridesRef = useRef<Map<string, SessionRunState>>(new Map());
  const parentSessionCacheScopeRef = useRef('');

  const parentSessionCacheScope = `${accessToken ?? ''}:${gatewayUrl}`;
  if (parentSessionCacheScopeRef.current !== parentSessionCacheScope) {
    parentSessionCacheRef.current.clear();
    parentSessionInFlightRef.current.clear();
    missingParentSessionExpiryRef.current.clear();
    runStateOverridesRef.current.clear();
    parentSessionCacheScopeRef.current = parentSessionCacheScope;
  }

  const fetchSessions = useCallback(async () => {
    if (!accessToken) return;
    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;
    try {
      const data = await withTokenRefresh(gatewayUrl, tokenStore, async (token) => {
        const activeStreamSessionId = readPersistedActiveStreamSessionId();
        const listedSessions = (await createSessionsClient(gatewayUrl).list(
          token,
        )) as unknown as Session[];
        const hydratedSessions = await hydrateMissingParentSessions(
          listedSessions,
          gatewayUrl,
          tokenStore,
          parentSessionCacheRef.current,
          parentSessionInFlightRef.current,
          missingParentSessionExpiryRef.current,
        );

        for (const session of hydratedSessions) {
          const overrideState = runStateOverridesRef.current.get(session.id);
          if (!overrideState) {
            continue;
          }

          if (session.state_status === overrideState) {
            runStateOverridesRef.current.delete(session.id);
            continue;
          }

          if (
            session.state_status === 'idle' &&
            overrideState !== 'idle' &&
            session.id !== activeStreamSessionId
          ) {
            runStateOverridesRef.current.delete(session.id);
          }
        }

        const nonTeamSessions = hydratedSessions.filter(
          (session) => !hasTeamWorkspace(session.metadata_json),
        );
        return applySessionRunStateOverrides(nonTeamSessions, runStateOverridesRef.current);
      });
      if (fetchRequestIdRef.current !== requestId) {
        return;
      }
      setSessions(data as unknown as Session[]);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        clearAuth();
        void navigate('/');
      }
    }
  }, [accessToken, gatewayUrl, tokenStore, clearAuth, navigate]);

  const newSession = useCallback(
    async (workspacePath?: string | null, parentSessionId?: string | null) => {
      if (!accessToken) return;
      try {
        let metadata: Record<string, unknown> = {};
        try {
          const { defaults } = await loadSavedChatSessionDefaults(gatewayUrl, accessToken);
          metadata = buildSavedChatSessionMetadata(defaults, {
            parentSessionId,
            workingDirectory: workspacePath,
          });
          if (workspacePath) {
            const profile = await createAgentProfilesClient(gatewayUrl).getCurrent(
              accessToken,
              workspacePath,
            );
            if (profile) {
              metadata = {
                ...metadata,
                ...(profile.agentId ? { agentId: profile.agentId } : {}),
                ...(profile.providerId ? { providerId: profile.providerId } : {}),
                ...(profile.modelId ? { modelId: profile.modelId } : {}),
              };
            }
          }
        } catch {
          if (workspacePath) {
            metadata['workingDirectory'] = workspacePath;
          }
          if (parentSessionId) {
            metadata['parentSessionId'] = parentSessionId;
          }
        }

        if (workspacePath) {
          addSavedWorkspacePath(workspacePath);
        }
        const session = await createSessionsClient(gatewayUrl).create(accessToken, { metadata });
        void fetchSessions();
        void navigate(`/chat/${session.id}`);
      } catch (err) {
        logger.error('Failed to create session:', err);
      }
    },
    [accessToken, addSavedWorkspacePath, gatewayUrl, fetchSessions, navigate],
  );

  const startRename = useCallback((session: Session) => {
    setRenamingSessionId(session.id);
    setRenameValue(session.title ?? '');
  }, []);

  const commitRename = useCallback(
    async (sessionIdToRename: string) => {
      if (!accessToken) return;
      const nextTitle = renameValue.trim();
      if (!nextTitle) {
        setRenamingSessionId(null);
        return;
      }
      try {
        await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
          createSessionsClient(gatewayUrl).rename(token, sessionIdToRename, nextTitle),
        );
        const cachedParentSession = parentSessionCacheRef.current.get(sessionIdToRename);
        if (cachedParentSession) {
          parentSessionCacheRef.current.set(sessionIdToRename, {
            ...cachedParentSession,
            title: nextTitle,
          });
        }
        setSessions((prev) =>
          prev.map((s) => (s.id === sessionIdToRename ? { ...s, title: nextTitle } : s)),
        );
      } catch (err) {
        logger.error('Failed to rename session:', err);
      } finally {
        setRenamingSessionId(null);
        setRenameValue('');
      }
    },
    [accessToken, gatewayUrl, tokenStore, renameValue],
  );

  const cancelRename = useCallback(() => {
    setRenamingSessionId(null);
    setRenameValue('');
  }, []);

  const quickDeleteSession = useCallback(
    async (sessionIdToDelete: string, options?: { suppressToast?: boolean }) => {
      if (!accessToken) return false;
      if (deletingSessionIdsRef.current.has(sessionIdToDelete)) {
        return false;
      }

      deletingSessionIdsRef.current.add(sessionIdToDelete);
      setDeletingSessionIds((previous) => {
        const next = new Set(previous);
        next.add(sessionIdToDelete);
        return next;
      });

      try {
        const result = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
          createSessionsClient(gatewayUrl).delete(token, sessionIdToDelete),
        );
        const deletedSessionIds = new Set(resolveDeletedSessionIds(result, sessionIdToDelete));
        for (const deletedSessionId of deletedSessionIds) {
          parentSessionCacheRef.current.delete(deletedSessionId);
          parentSessionInFlightRef.current.delete(deletedSessionId);
          missingParentSessionExpiryRef.current.set(
            deletedSessionId,
            Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
          );
        }
        setSessions((prev) => prev.filter((s) => !deletedSessionIds.has(s.id)));
        if (sessionId && deletedSessionIds.has(sessionId)) {
          void navigate('/chat');
        }
        return true;
      } catch (err) {
        if (isSessionAlreadyDeletedError(err)) {
          parentSessionCacheRef.current.delete(sessionIdToDelete);
          parentSessionInFlightRef.current.delete(sessionIdToDelete);
          missingParentSessionExpiryRef.current.set(
            sessionIdToDelete,
            Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
          );
          setSessions((prev) => prev.filter((s) => s.id !== sessionIdToDelete));
          if (sessionId === sessionIdToDelete) void navigate('/chat');
          void fetchSessions();
          return true;
        }

        logger.error('Failed to delete session:', err);
        if (!options?.suppressToast) {
          toast(getSessionDeleteErrorMessage(err), 'error', 4200);
        }
        return false;
      } finally {
        deletingSessionIdsRef.current.delete(sessionIdToDelete);
        setDeletingSessionIds((previous) => {
          if (!previous.has(sessionIdToDelete)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(sessionIdToDelete);
          return next;
        });
      }
    },
    [accessToken, gatewayUrl, tokenStore, sessionId, navigate, fetchSessions],
  );

  const isDeletingSession = useCallback(
    (sessionIdToCheck: string) => deletingSessionIds.has(sessionIdToCheck),
    [deletingSessionIds],
  );

  const quickExportSession = useCallback(
    async (sessionIdToExport: string) => {
      if (!accessToken) return;
      try {
        const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
          createSessionsClient(gatewayUrl).get(token, sessionIdToExport),
        );
        exportSession(sessionIdToExport, session.messages ?? []);
      } catch (err) {
        logger.error('Failed to export session:', err);
      }
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  const exportSessionAsMarkdown = useCallback(
    async (sId: string) => {
      if (!accessToken) return;
      try {
        const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
          createSessionsClient(gatewayUrl).get(token, sId),
        );
        exportSession(sId, session.messages ?? []);
      } catch (err) {
        logger.error('Failed to export markdown:', err);
      }
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  const exportSessionAsJson = useCallback(
    async (sId: string) => {
      if (!accessToken) return;
      try {
        const session = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
          createSessionsClient(gatewayUrl).get(token, sId),
        );
        const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${
          (session.title ?? 'session')
            .replace(/[^a-zA-Z0-9\-_ ]/g, '')
            .trim()
            .slice(0, 50) || 'session'
        }.json`;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        logger.error('Failed to export json:', err);
      }
    },
    [accessToken, gatewayUrl, tokenStore],
  );

  const toggleGroupCollapsed = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    return subscribeSessionListRefresh(() => {
      void fetchSessions();
    });
  }, [fetchSessions]);

  useEffect(() => {
    return subscribeSessionRunState((sessionId, state) => {
      runStateOverridesRef.current.set(sessionId, state);

      const cachedParentSession = parentSessionCacheRef.current.get(sessionId);
      if (cachedParentSession) {
        parentSessionCacheRef.current.set(sessionId, {
          ...cachedParentSession,
          state_status: state,
        });
      }

      setSessions((previous) =>
        applySessionRunStateOverrides(previous, runStateOverridesRef.current),
      );
    });
  }, []);

  const deferredSessionSearch = useDeferredValue(sessionSearch);
  const normalizedSessionSearch = deferredSessionSearch.trim().toLowerCase();
  const workspaceCollections = useMemo(
    () => buildWorkspaceSessionCollections(sessions, savedWorkspacePaths),
    [savedWorkspacePaths, sessions],
  );
  const groupedSessionTrees = useMemo(
    () => filterSessionTreeGroupsByQuery(workspaceCollections.treeGroups, normalizedSessionSearch),
    [normalizedSessionSearch, workspaceCollections.treeGroups],
  );

  return {
    sessions,
    filteredSessions: sessions,
    groupedSessions: workspaceCollections.groups,
    groupedSessionTrees,
    sessionCountByWorkspace: workspaceCollections.sessionCountByWorkspace,
    workspaceSessionIdsByGroupKey: workspaceCollections.sessionIdsByGroupKey,
    renamingSessionId,
    renameValue,
    setRenameValue,
    hoveredSessionId,
    setHoveredSessionId,
    isDeletingSession,
    collapsedGroups,
    toggleGroupCollapsed,
    sessionSearch,
    setSessionSearch,
    renameInputRef,
    fetchSessions,
    newSession,
    startRename,
    commitRename,
    cancelRename,
    quickDeleteSession,
    quickExportSession,
    exportSessionAsMarkdown,
    exportSessionAsJson,
  };
}

async function hydrateMissingParentSessions(
  sessions: Session[],
  gatewayUrl: string,
  tokenStore: TokenStore,
  parentSessionCache: Map<string, Session>,
  parentSessionInFlight: Map<string, Promise<Session | null>>,
  missingParentSessionExpiry: Map<string, number>,
): Promise<Session[]> {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const pendingParentIds: string[] = [];
  const queuedParentIds = new Set<string>();

  const enqueueParentId = (parentSessionId: string | null) => {
    if (
      !parentSessionId ||
      sessionById.has(parentSessionId) ||
      queuedParentIds.has(parentSessionId)
    ) {
      return;
    }

    queuedParentIds.add(parentSessionId);
    pendingParentIds.push(parentSessionId);
  };

  for (const session of sessions) {
    enqueueParentId(extractParentSessionId(session.metadata_json));
  }

  while (pendingParentIds.length > 0) {
    const currentParentBatch = pendingParentIds.splice(0);
    const fetchedParents = await Promise.all(
      currentParentBatch.map(async (parentSessionId) => {
        const missingParentExpiry = missingParentSessionExpiry.get(parentSessionId);
        if (missingParentExpiry && missingParentExpiry > Date.now()) {
          return null;
        }
        if (missingParentExpiry) {
          missingParentSessionExpiry.delete(parentSessionId);
        }

        const cachedParent = parentSessionCache.get(parentSessionId);
        if (cachedParent) {
          return cachedParent;
        }

        const pendingRequest = parentSessionInFlight.get(parentSessionId);
        if (pendingRequest) {
          return pendingRequest;
        }

        const fetchParentRequest = (async () => {
          try {
            const parentSession = await withTokenRefresh(gatewayUrl, tokenStore, (token) =>
              createSessionsClient(gatewayUrl).get(token, parentSessionId),
            );
            const blockedParentExpiry = missingParentSessionExpiry.get(parentSessionId);
            if (blockedParentExpiry && blockedParentExpiry > Date.now()) {
              return null;
            }
            const normalizedParentSession = normalizeSessionSummary(parentSession, parentSessionId);
            parentSessionCache.set(normalizedParentSession.id, normalizedParentSession);
            missingParentSessionExpiry.delete(parentSessionId);
            return normalizedParentSession;
          } catch (error) {
            if (error instanceof HttpError && error.status === 401) {
              throw error;
            }

            if (error instanceof HttpError && error.status === 404) {
              missingParentSessionExpiry.set(
                parentSessionId,
                Date.now() + MISSING_PARENT_SESSION_CACHE_TTL_MS,
              );
              return null;
            }

            logger.error('Failed to hydrate parent session:', parentSessionId, error);
            return null;
          } finally {
            parentSessionInFlight.delete(parentSessionId);
          }
        })();
        parentSessionInFlight.set(parentSessionId, fetchParentRequest);
        return fetchParentRequest;
      }),
    );

    for (const parentSession of fetchedParents) {
      if (!parentSession) {
        continue;
      }

      sessionById.set(parentSession.id, parentSession);
      enqueueParentId(extractParentSessionId(parentSession.metadata_json));
    }
  }

  return Array.from(sessionById.values());
}

function normalizeSessionSummary(
  session: Partial<Session> & {
    id: string;
    metadata_json?: string;
    title?: string | null;
    updatedAt?: number;
  },
  fallbackId: string,
): Session {
  const updatedAt =
    typeof session.updated_at === 'string'
      ? session.updated_at
      : typeof session.updatedAt === 'number'
        ? new Date(session.updatedAt).toISOString()
        : new Date(0).toISOString();

  return {
    id: session.id || fallbackId,
    state_status: session.state_status,
    title: session.title ?? null,
    metadata_json: session.metadata_json,
    updated_at: updatedAt,
  };
}

function applySessionRunStateOverrides(
  sessions: Session[],
  runStateOverrides: Map<string, SessionRunState>,
): Session[] {
  let hasChanges = false;
  const nextSessions = sessions.map((session) => {
    const overrideState = runStateOverrides.get(session.id);
    if (!overrideState || session.state_status === overrideState) {
      return session;
    }

    hasChanges = true;
    return {
      ...session,
      state_status: overrideState,
    };
  });

  return hasChanges ? nextSessions : sessions;
}
