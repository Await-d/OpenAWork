import { useDeferredValue, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import {
  createSessionsClient,
  createWorkspaceClient,
  withTokenRefresh,
} from '@openAwork/web-client';
import type { TokenStore } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { exportSession, importSession } from '../../utils/session/session-transfer.js';
import { logger } from '../../utils/log/logger.js';
import { toast } from '../../components/common/feedback/ToastNotification.js';
import {
  buildWorkspaceSessionCollections,
  getWorkspaceGroupKey,
  listWorkspacePathsFromSessions,
  UNBOUND_WORKSPACE_GROUP_KEY,
} from '../../utils/session/session-grouping.js';
import { subscribeSessionListRefresh } from '../../utils/session/session-list-events.js';
import {
  getSessionDeleteErrorMessage,
  isSessionAlreadyDeletedError,
} from '../../utils/session/session-delete.js';
import {
  buildSavedChatSessionMetadata,
  loadSavedChatSessionDefaults,
} from '../../utils/chat/chat-session-defaults.js';
import WorkspacePickerModal from '../../components/common/modal/WorkspacePickerModal.js';
import { buildWorkspacePickerDataSource } from '../../components/common/modal/workspace-picker-data-source.js';
import WorkspaceGroupMenu from '../../components/layout/workspace/WorkspaceGroupMenu.js';
import { WorkspaceDeleteConfirmDialog } from '../../components/layout/workspace/WorkspaceDeleteConfirmDialog.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { DetailPanel } from './views/detail-panel.js';
import { WorkspaceGroupSection } from './views/workspace-group-section.js';
import { SessionsListResizeHandle } from './views/sessions-list-resize-handle.js';
import { useTeamSessionIds } from './state/use-team-session-ids.js';
import type { SessionRow } from './state/session-page-types.js';

function resolveDeletedSessionIds(
  result: { deletedSessionIds?: string[] } | void,
  fallbackSessionId: string,
): string[] {
  if (Array.isArray(result?.deletedSessionIds) && result.deletedSessionIds.length > 0) {
    return result.deletedSessionIds;
  }

  return [fallbackSessionId];
}

// 关联样式：`.omo-skel` / `.omo-session-running-dot` 与对应 keyframes 已统一
// 收纳到 `src/styles/loaders.css`，由 `main.tsx` 一次性 import。

function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--bg-overlay)',
        border: '1px solid var(--border-default)',
        borderRadius: 10,
        padding: '0.75rem 0.875rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div
          className="omo-skel"
          style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0 }}
        />
        <div className="omo-skel" style={{ height: 12, width: '55%' }} />
        <div
          className="omo-skel"
          style={{ height: 18, width: 44, marginLeft: 'auto', borderRadius: 10 }}
        />
      </div>
      <div className="omo-skel" style={{ height: 10, width: '30%' }} />
    </div>
  );
}

