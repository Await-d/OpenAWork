import { memo, useDeferredValue, useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../stores/auth.js';
import { useUIStateStore } from '../stores/uiState.js';
import { exportSession, importSession } from '../utils/session-transfer.js';
import { createSessionsClient, withTokenRefresh } from '@openAwork/web-client';
import type { TokenStore } from '@openAwork/web-client';
import { logger } from '../utils/logger.js';
import { toast } from '../components/ToastNotification.js';
import {
  buildWorkspaceSessionCollections,
  getWorkspaceGroupKey,
} from '../utils/session-grouping.js';
import { subscribeSessionListRefresh } from '../utils/session-list-events.js';
import {
  getSessionDeleteErrorMessage,
  isSessionAlreadyDeletedError,
} from '../utils/session-delete.js';
import { extractWorkingDirectory } from '../utils/session-metadata.js';
import {
  buildSavedChatSessionMetadata,
  loadSavedChatSessionDefaults,
} from '../utils/chat-session-defaults.js';
import { FileChangeReviewPanel } from '@openAwork/shared-ui';
import type { FileChange } from '@openAwork/shared-ui';
import { SessionModeBadges } from '../components/SessionModeBadges.js';
import WorkspacePickerModal from '../components/WorkspacePickerModal.js';
import WorkspaceGroupMenu from '../components/layout/WorkspaceGroupMenu.js';
import { WorkspaceDeleteConfirmDialog } from '../components/layout/WorkspaceDeleteConfirmDialog.js';
import { preloadRouteModuleByPath } from '../routes/preloadable-route-modules.js';
import { UNBOUND_WORKSPACE_GROUP_KEY } from '../utils/session-grouping.js';

interface SessionRow {
  id: string;
  title?: string;
  state_status: string;
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

const PULSE_CSS = `
@keyframes omo-pulse{0%,100%{opacity:1}50%{opacity:0.35}}
.omo-skel{animation:omo-pulse 1.5s ease-in-out infinite;background:var(--surface-2);border-radius:4px;}
@keyframes omo-session-running-dot{0%,100%{opacity:0.58;transform:scale(0.9)}50%{opacity:1;transform:scale(1.2)}}
.omo-session-running-dot{animation:omo-session-running-dot 1.15s ease-in-out infinite;will-change:transform,opacity;}
@media (prefers-reduced-motion: reduce){.omo-skel,.omo-session-running-dot{animation:none;}}
`;

const SESSION_PAGE_STYLE_ID = 'omo-sessions-page-animations';

const SESSION_CARD_ACTION_BUTTON_STYLE: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 5,
  padding: '2px 7px',
  fontSize: 11,
  color: 'var(--text-3)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  lineHeight: 1.4,
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}周前`;
  return `${Math.floor(days / 30)}个月前`;
}

function statusLabel(s: string): string {
  if (s === 'idle') return '空闲';
  if (s === 'running') return '运行中';
  if (s === 'error') return '错误';
  return s;
}

function statusDotColor(s: string): string {
  if (s === 'running') return '#22c55e';
  if (s === 'error') return 'var(--danger)';
  return 'var(--accent)';
}

function statusBadgeBg(s: string): string {
  if (s === 'running') return 'rgba(34,197,94,0.12)';
  if (s === 'error') return 'rgba(239,68,68,0.12)';
  return 'var(--accent-muted)';
}

function statusBadgeFg(s: string): string {
  if (s === 'running') return '#22c55e';
  if (s === 'error') return 'var(--danger)';
  return 'var(--accent)';
}

function isNestedInteractiveTarget(target: EventTarget | null): target is Element {
  return target instanceof Element && target.closest('button, input, textarea, select, a') !== null;
}

function SkeletonCard() {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
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
  const removeSavedWorkspacePath = useUIStateStore((s) => s.removeSavedWorkspacePath);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [deletingSessionIds, setDeletingSessionIds] = useState<Set<string>>(() => new Set());
  const [reviewChanges, setReviewChanges] = useState<FileChange[]>([]);
  const [reviewDiff, setReviewDiff] = useState<Record<string, string>>({});
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
        setSessions(list as unknown as SessionRow[]);
      } catch {
        return;
      } finally {
        if (!keepCurrentLoadingState && loadSessionsRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [gatewayUrl, token],
  );

  useEffect(() => {
    const existingStyle = document.getElementById(SESSION_PAGE_STYLE_ID);
    if (existingStyle instanceof HTMLStyleElement) {
      return undefined;
    }

    const el = document.createElement('style');
    el.id = SESSION_PAGE_STYLE_ID;
    el.textContent = PULSE_CSS;
    document.head.appendChild(el);

    return () => {
      el.remove();
    };
  }, []);

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

  useEffect(() => {
    if (!token || !selectedId) {
      setReviewChanges([]);
      setReviewDiff({});
      return;
    }

    const selected = sessions.find((session) => session.id === selectedId);
    const workingDirectory = extractWorkingDirectory(selected?.metadata_json);
    if (!workingDirectory) {
      setReviewChanges([]);
      setReviewDiff({});
      return;
    }

    let cancelled = false;
    void fetch(
      `${gatewayUrl}/workspace/review/status?path=${encodeURIComponent(workingDirectory)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('status'))))
      .then((data: { changes: FileChange[] }) => {
        if (!cancelled) {
          setReviewChanges(data.changes ?? []);
          setReviewDiff({});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReviewChanges([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedId, sessions, token, gatewayUrl]);

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

  const fetchWorkspaceRoots = useCallback(async (): Promise<string[]> => {
    const res = await fetch(`${gatewayUrl}/workspace/root`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('fetchRootPath failed');
    const data = (await res.json()) as { root?: string; roots?: string[] };
    const roots = Array.isArray(data.roots)
      ? data.roots.filter((root) => typeof root === 'string' && root.length > 0)
      : typeof data.root === 'string' && data.root.length > 0
        ? [data.root]
        : [];

    if (roots.length === 0) {
      throw new Error('fetchRootPath failed');
    }

    return roots;
  }, [token, gatewayUrl]);

  const fetchRootPath = useCallback(async (): Promise<string> => {
    const roots = await fetchWorkspaceRoots();
    const root = roots[0];
    if (!root) {
      throw new Error('fetchRootPath failed');
    }

    return root;
  }, [fetchWorkspaceRoots]);

  const fetchTree = useCallback(
    async (path: string, depth = 1) => {
      const res = await fetch(
        `${gatewayUrl}/workspace/tree?path=${encodeURIComponent(path)}&depth=${depth}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error('fetchTree failed');
      const data = await res.json();
      return (data?.nodes ??
        data) as import('../components/WorkspacePickerModal.js').FileTreeNode[];
    },
    [token, gatewayUrl],
  );

  const validatePath = useCallback(
    async (path: string): Promise<{ valid: boolean; error?: string; path?: string }> => {
      const res = await fetch(`${gatewayUrl}/workspace/validate?path=${encodeURIComponent(path)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        return { valid: false, error: `Validation request failed: ${res.status}` };
      }

      return res.json();
    },
    [gatewayUrl, token],
  );

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
  const allWorkspaceCollections = useMemo(
    () => buildWorkspaceSessionCollections(sessions, savedWorkspacePaths),
    [savedWorkspacePaths, sessions],
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
  const groupedSessions = useMemo(
    () =>
      allWorkspaceCollections.groups.map((group) => ({
        ...group,
        sessions: group.sessions.filter((session) => filteredSessionIds.has(session.id)),
      })),
    [allWorkspaceCollections.groups, filteredSessionIds],
  );
  const sessionCountByWorkspace = allWorkspaceCollections.sessionCountByWorkspace;
  const workspaceSessionIdsByGroupKey = allWorkspaceCollections.sessionIdsByGroupKey;

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

  return (
    <div className="page-root">
      <TopBar
        count={sessions.length}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onImport={() => {
          importSession();
          setTimeout(() => {
            if (!token) return;
            createSessionsClient(gatewayUrl)
              .list(token)
              .then((list) => setSessions(list as unknown as SessionRow[]))
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
        fetchRootPath={fetchRootPath}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        validatePath={validatePath}
        initialPath={pendingWorkspacePath ?? undefined}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            background: 'var(--bg)',
          }}
        >
          <ul
            style={{
              padding: '0.625rem',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              margin: 0,
            }}
          >
            {loading ? (
              [0, 1, 2, 3, 4].map((i) => <SkeletonCard key={`skel-${i}`} />)
            ) : groupedSessions.length === 0 ? (
              <EmptyList onNew={() => void createSession()} />
            ) : (
              groupedSessions.map((group) => {
                const actualSessionCount =
                  sessionCountByWorkspace.get(getWorkspaceGroupKey(group.workspacePath)) ?? 0;

                return (
                  <div
                    key={group.workspacePath ?? '__unbound__'}
                    style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  >
                    <div
                      style={{
                        padding: '8px 2px 4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <button
                        type="button"
                        onContextMenu={(event) => {
                          if (!group.workspacePath && actualSessionCount === 0) {
                            return;
                          }

                          event.preventDefault();
                          setWorkspaceContextMenu({
                            groupKey: getWorkspaceGroupKey(group.workspacePath),
                            sessionCount: actualSessionCount,
                            workspaceLabel: group.workspaceLabel,
                            workspacePath: group.workspacePath,
                            x: event.clientX,
                            y: event.clientY,
                          });
                        }}
                        onKeyDown={(event) => {
                          if (!group.workspacePath && actualSessionCount === 0) {
                            return;
                          }

                          if (
                            event.key !== 'ContextMenu' &&
                            !(event.shiftKey && event.key === 'F10')
                          ) {
                            return;
                          }

                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setWorkspaceContextMenu({
                            groupKey: getWorkspaceGroupKey(group.workspacePath),
                            sessionCount: actualSessionCount,
                            workspaceLabel: group.workspaceLabel,
                            workspacePath: group.workspacePath,
                            x: rect.left + 24,
                            y: rect.bottom,
                          });
                        }}
                        title={
                          group.workspacePath || actualSessionCount > 0
                            ? `右键管理工作区 ${group.workspaceLabel}`
                            : undefined
                        }
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                          minWidth: 0,
                          flex: 1,
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          cursor: group.workspacePath ? 'context-menu' : 'default',
                          textAlign: 'left',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            minWidth: 0,
                            flex: 1,
                          }}
                        >
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>
                            {group.workspaceLabel}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              color: 'var(--text-3)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={group.workspacePath ?? '未绑定工作区'}
                          >
                            {group.workspacePath ?? '未绑定工作区'}
                          </span>
                        </div>
                      </button>
                      {group.workspacePath && (
                        <button
                          type="button"
                          onClick={() => void createSession(group.workspacePath)}
                          title={`在 ${group.workspaceLabel} 中新建会话`}
                          style={{
                            flexShrink: 0,
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: '2px 8px',
                            fontSize: 11,
                            color: 'var(--text-3)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          + 新建
                        </button>
                      )}
                    </div>
                    {group.sessions.map((s) => (
                      <SessionCard
                        key={s.id}
                        s={s}
                        isSelected={selectedId === s.id}
                        isHovered={hoveredId === s.id}
                        isDeleting={deletingSessionIds.has(s.id)}
                        isRenaming={renamingId === s.id}
                        renameValue={renameValue}
                        smallBtn={SESSION_CARD_ACTION_BUTTON_STYLE}
                        onHoverEnter={handleSessionHoverEnter}
                        onHoverMove={handleSessionHoverMove}
                        onHoverLeave={handleSessionHoverLeave}
                        onSelect={handleSessionSelect}
                        onRenameChange={setRenameValue}
                        onRenameCommit={handleSessionRenameCommit}
                        onRenameCancel={handleSessionRenameCancel}
                        onStartRename={handleSessionStartRename}
                        onExport={handleSessionExport}
                        onDelete={handleSessionDelete}
                      />
                    ))}
                    {group.sessions.length === 0 && (
                      <div
                        style={{
                          padding: '8px 10px 8px 8px',
                          borderRadius: 6,
                          color: 'var(--text-3)',
                          fontSize: 11,
                          lineHeight: 1.5,
                        }}
                      >
                        {actualSessionCount === 0
                          ? '暂无会话，可在此工作区中新建一个会话。'
                          : '当前筛选条件下暂无匹配会话。'}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </ul>
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
            reviewChanges={reviewChanges}
            reviewDiff={reviewDiff}
            setReviewChanges={setReviewChanges}
            setReviewDiff={setReviewDiff}
          />
        ) : (
          <EmptyDetail />
        )}
      </div>
      {workspaceContextMenu && (
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
            setPendingWorkspaceDeletion({
              groupKey: workspaceContextMenu.groupKey,
              sessionIds: workspaceSessionIdsByGroupKey.get(workspaceContextMenu.groupKey) ?? [],
              workspaceLabel: workspaceContextMenu.workspaceLabel,
              workspacePath: workspaceContextMenu.workspacePath,
            });
          }}
        />
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

interface SessionCardProps {
  s: SessionRow;
  isDeleting: boolean;
  isSelected: boolean;
  isHovered: boolean;
  isRenaming: boolean;
  renameValue: string;
  smallBtn: React.CSSProperties;
  onHoverEnter: (sessionId: string, position?: { x: number; y: number }) => void;
  onHoverMove: (sessionId: string, position: { x: number; y: number }) => void;
  onHoverLeave: (sessionId: string) => void;
  onSelect: (sessionId: string) => void;
  onRenameChange: (v: string) => void;
  onRenameCommit: (sessionId: string) => void;
  onRenameCancel: () => void;
  onStartRename: (session: SessionRow) => void;
  onExport: (session: SessionRow) => void;
  onDelete: (sessionId: string) => void;
}

const SessionCard = memo(function SessionCard({
  s,
  isDeleting,
  isSelected,
  isHovered,
  isRenaming,
  renameValue,
  smallBtn,
  onHoverEnter,
  onHoverMove,
  onHoverLeave,
  onSelect,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onStartRename,
  onExport,
  onDelete,
}: SessionCardProps) {
  return (
    <li
      data-session-id={s.id}
      data-session-state={s.state_status}
      onClick={(event) => {
        if (isNestedInteractiveTarget(event.target)) {
          return;
        }

        onSelect(s.id);
      }}
      onKeyDown={(event) => {
        if (isNestedInteractiveTarget(event.target)) {
          return;
        }

        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(s.id);
        }
      }}
      onMouseEnter={(event) => onHoverEnter(s.id, { x: event.clientX, y: event.clientY })}
      onMouseMove={(event) => onHoverMove(s.id, { x: event.clientX, y: event.clientY })}
      onMouseLeave={() => onHoverLeave(s.id)}
      onFocusCapture={() => onHoverEnter(s.id)}
      onBlurCapture={(event) => {
        const nextTarget = event.relatedTarget;
        if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
          onHoverLeave(s.id);
        }
      }}
      style={{
        listStyle: 'none',
        background: isSelected
          ? 'var(--accent-muted)'
          : isHovered
            ? 'var(--surface-2)'
            : 'var(--surface)',
        border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border)',
        borderRadius: 9,
        padding: '0.625rem 0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        transition: 'background 120ms, border-color 120ms',
        contentVisibility: 'auto',
        containIntrinsicSize: '58px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span
          data-session-running={s.state_status === 'running' ? 'true' : 'false'}
          aria-hidden="true"
          className={s.state_status === 'running' ? 'omo-session-running-dot' : undefined}
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: statusDotColor(s.state_status),
            flexShrink: 0,
            boxShadow: s.state_status === 'running' ? '0 0 6px #22c55e' : 'none',
          }}
        />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isRenaming ? (
            <input
              ref={(el) => el?.focus()}
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') onRenameCommit(s.id);
                if (e.key === 'Escape') onRenameCancel();
              }}
              onBlur={() => onRenameCommit(s.id)}
              style={{
                flex: 1,
                background: 'var(--bg-2)',
                border: '1px solid var(--accent)',
                borderRadius: 4,
                padding: '2px 6px',
                color: 'var(--text)',
                fontSize: 12,
                outline: 'none',
              }}
            />
          ) : (
            <>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  color: 'var(--text)',
                }}
              >
                <span
                  title={s.title ?? s.id}
                  style={{
                    display: 'block',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {s.title ?? (
                    <span style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 11 }}>
                      {s.id.slice(0, 8)}…
                    </span>
                  )}
                </span>
              </button>
            </>
          )}
          <div
            style={{
              position: 'relative',
              width: 216,
              height: 30,
              flexShrink: 0,
              marginLeft: 'auto',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 6,
                opacity: !isRenaming && !isHovered ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: 'none',
                willChange: 'opacity',
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {relativeTime(s.updated_at)}
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  borderRadius: 99,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  background: statusBadgeBg(s.state_status),
                  color: statusBadgeFg(s.state_status),
                  fontWeight: 600,
                }}
              >
                {s.state_status === 'running' ? (
                  <span
                    aria-hidden="true"
                    className="omo-session-running-dot"
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: '50%',
                      background: 'currentColor',
                      flexShrink: 0,
                    }}
                  />
                ) : null}
                {statusLabel(s.state_status)}
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  minWidth: 0,
                  maxWidth: 112,
                  overflow: 'hidden',
                }}
              >
                <SessionModeBadges compact metadataJson={s.metadata_json} />
              </span>
            </span>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 6,
                opacity: isHovered ? 1 : 0,
                transition: 'opacity 120ms ease-out',
                pointerEvents: isHovered ? 'auto' : 'none',
                willChange: 'opacity',
              }}
            >
              <button
                type="button"
                onClick={() => onStartRename(s)}
                style={smallBtn}
                tabIndex={isHovered ? 0 : -1}
              >
                重命名
              </button>
              <button
                type="button"
                onClick={() => onExport(s)}
                style={smallBtn}
                tabIndex={isHovered ? 0 : -1}
              >
                导出
              </button>
              <button
                type="button"
                onClick={() => onDelete(s.id)}
                disabled={isDeleting}
                tabIndex={isHovered ? 0 : -1}
                style={{
                  ...smallBtn,
                  color: 'var(--danger)',
                  borderColor: 'rgba(239,68,68,0.3)',
                  opacity: isDeleting ? 0.5 : 1,
                  cursor: isDeleting ? 'wait' : smallBtn.cursor,
                }}
              >
                {isDeleting ? '删除中…' : '删除'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </li>
  );
}, areSessionCardPropsEqual);

function areSessionCardPropsEqual(previous: SessionCardProps, next: SessionCardProps): boolean {
  const renameValueUnchanged =
    (!previous.isRenaming && !next.isRenaming) || previous.renameValue === next.renameValue;

  return (
    previous.s === next.s &&
    previous.isDeleting === next.isDeleting &&
    previous.isSelected === next.isSelected &&
    previous.isHovered === next.isHovered &&
    previous.isRenaming === next.isRenaming &&
    renameValueUnchanged &&
    previous.smallBtn === next.smallBtn &&
    previous.onHoverEnter === next.onHoverEnter &&
    previous.onHoverMove === next.onHoverMove &&
    previous.onHoverLeave === next.onHoverLeave &&
    previous.onSelect === next.onSelect &&
    previous.onRenameChange === next.onRenameChange &&
    previous.onRenameCommit === next.onRenameCommit &&
    previous.onRenameCancel === next.onRenameCancel &&
    previous.onStartRename === next.onStartRename &&
    previous.onExport === next.onExport &&
    previous.onDelete === next.onDelete
  );
}

function DetailPanel({
  selected,
  copiedId,
  onOpenChat,
  onPreloadChat,
  onExport,
  onCopyId,
  gatewayUrl,
  token,
  reviewChanges,
  reviewDiff,
  setReviewChanges,
  setReviewDiff,
}: {
  selected: SessionRow;
  copiedId: boolean;
  onOpenChat: () => void;
  onPreloadChat: () => void;
  onExport: () => void;
  onCopyId: () => void;
  gatewayUrl: string;
  token: string;
  reviewChanges: FileChange[];
  reviewDiff: Record<string, string>;
  setReviewChanges: React.Dispatch<React.SetStateAction<FileChange[]>>;
  setReviewDiff: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}) {
  const selectedWorkingDirectory = extractWorkingDirectory(selected.metadata_json);

  const ab: React.CSSProperties = {
    background: 'transparent',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: '3px 10px',
    fontSize: 12,
    color: 'var(--text-3)',
    cursor: 'pointer',
  };
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--bg-2)',
      }}
    >
      <div
        style={{
          padding: '1.25rem 1.5rem',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: 'var(--text)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 6,
              }}
            >
              {selected.title ?? (
                <span style={{ color: 'var(--text-3)', fontFamily: 'monospace', fontSize: 14 }}>
                  {selected.id.slice(0, 8)}…
                </span>
              )}
            </div>
            <span
              style={{
                fontSize: 11,
                padding: '2px 9px',
                borderRadius: 99,
                background: statusBadgeBg(selected.state_status),
                color: statusBadgeFg(selected.state_status),
                fontWeight: 600,
              }}
            >
              {statusLabel(selected.state_status)}
            </span>
          </div>
          <button
            type="button"
            onClick={onOpenChat}
            onPointerEnter={onPreloadChat}
            onFocus={onPreloadChat}
            style={{
              background: 'var(--accent)',
              color: 'var(--accent-text)',
              border: 'none',
              borderRadius: 8,
              padding: '7px 18px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            打开对话
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '1.25rem 1.5rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem 2rem',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '1rem 1.25rem',
            marginBottom: '1rem',
          }}
        >
          <DetailField label="状态" value={statusLabel(selected.state_status)} />
          <DetailField label="更新时间" value={new Date(selected.updated_at).toLocaleString()} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
            <span
              style={{
                fontSize: 10,
                color: 'var(--text-3)',
                textTransform: 'uppercase',
                letterSpacing: 0.6,
              }}
            >
              会话 ID
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text)', fontFamily: 'monospace' }}>
                {selected.id.slice(0, 8)}…
              </span>
              <button
                type="button"
                onClick={onCopyId}
                style={{ ...ab, padding: '2px 8px', fontSize: 11 }}
              >
                {copiedId ? '已复制' : '复制'}
              </button>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onExport} style={ab}>
            导出会话
          </button>
        </div>
        {selected.metadata_json && selectedWorkingDirectory && (
          <div style={{ marginTop: '1rem' }}>
            <FileChangeReviewPanel
              changes={reviewChanges}
              loadDiff={async (filePath: string) => {
                const cached = reviewDiff[filePath];
                if (cached !== undefined) return cached;
                const response = await fetch(
                  `${gatewayUrl}/workspace/review/diff?path=${encodeURIComponent(selectedWorkingDirectory)}&filePath=${encodeURIComponent(filePath)}`,
                  { headers: { Authorization: `Bearer ${token}` } },
                );
                if (!response.ok) return '';
                const data = (await response.json()) as { diff: string };
                setReviewDiff((prev) => ({ ...prev, [filePath]: data.diff ?? '' }));
                return data.diff ?? '';
              }}
              onAccept={(filePath: string) => {
                setReviewChanges((prev) => prev.filter((change) => change.path !== filePath));
              }}
              onRevert={async (filePath: string) => {
                const response = await fetch(`${gatewayUrl}/workspace/review/revert`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    path: selectedWorkingDirectory,
                    filePath,
                  }),
                });
                if (!response.ok) {
                  throw new Error('revert failed');
                }
                setReviewChanges((prev) => prev.filter((change) => change.path !== filePath));
                setReviewDiff((prev) => {
                  const next = { ...prev };
                  delete next[filePath];
                  return next;
                });
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span
        style={{
          fontSize: 10,
          color: 'var(--text-3)',
          textTransform: 'uppercase',
          letterSpacing: 0.6,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          color: 'var(--text)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}

function TopBar({
  count,
  searchQuery,
  onSearchChange,
  onImport,
  onNew,
  onNewWithWorkspace,
}: {
  count: number;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onImport: () => void;
  onNew: () => void;
  onNewWithWorkspace: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0.75rem 1.25rem',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)',
        flexShrink: 0,
      }}
    >
      <h2 style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', margin: 0, flexShrink: 0 }}>
        会话
      </h2>
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          background: 'var(--accent-muted)',
          color: 'var(--accent)',
          borderRadius: 99,
          padding: '1px 7px',
          flexShrink: 0,
        }}
      >
        {count}
      </span>
      <input
        type="text"
        placeholder="搜索会话…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        style={{
          flex: 1,
          background: 'var(--surface)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 7,
          padding: '5px 10px',
          fontSize: 12,
          color: 'var(--text)',
          outline: 'none',
          minWidth: 0,
        }}
      />
      <button
        type="button"
        onClick={onImport}
        style={{
          background: 'var(--surface)',
          color: 'var(--text-2)',
          border: '1px solid var(--border)',
          borderRadius: 7,
          padding: '5px 12px',
          fontSize: 12,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        导入
      </button>
      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onNew}
          style={{
            background: 'var(--accent)',
            color: 'var(--accent-text)',
            border: 'none',
            borderRadius: '7px 0 0 7px',
            padding: '5px 14px',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
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
            color: 'var(--accent-text)',
            border: 'none',
            borderLeft: '1px solid oklch(from var(--accent) calc(l - 0.1) c h)',
            borderRadius: '0 7px 7px 0',
            padding: '5px 8px',
            fontSize: 12,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
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

function EmptyList({ onNew }: { onNew: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '3rem 1rem',
        color: 'var(--text-3)',
        textAlign: 'center',
      }}
    >
      <svg
        width="36"
        height="36"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 10h8M8 14h5" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 12, fontWeight: 500 }}>还没有会话</span>
      <button
        type="button"
        onClick={onNew}
        style={{
          background: 'var(--accent)',
          color: 'var(--accent-text)',
          border: 'none',
          borderRadius: 7,
          padding: '6px 16px',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        新建会话
      </button>
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
        color: 'var(--text-3)',
        background: 'var(--bg-2)',
      }}
    >
      <svg
        width="56"
        height="56"
        viewBox="0 0 56 56"
        fill="none"
        role="img"
        aria-label="无选中会话"
      >
        <title>无选中会话</title>
        <rect x="4" y="8" width="34" height="26" rx="6" stroke="currentColor" strokeWidth="2" />
        <path d="M4 30l6 8v-8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <rect x="18" y="22" width="34" height="26" rx="6" stroke="currentColor" strokeWidth="2" />
        <path d="M52 44l-6 8v-8" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="16" cy="21" r="2" fill="currentColor" />
        <circle cx="24" cy="21" r="2" fill="currentColor" />
        <circle cx="32" cy="21" r="2" fill="currentColor" />
      </svg>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
          选择一个会话
        </div>
        <div style={{ fontSize: 12 }}>在左侧点击会话以查看详情和操作</div>
      </div>
    </div>
  );
}