export default function SessionsPage() {
  const navigate = useNavigate();
  const preloadChatRoute = useCallback((sessionId?: string | null) => {
    const path = sessionId ? `/chat/${sessionId}` : '/chat';
    void preloadRouteModuleByPath(path);
  }, []);
  const token = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const workspacePickerDataSource = useMemo(
    () =>
      buildWorkspacePickerDataSource({
        client: createWorkspaceClient(gatewayUrl),
        token,
      }),
    [gatewayUrl, token],
  );
  const tokenStore: TokenStore = useMemo(
    () => ({
      getAccessToken: () => useAuthStore.getState().accessToken,
      getRefreshToken: () => useAuthStore.getState().refreshToken,
      setTokens: (accessToken: string, refreshToken: string, expiresIn: string) =>
        useAuthStore
          .getState()
          .setAuth(accessToken, useAuthStore.getState().email ?? '', refreshToken, expiresIn),
      clearAuth: () => useAuthStore.getState().clearAuth(),
    }),
    [],
  );
  const savedWorkspacePaths = useUIStateStore((s) => s.savedWorkspacePaths);
  const addSavedWorkspacePath = useUIStateStore((s) => s.addSavedWorkspacePath);
  const mergeSavedWorkspacePaths = useUIStateStore((s) => s.mergeSavedWorkspacePaths);
  const removeSavedWorkspacePath = useUIStateStore((s) => s.removeSavedWorkspacePath);
  const persistedListPaneWidth = useUIStateStore((s) => s.sessionsListPaneWidth);
  const setSessionsListPaneWidth = useUIStateStore((s) => s.setSessionsListPaneWidth);
  const collapsedWorkspaceGroupKeys = useUIStateStore((s) => s.sessionsCollapsedWorkspaceGroups);
  const toggleSessionsCollapsedWorkspaceGroup = useUIStateStore(
    (s) => s.toggleSessionsCollapsedWorkspaceGroup,
  );
  const collapsedWorkspaceGroupKeySet = useMemo(
    () => new Set(collapsedWorkspaceGroupKeys),
    [collapsedWorkspaceGroupKeys],
  );
  const [listPaneWidth, setListPaneWidth] = useState(persistedListPaneWidth);
  useEffect(() => {
    setListPaneWidth(persistedListPaneWidth);
  }, [persistedListPaneWidth]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set());
  const [showWorkspacePicker, setShowWorkspacePicker] = useState(false);
  const [pendingWorkspacePath, setPendingWorkspacePath] = useState<string | null>(null);
  const [workspaceContextMenu, setWorkspaceContextMenu] = useState<{
    groupKey: string;
    sessionCount: number;
    workspaceLabel: string;
    workspacePath: string | null;
    x: number;
    y: number;
  } | null>(null);
  const [pendingWorkspaceDeletion, setPendingWorkspaceDeletion] = useState<{
    groupKey: string;
    sessionIds: string[];
    workspaceLabel: string;
    workspacePath: string | null;
  } | null>(null);
  const [deletingWorkspaceGroupKeys, setDeletingWorkspaceGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const loadSessionsRequestIdRef = useRef(0);
  const lastPointerPositionRef = useRef<{ x: number; y: number } | null>(null);
  const deletingSessionIdsRef = useRef<Set<string>>(new Set());
  const deletingWorkspaceGroupKeysRef = useRef<Set<string>>(new Set());
  const workspaceDeletionSubmitLockRef = useRef(false);

  const restoreHoveredSessionFromPointer = useCallback(() => {
    const pointer = lastPointerPositionRef.current;
    if (!pointer) {
      setHoveredId(null);
      return;
    }

    if (typeof document.elementFromPoint !== 'function') {
      setHoveredId(null);
      return;
    }

    const hoveredElement = document.elementFromPoint(pointer.x, pointer.y);
    if (!(hoveredElement instanceof Element)) {
      setHoveredId(null);
      return;
    }

    const hoveredSessionItem = hoveredElement.closest<HTMLElement>('[data-session-id]');
    setHoveredId(hoveredSessionItem?.dataset.sessionId ?? null);
  }, []);

  const loadSessions = useCallback(
    async (keepCurrentLoadingState = false) => {
      if (!token) {
        setLoading(false);
        return;
      }

      const requestId = loadSessionsRequestIdRef.current + 1;
      loadSessionsRequestIdRef.current = requestId;

      if (!keepCurrentLoadingState) {
        setLoading(true);
      }

      try {
        const list = await createSessionsClient(gatewayUrl).list(token);
        if (loadSessionsRequestIdRef.current !== requestId) {
          return;
        }
        const nextSessions = (list as SessionRow[]).filter(
          // 排除 team 层级角色派生的子会话（pm1/pm2/executor/reviewer 等），
          // 只保留用户创建的根会话（包括 team 根会话和个人会话）。
          (session) => !session.team_parent_session_id,
        );
        mergeSavedWorkspacePaths(listWorkspacePathsFromSessions(nextSessions));
        setSessions(nextSessions);
      } catch {
        return;
      } finally {
        if (!keepCurrentLoadingState && loadSessionsRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [gatewayUrl, token, mergeSavedWorkspacePaths],
  );

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    return subscribeSessionListRefresh(() => {
      void loadSessions(true);
    });
  }, [loadSessions]);

  useEffect(() => {
    if (!hoveredId) {
      return;
    }

    if (sessions.some((session) => session.id === hoveredId)) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        restoreHoveredSessionFromPointer();
      }
    });

    return () => {
      cancelled = true;
    };
  }, [hoveredId, restoreHoveredSessionFromPointer, sessions]);

  async function createSession(inheritWorkspacePath?: string | null) {
    if (!token) return;
    let metadata: Record<string, unknown> = {};
    try {
      const { defaults } = await loadSavedChatSessionDefaults(gatewayUrl, token);
      metadata = buildSavedChatSessionMetadata(defaults, {
        workingDirectory: inheritWorkspacePath,
      });
    } catch {
      if (inheritWorkspacePath) {
        metadata['workingDirectory'] = inheritWorkspacePath;
      }
    }

    if (inheritWorkspacePath) {
      addSavedWorkspacePath(inheritWorkspacePath);
    }
    const session = await createSessionsClient(gatewayUrl).create(token, { metadata });
    logger.info('session created', session.id);
    if (session.id) {
      preloadChatRoute(session.id);
      void navigate(`/chat/${session.id}`);
    }
  }

  const deleteSession = useCallback(
    async (id: string, options?: { suppressToast?: boolean }): Promise<boolean> => {
      if (!token) return false;
      if (deletingSessionIdsRef.current.has(id)) {
        return false;
      }

      deletingSessionIdsRef.current.add(id);
      setDeletingSessionIds((previous) => {
        const next = new Set(previous);
        next.add(id);
        return next;
      });

      try {
        const result = await withTokenRefresh(gatewayUrl, tokenStore, (activeToken) =>
          createSessionsClient(gatewayUrl).delete(activeToken, id),
        );
        const deletedSessionIds = new Set(resolveDeletedSessionIds(result, id));
        logger.info('session deleted', id);
        setSessions((prev) => prev.filter((s) => !deletedSessionIds.has(s.id)));
        if (selectedId && deletedSessionIds.has(selectedId)) {
          setSelectedId(null);
        }
        if (!options?.suppressToast) {
          toast('会话已删除', 'success');
        }
        return true;
      } catch (err) {
        if (isSessionAlreadyDeletedError(err)) {
          setSessions((prev) => prev.filter((s) => s.id !== id));
          if (selectedId === id) setSelectedId(null);
          void loadSessions(true);
          if (!options?.suppressToast) {
            toast('会话已删除', 'success');
          }
          return true;
        }

        logger.error('session delete failed', err);
        if (!options?.suppressToast) {
          toast(getSessionDeleteErrorMessage(err), 'error', 4200);
        }
        return false;
      } finally {
        deletingSessionIdsRef.current.delete(id);
        setDeletingSessionIds((previous) => {
          if (!previous.has(id)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(id);
          return next;
        });
      }
    },
    [gatewayUrl, loadSessions, selectedId, token, tokenStore],
  );

  const handleDeleteWorkspaceGroup = useCallback(
    async (
      workspacePath: string | null,
      workspaceLabel: string,
      groupKey: string,
      sessionIds: string[],
    ) => {
      if (!workspacePath && sessionIds.length === 0) {
        return;
      }

      if (deletingWorkspaceGroupKeysRef.current.has(groupKey)) {
        return;
      }

      deletingWorkspaceGroupKeysRef.current.add(groupKey);
      setDeletingWorkspaceGroupKeys((previous) => {
        const next = new Set(previous);
        next.add(groupKey);
        return next;
      });

      const sessionCount = sessionIds.length;
      let successCount = 0;
      let failedCount = 0;

      try {
        for (const sessionId of sessionIds) {
          const deleted = await deleteSession(sessionId, { suppressToast: true });
          if (deleted) {
            successCount += 1;
          } else {
            failedCount += 1;
          }
        }

        if (failedCount === 0) {
          if (workspacePath) {
            removeSavedWorkspacePath(workspacePath);
          }
          toast(
            sessionCount > 0
              ? workspacePath === null
                ? `已删除未绑定工作区中的 ${successCount} 个会话`
                : `已删除工作区「${workspaceLabel}」及 ${successCount} 个会话`
              : `已移除工作区「${workspaceLabel}」`,
            'success',
          );
          return;
        }

        toast(
          workspacePath === null
            ? `未绑定工作区删除未完成：已删除 ${successCount} 个会话，${failedCount} 个失败。`
            : `工作区「${workspaceLabel}」删除未完成：已删除 ${successCount} 个会话，${failedCount} 个失败，工作区未移除。`,
          'warning',
          4200,
        );
      } finally {
        deletingWorkspaceGroupKeysRef.current.delete(groupKey);
        setDeletingWorkspaceGroupKeys((previous) => {
          if (!previous.has(groupKey)) {
            return previous;
          }

          const next = new Set(previous);
          next.delete(groupKey);
          return next;
        });
      }
    },
    [deleteSession, removeSavedWorkspacePath],
  );

  const startRename = useCallback((session: SessionRow) => {
    setRenamingId(session.id);
    setRenameValue(session.title ?? '');
  }, []);

  const commitRename = useCallback(
    async (id: string) => {
      if (!token) return;
      const trimmed = renameValue.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      try {
        await createSessionsClient(gatewayUrl).rename(token, id, trimmed);
        setSessions((prev) =>
          prev.map((session) => (session.id === id ? { ...session, title: trimmed } : session)),
        );
        toast('已重命名', 'success');
      } catch {
        toast('重命名失败', 'error');
      } finally {
        setRenamingId(null);
      }
    },
    [gatewayUrl, renameValue, token],
  );

  const handleExport = useCallback(
    async (session: SessionRow) => {
      if (!token) return;
      try {
        const full = await createSessionsClient(gatewayUrl).get(token, session.id);
        exportSession(session.id, (full as { messages?: unknown[] }).messages ?? []);
      } catch {
        exportSession(session.id, []);
      }
    },
    [gatewayUrl, token],
  );

  function handleCopyId(id: string) {
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1500);
    });
  }

  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = deferredSearchQuery.toLowerCase();

  const teamRuntime = useTeamSessionIds();
  const teamSessionIds = teamRuntime.teamSessionIds;
  const scopeFilter = useUIStateStore((s) => s.sessionsScopeFilter);
  const setScopeFilter = useUIStateStore((s) => s.setSessionsScopeFilter);
  const collapsedScopes = useUIStateStore((s) => s.sessionsCollapsedScopes);
  const toggleCollapsedScope = useUIStateStore((s) => s.toggleSessionsCollapsedScope);
  const collapsedScopeSet = useMemo(() => new Set(collapsedScopes), [collapsedScopes]);

  const partitionedSessions = useMemo(() => {
    const personal: SessionRow[] = [];
    const team: SessionRow[] = [];
    for (const session of sessions) {
      if (teamSessionIds.has(session.id)) {
        team.push(session);
      } else {
        personal.push(session);
      }
    }
    return { personal, team };
  }, [sessions, teamSessionIds]);

  const personalCollections = useMemo(
    () => buildWorkspaceSessionCollections(partitionedSessions.personal, savedWorkspacePaths),
    [partitionedSessions.personal, savedWorkspacePaths],
  );
  const teamCollections = useMemo(
    () => buildWorkspaceSessionCollections(partitionedSessions.team, savedWorkspacePaths),
    [partitionedSessions.team, savedWorkspacePaths],
  );

  const filtered = useMemo(
    () =>
      sessions.filter((session) =>
        (session.title ?? session.id).toLowerCase().includes(normalizedSearchQuery),
      ),
    [normalizedSearchQuery, sessions],
  );
  const filteredSessionIds = useMemo(
    () => new Set(filtered.map((session) => session.id)),
    [filtered],
  );

  const buildScopeView = useCallback(
    (kind: 'personal' | 'team', collections: typeof personalCollections) => ({
      kind,
      groups: collections.groups.map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => filteredSessionIds.has(session.id)),
      })),
      sessionCountByWorkspace: collections.sessionCountByWorkspace,
      sessionIdsByGroupKey: collections.sessionIdsByGroupKey,
      totalSessionCount: collections.groups.reduce((sum, group) => sum + group.sessions.length, 0),
    }),
    [filteredSessionIds],
  );

  const personalScopeView = useMemo(
    () => buildScopeView('personal', personalCollections),
    [buildScopeView, personalCollections],
  );
  const teamScopeView = useMemo(
    () => buildScopeView('team', teamCollections),
    [buildScopeView, teamCollections],
  );

  const visibleScopeViews = useMemo(() => {
    if (scopeFilter === 'personal') return [personalScopeView];
    if (scopeFilter === 'team') return [teamScopeView];
    // `all`: show personal first, then team. Hide a scope entirely when it
    // has no sessions at all so we don't render an empty header for users
    // who only use one of the two flows.
    return [
      ...(personalScopeView.totalSessionCount > 0 ? [personalScopeView] : []),
      ...(teamScopeView.totalSessionCount > 0 ? [teamScopeView] : []),
    ];
  }, [personalScopeView, scopeFilter, teamScopeView]);

  const visibleFilteredCount = useMemo(
    () =>
      visibleScopeViews.reduce(
        (sum, view) =>
          sum + view.groups.reduce((groupSum, group) => groupSum + group.sessions.length, 0),
        0,
      ),
    [visibleScopeViews],
  );

  const totalCountInScope = useMemo(() => {
    if (scopeFilter === 'personal') return personalScopeView.totalSessionCount;
    if (scopeFilter === 'team') return teamScopeView.totalSessionCount;
    return sessions.length;
  }, [
    personalScopeView.totalSessionCount,
    scopeFilter,
    sessions.length,
    teamScopeView.totalSessionCount,
  ]);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? null,
    [selectedId, sessions],
  );

  const handleSessionHoverEnter = useCallback(
    (sessionId: string, position?: { x: number; y: number }) => {
      if (position) {
        lastPointerPositionRef.current = position;
      }
      setHoveredId(sessionId);
    },
    [],
  );

  const handleSessionHoverMove = useCallback(
    (_sessionId: string, position: { x: number; y: number }) => {
      lastPointerPositionRef.current = position;
    },
    [],
  );

  const handleSessionHoverLeave = useCallback((_sessionId: string) => {
    lastPointerPositionRef.current = null;
    setHoveredId(null);
  }, []);

  const handleSessionSelect = useCallback((sessionId: string) => {
    setSelectedId((previous) => (previous === sessionId ? null : sessionId));
  }, []);

  const handleSessionRenameCommit = useCallback(
    (sessionId: string) => {
      void commitRename(sessionId);
    },
    [commitRename],
  );

  const handleSessionStartRename = useCallback(
    (session: SessionRow) => {
      startRename(session);
    },
    [startRename],
  );

  const handleSessionExport = useCallback(
    (session: SessionRow) => {
      void handleExport(session);
    },
    [handleExport],
  );

  const handleSessionDelete = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId);
    },
    [deleteSession],
  );

  const handleSessionRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  const handleListPaneWidthChange = useCallback((width: number) => {
    setListPaneWidth(width);
  }, []);
  const handleListPaneWidthCommit = useCallback(
    (width: number) => {
      setListPaneWidth(width);
      setSessionsListPaneWidth(width);
    },
    [setSessionsListPaneWidth],
  );

  const handleRequestWorkspaceContextMenu = useCallback(
    (args: {
      groupKey: string;
      workspaceLabel: string;
      workspacePath: string | null;
      sessionCount: number;
      x: number;
      y: number;
    }) => {
      setWorkspaceContextMenu(args);
    },
    [],
  );

  const handleCreateInWorkspace = useCallback(
    (workspacePath: string | null) => {
      void createSession(workspacePath);
    },
    // createSession is stable enough within a render closure; including it
    // would force this callback to re-create whenever sessions change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, gatewayUrl, navigate],
  );

  // Team-scope groups intentionally don't expose the per-workspace "新建"
  // button, since team sessions need to be started from the team page where
  // the user picks a workflow / member roster. We pass a no-op so the
  // shared section component can keep its prop contract.
  const noopCreateInWorkspace = useCallback((_workspacePath: string | null) => {
    /* team sessions are created from the team page */
  }, []);

  const isFiltering = searchQuery.trim().length > 0;
  const hasNoSearchMatches =
    !loading && isFiltering && visibleFilteredCount === 0 && totalCountInScope > 0;
  const hasNoSessionsInScope = !loading && totalCountInScope === 0;

  return (
    <div className="page-root">
      <TopBar
        totalCount={totalCountInScope}
        visibleCount={visibleFilteredCount}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onImport={() => {
          importSession();
          setTimeout(() => {
            if (!token) return;
            createSessionsClient(gatewayUrl)
              .list(token)
              .then((list) =>
                setSessions(
                  (list as SessionRow[]).filter((session) => !session.team_parent_session_id),
                ),
              )
              .catch(() => null);
          }, 800);
        }}
        onNew={() => void createSession()}
        onNewWithWorkspace={() => {
          setPendingWorkspacePath(null);
          setShowWorkspacePicker(true);
        }}
      />
      <WorkspacePickerModal
        isOpen={showWorkspacePicker}
        onClose={() => setShowWorkspacePicker(false)}
        onSelect={async (path) => {
          setPendingWorkspacePath(path);
          setShowWorkspacePicker(false);
          await createSession(path);
        }}
        fetchRootPath={workspacePickerDataSource.fetchRootPath}
        fetchWorkspaceRoots={workspacePickerDataSource.fetchWorkspaceRoots}
        fetchTree={workspacePickerDataSource.fetchTree}
        createDirectory={workspacePickerDataSource.createDirectory}
        validatePath={workspacePickerDataSource.validatePath}
        initialPath={pendingWorkspacePath ?? undefined}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            position: 'relative',
            width: listPaneWidth,
            flexShrink: 0,
            borderRight: '1px solid var(--border-default)',
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-base)',
          }}
        >
          <ScopeFilterTabs
            scopeFilter={scopeFilter}
            onScopeChange={setScopeFilter}
            personalCount={personalScopeView.totalSessionCount}
            teamCount={teamScopeView.totalSessionCount}
            teamReady={teamRuntime.ready}
            teamFailed={teamRuntime.failed}
          />
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '0.5rem 0.625rem 0.875rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <SkeletonCard key={`skel-${i}`} />
                ))}
              </div>
            ) : hasNoSessionsInScope ? (
              <EmptyList
                scope={scopeFilter}
                onNew={() => void createSession()}
                onShowAll={scopeFilter === 'all' ? undefined : () => setScopeFilter('all')}
              />
            ) : hasNoSearchMatches ? (
              <NoSearchMatches searchQuery={searchQuery} onClearSearch={() => setSearchQuery('')} />
            ) : (
              visibleScopeViews.map((scopeView) => {
                const scopeCollapsed = collapsedScopeSet.has(scopeView.kind);
                const showScopeHeader = scopeFilter === 'all' && visibleScopeViews.length > 1;
                return (
                  <SessionScopeSection
                    key={scopeView.kind}
                    kind={scopeView.kind}
                    showHeader={showScopeHeader}
                    collapsed={showScopeHeader && scopeCollapsed}
                    onToggleCollapsed={() => toggleCollapsedScope(scopeView.kind)}
                    sessionCount={scopeView.totalSessionCount}
                  >
                    {scopeView.groups.map((group) => {
                      const groupKey = getWorkspaceGroupKey(group.workspacePath);
                      const actualSessionCount =
                        scopeView.sessionCountByWorkspace.get(groupKey) ?? 0;
                      return (
                        <WorkspaceGroupSection
                          key={`${scopeView.kind}::${group.workspacePath ?? '__unbound__'}`}
                          groupKey={groupKey}
                          workspaceLabel={group.workspaceLabel}
                          workspacePath={group.workspacePath}
                          sessions={group.sessions}
                          actualSessionCount={actualSessionCount}
                          collapsed={collapsedWorkspaceGroupKeySet.has(groupKey)}
                          selectedId={selectedId}
                          hoveredId={hoveredId}
                          renamingId={renamingId}
                          renameValue={renameValue}
                          deletingSessionIds={deletingSessionIds}
                          showCreateButton={scopeView.kind === 'personal'}
                          onToggleCollapsed={toggleSessionsCollapsedWorkspaceGroup}
                          onCreateInWorkspace={
                            scopeView.kind === 'personal'
                              ? handleCreateInWorkspace
                              : noopCreateInWorkspace
                          }
                          onRequestContextMenu={handleRequestWorkspaceContextMenu}
                          onSessionHoverEnter={handleSessionHoverEnter}
                          onSessionHoverMove={handleSessionHoverMove}
                          onSessionHoverLeave={handleSessionHoverLeave}
                          onSessionSelect={handleSessionSelect}
                          onSessionRenameChange={setRenameValue}
                          onSessionRenameCommit={handleSessionRenameCommit}
                          onSessionRenameCancel={handleSessionRenameCancel}
                          onSessionStartRename={handleSessionStartRename}
                          onSessionExport={handleSessionExport}
                          onSessionDelete={handleSessionDelete}
                        />
                      );
                    })}
                  </SessionScopeSection>
                );
              })
            )}
          </div>
          <SessionsListResizeHandle
            width={listPaneWidth}
            onWidthChange={handleListPaneWidthChange}
            onWidthCommit={handleListPaneWidthCommit}
          />
        </div>
        {selected ? (
          <DetailPanel
            selected={selected}
            copiedId={copiedId}
            onOpenChat={() => {
              preloadChatRoute(selected.id);
              void navigate(`/chat/${selected.id}`);
            }}
            onPreloadChat={() => preloadChatRoute(selected.id)}
            onExport={() => void handleExport(selected)}
            onCopyId={() => handleCopyId(selected.id)}
            gatewayUrl={gatewayUrl}
            token={token ?? ''}
            onRefreshSessions={() => loadSessions(true)}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
      {workspaceContextMenu &&
        createPortal(
          <WorkspaceGroupMenu
            workspacePath={workspaceContextMenu.workspacePath}
            workspaceLabel={workspaceContextMenu.workspaceLabel}
            sessionCount={workspaceContextMenu.sessionCount}
            x={workspaceContextMenu.x}
            y={workspaceContextMenu.y}
            isCollapsed={false}
            showCollapseAction={false}
            canDelete={
              workspaceContextMenu.workspacePath !== null || workspaceContextMenu.sessionCount > 0
            }
            onClose={() => setWorkspaceContextMenu(null)}
            onNewSession={() => void createSession(workspaceContextMenu.workspacePath)}
            onToggleCollapse={() => undefined}
            onDelete={() => {
              const groupKey = workspaceContextMenu.groupKey;
              setPendingWorkspaceDeletion({
                groupKey,
                // Bulk delete from `/sessions` only operates on personal
                // sessions; team-workspace sessions are managed from the
                // team page's own workspace tooling.
                sessionIds: personalScopeView.sessionIdsByGroupKey.get(groupKey) ?? [],
                workspaceLabel: workspaceContextMenu.workspaceLabel,
                workspacePath: workspaceContextMenu.workspacePath,
              });
            }}
          />,
          document.body,
        )}
      <WorkspaceDeleteConfirmDialog
        open={pendingWorkspaceDeletion !== null}
        workspaceLabel={pendingWorkspaceDeletion?.workspaceLabel ?? ''}
        sessionCount={pendingWorkspaceDeletion?.sessionIds.length ?? 0}
        isUnboundGroup={pendingWorkspaceDeletion?.groupKey === UNBOUND_WORKSPACE_GROUP_KEY}
        deleting={
          pendingWorkspaceDeletion
            ? deletingWorkspaceGroupKeys.has(pendingWorkspaceDeletion.groupKey)
            : false
        }
        onCancel={() => {
          if (
            workspaceDeletionSubmitLockRef.current ||
            (pendingWorkspaceDeletion &&
              deletingWorkspaceGroupKeys.has(pendingWorkspaceDeletion.groupKey))
          ) {
            return;
          }

          setPendingWorkspaceDeletion(null);
        }}
        onConfirm={() => {
          if (!pendingWorkspaceDeletion) {
            return;
          }

          if (workspaceDeletionSubmitLockRef.current) {
            return;
          }

          workspaceDeletionSubmitLockRef.current = true;
          void handleDeleteWorkspaceGroup(
            pendingWorkspaceDeletion.workspacePath,
            pendingWorkspaceDeletion.workspaceLabel,
            pendingWorkspaceDeletion.groupKey,
            pendingWorkspaceDeletion.sessionIds,
          ).finally(() => {
            workspaceDeletionSubmitLockRef.current = false;
            setPendingWorkspaceDeletion(null);
          });
        }}
      />
    </div>
  );
}

function TopBar({
  totalCount,
  visibleCount,
  searchQuery,
  onSearchChange,
  onImport,
  onNew,
  onNewWithWorkspace,
}: {
  totalCount: number;
  visibleCount: number;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onImport: () => void;
  onNew: () => void;
  onNewWithWorkspace: () => void;
}) {
  const isFiltering = searchQuery.trim().length > 0;
  const countLabel = isFiltering ? `${visibleCount} / ${totalCount}` : `${totalCount}`;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0.75rem 1.25rem',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--bg-base)',
        flexShrink: 0,
      }}
    >
      <h2
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--fg-strong)',
          margin: 0,
          flexShrink: 0,
        }}
      >
        会话
      </h2>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          background: isFiltering ? 'var(--accent-muted)' : 'var(--bg-overlay)',
          color: isFiltering ? 'var(--accent)' : 'var(--fg-muted)',
          border: isFiltering ? 'none' : '1px solid var(--border-subtle)',
          borderRadius: 99,
          padding: '2px 9px',
          flexShrink: 0,
          minWidth: 20,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
          transition: 'background 120ms ease, color 120ms ease',
        }}
        title={
          isFiltering ? `匹配 ${visibleCount} / 共 ${totalCount} 个会话` : `共 ${totalCount} 个会话`
        }
      >
        {countLabel}
      </span>
      <input
        type="text"
        placeholder="搜索会话…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="form-input"
        style={{
          flex: 1,
          height: 30,
          minWidth: 0,
        }}
      />
      <button type="button" onClick={onImport} className="btn-secondary" style={{ flexShrink: 0 }}>
        导入
      </button>
      <div style={{ display: 'flex', gap: 0, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onNew}
          style={{
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            borderRadius: '7px 0 0 7px',
            padding: '0 14px',
            height: 32,
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 100ms ease',
          }}
        >
          + 新建会话
        </button>
        <button
          type="button"
          onClick={onNewWithWorkspace}
          title="选择工作区后新建会话"
          style={{
            background: 'var(--accent)',
            color: 'var(--fg-on-accent)',
            border: 'none',
            borderLeft: '1px solid oklch(from var(--accent) calc(l - 0.1) c h)',
            borderRadius: '0 7px 7px 0',
            padding: '0 8px',
            height: 32,
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            transition: 'background 100ms ease',
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function EmptyList({
  onNew,
  scope = 'all',
  onShowAll,
}: {
  onNew: () => void;
  scope?: 'all' | 'personal' | 'team';
  onShowAll?: () => void;
}) {
  const isTeamScope = scope === 'team';
  const headline =
    scope === 'team' ? '还没有团队会话' : scope === 'personal' ? '还没有个人对话' : '还没有会话';
  const hint = isTeamScope
    ? '团队对话从「团队」页面发起,完成后会出现在这里。'
    : '创建一个新会话开始与 Agent 对话';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14,
        padding: '3.5rem 1.5rem',
        color: 'var(--fg-muted)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: 'var(--accent-subtle, rgba(92, 212, 192, 0.07))',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.6 }}
        >
          {isTeamScope ? (
            <>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </>
          ) : (
            <>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M8 10h8M8 14h5" />
            </>
          )}
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-default)' }}>
          {headline}
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.5 }}>{hint}</span>
      </div>
      {!isTeamScope && (
        <button
          type="button"
          onClick={onNew}
          className="btn-accent"
          style={{ height: 32, padding: '0 16px', fontSize: 12 }}
        >
          新建会话
        </button>
      )}
      {onShowAll && (
        <button
          type="button"
          onClick={onShowAll}
          className="btn-secondary"
          style={{ height: 28, padding: '0 12px', fontSize: 11 }}
        >
          查看全部会话
        </button>
      )}
    </div>
  );
}

function EmptyDetail() {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: 'var(--fg-muted)',
        background: 'var(--bg-overlay)',
        padding: 32,
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 18,
          background: 'var(--accent-subtle, rgba(92, 212, 192, 0.07))',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.6 }}
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          <path d="M8 9h8" />
          <path d="M8 13h5" />
        </svg>
      </div>
      <div style={{ textAlign: 'center', maxWidth: 240 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-default)', marginBottom: 6 }}>
          选择一个会话
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>
          在左侧点击会话以查看详情、管理快照或继续对话
        </div>
      </div>
    </div>
  );
}

function NoSearchMatches({
  searchQuery,
  onClearSearch,
}: {
  searchQuery: string;
  onClearSearch: () => void;
}) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '2.5rem 1rem',
        color: 'var(--fg-muted)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: 'var(--accent-subtle, rgba(92, 212, 192, 0.07))',
          border: '1px dashed var(--border-emphasis)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ opacity: 0.7 }}
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg-default)' }}>
          没有匹配的会话
        </span>
        <span
          style={{
            fontSize: 11,
            lineHeight: 1.5,
            wordBreak: 'break-word',
            maxWidth: 240,
          }}
        >
          搜索 “{searchQuery}” 未匹配到任何会话,可清除搜索后再试。
        </span>
      </div>
      <button
        type="button"
        onClick={onClearSearch}
        className="btn-secondary"
        style={{ height: 28, padding: '0 12px', fontSize: 11 }}
      >
        清除搜索
      </button>
    </div>
  );
}

const SCOPE_TAB_BAR_STYLE: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 8px',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'var(--bg-base)',
  flexShrink: 0,
};

const SCOPE_TAB_BUTTON_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 600,
  border: '1px solid transparent',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
};

const SCOPE_TAB_BUTTON_ACTIVE_STYLE: React.CSSProperties = {
  ...SCOPE_TAB_BUTTON_STYLE,
  background: 'var(--accent-muted)',
  color: 'var(--accent)',
};

function ScopeFilterTabs({
  scopeFilter,
  onScopeChange,
  personalCount,
  teamCount,
  teamReady,
  teamFailed,
}: {
  scopeFilter: 'all' | 'personal' | 'team';
  onScopeChange: (scope: 'all' | 'personal' | 'team') => void;
  personalCount: number;
  teamCount: number;
  teamReady: boolean;
  teamFailed: boolean;
}) {
  // Hide the team tab entirely when the team runtime fetch failed (user
  // doesn't have team access) and we observed zero team sessions. Loading
  // state still shows it so the layout doesn't shift after data arrives.
  const showTeamTab = !teamReady || teamFailed === false || teamCount > 0;

  return (
    <div role="tablist" aria-label="会话来源" style={SCOPE_TAB_BAR_STYLE}>
      <ScopeTabButton
        label="全部"
        active={scopeFilter === 'all'}
        count={personalCount + teamCount}
        onClick={() => onScopeChange('all')}
      />
      <ScopeTabButton
        label="个人"
        active={scopeFilter === 'personal'}
        count={personalCount}
        onClick={() => onScopeChange('personal')}
      />
      {showTeamTab && (
        <ScopeTabButton
          label="团队"
          active={scopeFilter === 'team'}
          count={teamCount}
          onClick={() => onScopeChange('team')}
          loading={!teamReady}
        />
      )}
    </div>
  );
}

function ScopeTabButton({
  label,
  active,
  count,
  onClick,
  loading = false,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={active ? SCOPE_TAB_BUTTON_ACTIVE_STYLE : SCOPE_TAB_BUTTON_STYLE}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        style={{
          fontSize: 10,
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: 99,
          background: active ? 'var(--accent)' : 'var(--bg-overlay)',
          color: active ? 'var(--fg-on-accent)' : 'var(--fg-muted)',
          minWidth: 18,
          textAlign: 'center',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {loading ? '…' : count}
      </span>
    </button>
  );
}

function SessionScopeSection({
  kind,
  showHeader,
  collapsed,
  onToggleCollapsed,
  sessionCount,
  children,
}: {
  kind: 'personal' | 'team';
  showHeader: boolean;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessionCount: number;
  children: React.ReactNode;
}) {
  if (!showHeader) {
    return <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>;
  }

  const headerLabel = kind === 'team' ? '团队对话' : '个人对话';
  const headerHint = kind === 'team' ? '由团队发起的会话' : '你直接发起的会话';

  return (
    <section aria-label={headerLabel} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-expanded={!collapsed}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          margin: '0 -2px',
          borderRadius: 6,
          border: 'none',
          background: 'transparent',
          color: 'inherit',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            width: 12,
            height: 12,
            flexShrink: 0,
            color: 'var(--fg-muted)',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            transition: 'transform 140ms ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--fg-default)',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {headerLabel}
        </span>
        <span
          aria-hidden="true"
          style={{ fontSize: 10, color: 'var(--fg-muted)', fontWeight: 500 }}
        >
          {headerHint}
        </span>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 10,
            fontWeight: 600,
            padding: '1px 7px',
            borderRadius: 99,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-overlay)',
            color: 'var(--fg-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {sessionCount}
        </span>
      </button>
      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
      )}
    </section>
  );
}
