import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeamClient,
  type CreateTeamMemberInput,
  type CreateTeamMessageInput,
  type CreateTeamSessionShareInput,
  type CreateTeamTaskInput,
  type SharedSessionDetailRecord,
  type SharedSessionSummaryRecord,
  type SessionTask,
  type TeamAuditLogRecord,
  type TeamMemberRecord,
  type TeamMessageRecord,
  type TeamRuntimeLoadResult,
  type TeamRuntimeReadModel,
  type TeamSessionShareRecord,
  type TeamTaskRecord,
  type UpdateTeamTaskInput,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  hydrateClarificationStore,
  hydrateNotificationStore,
  hydrateTeamRuntimeStores,
  useTeamNotificationStore,
  useTeamEventsConnectionStore,
} from '../../../stores/team/team-events.js';
import {
  appendSharedSessionCommentPreview,
  applySharedSessionPermissionReplyPreview,
  applySharedSessionQuestionReplyPreview,
} from './shared-session-local-detail.js';
import {
  computeExponentialRetryDelay,
  formatRecoverableLoadError,
} from './recoverable-read-model.js';
import { useRecoverableRetryController } from './use-recoverable-retry.js';

const TEAM_RUNTIME_SNAPSHOT_RETRY_BASE_MS = 2_000;
const TEAM_RUNTIME_SNAPSHOT_RETRY_MAX_MS = 30_000;
const SHARED_SESSION_DETAIL_RETRY_BASE_MS = 2_000;
const SHARED_SESSION_DETAIL_RETRY_MAX_MS = 15_000;
const SHARED_SESSION_PRESENCE_RETRY_BASE_MS = 5_000;
const SHARED_SESSION_PRESENCE_RETRY_MAX_MS = 30_000;

export interface TeamActionFeedback {
  message: string;
  tone: 'error' | 'success';
}

export function computeTeamRuntimeSnapshotRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: TEAM_RUNTIME_SNAPSHOT_RETRY_BASE_MS,
    maxMs: TEAM_RUNTIME_SNAPSHOT_RETRY_MAX_MS,
  });
}

export function formatTeamRuntimeLoadError(input: {
  hasCachedSnapshot: boolean;
  nextRetryAtMs?: number | null;
  result: Pick<TeamRuntimeLoadResult, 'errorMessage' | 'retryable'>;
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载团队运行时快照失败。',
    hasRetainedData: input.hasCachedSnapshot,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '快照',
    retryable: input.result.retryable,
  });
}

export function computeSharedSessionDetailRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: SHARED_SESSION_DETAIL_RETRY_BASE_MS,
    maxMs: SHARED_SESSION_DETAIL_RETRY_MAX_MS,
  });
}

export function formatSharedSessionDetailLoadError(input: {
  hasCachedDetail: boolean;
  nextRetryAtMs?: number | null;
  result: { errorMessage?: string; retryable: boolean };
}): string {
  return formatRecoverableLoadError({
    baseMessage: input.result.errorMessage ?? '加载共享会话详情失败。',
    hasRetainedData: input.hasCachedDetail,
    nextRetryAtMs: input.nextRetryAtMs,
    retainedDataLabel: '详情',
    retryable: input.result.retryable,
  });
}

export function computeSharedSessionPresenceRetryDelay(attempt: number): number {
  return computeExponentialRetryDelay({
    attempt,
    baseMs: SHARED_SESSION_PRESENCE_RETRY_BASE_MS,
    maxMs: SHARED_SESSION_PRESENCE_RETRY_MAX_MS,
  });
}

export function formatSharedSessionPresenceLoadError(input: {
  errorMessage?: string | null;
  retryable: boolean;
}): string {
  return input.errorMessage?.trim() || '共享会话在线状态暂时无法刷新。';
}

function sortMembers(members: TeamMemberRecord[]): TeamMemberRecord[] {
  return [...members].sort((left, right) => left.createdAt.localeCompare(right.createdAt, 'zh-CN'));
}

function sortTasks(tasks: TeamTaskRecord[]): TeamTaskRecord[] {
  const statusRank: Record<TeamTaskRecord['status'], number> = {
    in_progress: 0,
    pending: 1,
    failed: 2,
    completed: 3,
  };

  return [...tasks].sort((left, right) => {
    const rankDelta = statusRank[left.status] - statusRank[right.status];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return (right.updatedAt ?? right.createdAt ?? '').localeCompare(
      left.updatedAt ?? left.createdAt ?? '',
      'zh-CN',
    );
  });
}

function mapRuntimeTasksToTeamTasks(tasks: SessionTask[]): TeamTaskRecord[] {
  return tasks
    .filter((task) => task.status !== 'cancelled')
    .map((task) => ({
      id: task.id,
      title: task.title,
      assigneeId: null,
      status:
        task.status === 'running'
          ? 'in_progress'
          : task.status === 'completed'
            ? 'completed'
            : task.status === 'failed'
              ? 'failed'
              : 'pending',
      priority: task.priority,
      result: task.result ?? task.errorMessage ?? null,
      createdAt: new Date(task.createdAt).toISOString(),
      updatedAt: new Date(task.updatedAt).toISOString(),
    }));
}

function sortMessages(messages: TeamMessageRecord[]): TeamMessageRecord[] {
  return [...messages].sort((left, right) => left.timestamp - right.timestamp);
}

function sortSessionShares(shares: TeamSessionShareRecord[]): TeamSessionShareRecord[] {
  return [...shares].sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'zh-CN'));
}

function sortAuditLogs(logs: TeamAuditLogRecord[]): TeamAuditLogRecord[] {
  return [...logs].sort((left, right) => right.createdAt.localeCompare(left.createdAt, 'zh-CN'));
}

function sortSharedSessions(sessions: SharedSessionSummaryRecord[]): SharedSessionSummaryRecord[] {
  return [...sessions].sort((left, right) =>
    right.shareUpdatedAt.localeCompare(left.shareUpdatedAt, 'zh-CN'),
  );
}

export function useTeamCollaboration(
  teamWorkspaceId?: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [auditLogs, setAuditLogs] = useState<TeamAuditLogRecord[]>([]);
  const [diagnostics, setDiagnostics] = useState<TeamRuntimeReadModel['diagnostics']>(undefined);
  const [members, setMembers] = useState<TeamMemberRecord[]>([]);
  const [tasks, setTasks] = useState<TeamTaskRecord[]>([]);
  const [messages, setMessages] = useState<TeamMessageRecord[]>([]);
  const [sessionShares, setSessionShares] = useState<TeamSessionShareRecord[]>([]);
  const [sharedSessions, setSharedSessions] = useState<SharedSessionSummaryRecord[]>([]);
  const [sessions, setSessions] = useState<
    Array<{
      id: string;
      metadataJson: string;
      parentSessionId: string | null;
      roleLayer: string | null;
      stateStatus: string;
      title: string | null;
      updatedAt: string;
      workspacePath: string | null;
    }>
  >([]);
  const [selectedSharedSessionId, setSelectedSharedSessionId] = useState<string | null>(null);
  const [selectedSharedSession, setSelectedSharedSession] =
    useState<SharedSessionDetailRecord | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<SessionTask[]>([]);
  const [runtimeTaskGroups, setRuntimeTaskGroups] = useState<
    TeamRuntimeReadModel['runtimeTaskGroups']
  >([]);
  const [runtimeTasksLoading, setRuntimeTasksLoading] = useState(false);
  const [sharedCommentBusy, setSharedCommentBusy] = useState(false);
  const [sharedOperateBusy, setSharedOperateBusy] = useState(false);
  const [sharedActionError, setSharedActionError] = useState<string | null>(null);
  const [sharedDetailError, setSharedDetailError] = useState<string | null>(null);
  const [sharedPresenceError, setSharedPresenceError] = useState<string | null>(null);
  const [sharedPresenceLastSyncedAt, setSharedPresenceLastSyncedAt] = useState<number | null>(null);
  const [sharedSessionLoading, setSharedSessionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TeamActionFeedback | null>(null);
  const selectedSharedSessionIdRef = useRef<string | null>(null);
  const selectedSharedSessionRef = useRef<SharedSessionDetailRecord | null>(null);
  const snapshotLoadedRef = useRef(false);
  const refreshPromiseRef = useRef<Promise<boolean> | null>(null);
  const {
    clearRetry: clearRuntimeSnapshotRetry,
    resetRetry: resetRuntimeSnapshotRetry,
    scheduleRetry: scheduleRuntimeSnapshotRetry,
  } = useRecoverableRetryController();
  const {
    clearRetry: clearSharedDetailRetry,
    resetRetry: resetSharedDetailRetry,
    scheduleRetry: scheduleSharedDetailRetry,
  } = useRecoverableRetryController();
  const [sharedDetailReloadTick, setSharedDetailReloadTick] = useState(0);
  const [sharedPresenceReloadTick, setSharedPresenceReloadTick] = useState(0);
  const {
    clearRetry: clearSharedPresenceRetry,
    resetRetry: resetSharedPresenceRetry,
    scheduleRetry: scheduleSharedPresenceRetry,
    nextRetryAtMs: sharedPresenceNextRetryAt,
  } = useRecoverableRetryController();
  const teamEventsRecoveredAt = useTeamEventsConnectionStore((state) => state.lastRecoveredAt);

  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const selectedSharedSessionKey = selectedSharedSession?.share.sessionId ?? null;
  const triggerSharedPresenceReload = useCallback(() => {
    setSharedPresenceReloadTick((tick) => tick + 1);
  }, []);

  useEffect(() => {
    selectedSharedSessionIdRef.current = selectedSharedSessionId;
  }, [selectedSharedSessionId]);

  useEffect(() => {
    selectedSharedSessionRef.current = selectedSharedSession;
  }, [selectedSharedSession]);

  const commitSelectedSharedSessionIfCurrent = useCallback(
    (sessionId: string, detail: SharedSessionDetailRecord | null) => {
      if (selectedSharedSessionIdRef.current !== sessionId) {
        return;
      }
      setSelectedSharedSession(detail);
    },
    [],
  );

  const patchSelectedSharedSessionIfCurrent = useCallback(
    (
      sessionId: string,
      updater: (current: SharedSessionDetailRecord | null) => SharedSessionDetailRecord | null,
    ) => {
      if (selectedSharedSessionIdRef.current !== sessionId) {
        return;
      }
      setSelectedSharedSession((current) => updater(current));
    },
    [],
  );

  const loadSelectedSharedSessionDetail = useCallback(
    async (sessionId: string) => {
      if (!accessToken) {
        return { ok: false, retryable: false, errorMessage: '未登录，无法读取共享会话详情。' };
      }
      return client.getSharedSessionDetailResult(accessToken, sessionId);
    },
    [accessToken, client],
  );

  const normalizeSnapshot = useCallback((runtime: TeamRuntimeReadModel): TeamRuntimeReadModel => {
    return {
      auditLogs: sortAuditLogs(runtime.auditLogs),
      clarifications: runtime.clarifications,
      diagnostics: runtime.diagnostics,
      handoffs: runtime.handoffs,
      members: sortMembers(runtime.members),
      messages: sortMessages(runtime.messages),
      notifications: runtime.notifications,
      runtimeTaskGroups: runtime.runtimeTaskGroups,
      sessionShares: sortSessionShares(runtime.sessionShares),
      sharedSessions: sortSharedSessions(runtime.sharedSessions),
      sessions: runtime.sessions,
      tasks: sortTasks(runtime.tasks),
    };
  }, []);

  const applySnapshot = useCallback((runtime: TeamRuntimeReadModel) => {
    const snapshot = normalizeSnapshot(runtime);
    setAuditLogs(snapshot.auditLogs);
    setDiagnostics(snapshot.diagnostics);
    setMembers(snapshot.members);
    setTasks(snapshot.tasks);
    setMessages(snapshot.messages);
    setRuntimeTaskGroups(snapshot.runtimeTaskGroups);
    setSessionShares(snapshot.sessionShares);
    setSharedSessions(snapshot.sharedSessions);
    setSessions(snapshot.sessions);
    hydrateNotificationStore(snapshot.notifications);
    hydrateClarificationStore(snapshot.clarifications);
    hydrateTeamRuntimeStores({
      handoffs: snapshot.handoffs,
      sessions: snapshot.sessions,
    });
    snapshotLoadedRef.current = true;
  }, [normalizeSnapshot]);

  const refresh = useCallback(async () => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      clearRuntimeSnapshotRetry();

      if (!accessToken || !enabled) {
        snapshotLoadedRef.current = false;
        resetRuntimeSnapshotRetry();
        setAuditLogs([]);
        setDiagnostics(undefined);
        setMembers([]);
        setTasks([]);
        setMessages([]);
        setRuntimeTaskGroups([]);
        setSessionShares([]);
        setSharedSessions([]);
        setSessions([]);
        setSelectedSharedSessionId(null);
        setSelectedSharedSession(null);
        setRuntimeTasks([]);
        useTeamNotificationStore.getState().clear();
        hydrateClarificationStore([]);
        hydrateTeamRuntimeStores({ handoffs: [], sessions: [] });
        setLoading(false);
        setError(null);
        return true;
      }

      const hasCachedSnapshot = snapshotLoadedRef.current;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        resetRuntimeSnapshotRetry();
        setLoading(false);
        setError(
          formatTeamRuntimeLoadError({
            hasCachedSnapshot,
            result: {
              errorMessage: '当前网络离线，团队运行时快照暂时不可用。',
              retryable: true,
            },
          }),
        );
        return false;
      }

      setLoading(!hasCachedSnapshot);
      setError(null);
      const result = await client.getRuntimeResult(
        accessToken,
        teamWorkspaceId ? { teamWorkspaceId } : undefined,
      );

      if (result.ok && result.runtime) {
        resetRuntimeSnapshotRetry();
        applySnapshot(result.runtime);
        setLoading(false);
        setError(null);
        return true;
      }

      const nextRetryAtMs = scheduleRuntimeSnapshotRetry({
        computeDelay: computeTeamRuntimeSnapshotRetryDelay,
        onRetry: () => {
          void refresh();
        },
        retryable: result.retryable,
      });
      setLoading(false);
      setError(
        formatTeamRuntimeLoadError({
          hasCachedSnapshot,
          nextRetryAtMs,
          result,
        }),
      );
      return false;
    })();

    refreshPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null;
      }
    }
  }, [
    accessToken,
    applySnapshot,
    client,
    enabled,
    clearRuntimeSnapshotRetry,
    resetRuntimeSnapshotRetry,
    scheduleRuntimeSnapshotRetry,
    teamWorkspaceId,
  ]);

  useEffect(() => {
    return () => {
      clearRuntimeSnapshotRetry();
    };
  }, [clearRuntimeSnapshotRetry]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => {
      resetRuntimeSnapshotRetry();
      resetSharedDetailRetry();
      resetSharedPresenceRetry();
      setSharedDetailReloadTick((tick) => tick + 1);
      triggerSharedPresenceReload();
      void refresh();
    };
    const handleOffline = () => {
      setLoading(false);
      setError(
        formatTeamRuntimeLoadError({
          hasCachedSnapshot: snapshotLoadedRef.current,
          result: {
            errorMessage: '当前网络离线，团队运行时快照暂时不可用。',
            retryable: true,
          },
        }),
      );
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [
    enabled,
    refresh,
    resetRuntimeSnapshotRetry,
    resetSharedDetailRetry,
    resetSharedPresenceRetry,
    triggerSharedPresenceReload,
  ]);

  const refreshAndResolveFeedback = useCallback(
    async (successMessage: string) => {
      const refreshed = await refresh();
      setFeedback({
        message: refreshed
          ? successMessage
          : `${successMessage}，但最新运行时快照暂未刷新，系统会自动重试。`,
        tone: 'success',
      });
      return true;
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!teamEventsRecoveredAt || !accessToken || !enabled) {
      return;
    }
    resetRuntimeSnapshotRetry();
    resetSharedDetailRetry();
    resetSharedPresenceRetry();
    setSharedDetailReloadTick((tick) => tick + 1);
    triggerSharedPresenceReload();
    void refresh();
  }, [
    accessToken,
    enabled,
    refresh,
    resetRuntimeSnapshotRetry,
    resetSharedDetailRetry,
    resetSharedPresenceRetry,
    teamEventsRecoveredAt,
    triggerSharedPresenceReload,
  ]);

  const runMutation = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      setBusy(true);
      setError(null);
      setFeedback(null);
      try {
        await action();
        return await refreshAndResolveFeedback(successMessage);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '团队协作操作失败';
        setError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refreshAndResolveFeedback],
  );

  useEffect(() => {
    if (sharedSessions.length === 0) {
      setSelectedSharedSessionId(null);
      setSelectedSharedSession(null);
      return;
    }

    if (
      selectedSharedSessionId &&
      sharedSessions.some((session) => session.sessionId === selectedSharedSessionId)
    ) {
      return;
    }

    setSelectedSharedSessionId(sharedSessions[0]?.sessionId ?? null);
  }, [selectedSharedSessionId, sharedSessions]);

  useEffect(() => {
    if (!accessToken || !selectedSharedSessionId) {
      resetSharedDetailRetry();
      resetSharedPresenceRetry();
      setSelectedSharedSession(null);
      setSharedSessionLoading(false);
      setSharedActionError(null);
      setSharedDetailError(null);
      setSharedPresenceError(null);
      setSharedPresenceLastSyncedAt(null);
      setRuntimeTasks([]);
      setRuntimeTasksLoading(false);
      return;
    }

    let cancelled = false;
    clearSharedDetailRetry();
    clearSharedPresenceRetry();
    setSelectedSharedSession((current) =>
      current && current.share.sessionId === selectedSharedSessionId ? current : null,
    );
    const hasCachedDetail = Boolean(
      selectedSharedSessionRef.current &&
        selectedSharedSessionRef.current.share.sessionId === selectedSharedSessionId,
    );
    if (!hasCachedDetail) {
      setSharedPresenceError(null);
      setSharedPresenceLastSyncedAt(null);
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSharedSessionLoading(false);
      setSharedDetailError(
        formatSharedSessionDetailLoadError({
          hasCachedDetail,
          result: {
            errorMessage: '当前网络离线，共享会话详情暂时不可用。',
            retryable: true,
          },
        }),
      );
      return () => {
        cancelled = true;
      };
    }

    setSharedSessionLoading(!hasCachedDetail);
    setSharedDetailError(null);
    loadSelectedSharedSessionDetail(selectedSharedSessionId)
      .then(async (result) => {
        if (!result.ok || !result.detail) {
          const nextRetryAtMs = scheduleSharedDetailRetry({
            computeDelay: computeSharedSessionDetailRetryDelay,
            onRetry: () => {
              setSharedDetailReloadTick((tick) => tick + 1);
            },
            retryable: result.retryable,
          });
          if (!cancelled) {
            setSharedDetailError(
              formatSharedSessionDetailLoadError({
                hasCachedDetail,
                nextRetryAtMs,
                result,
              }),
            );
            setSharedSessionLoading(false);
          }
          return;
        }

        resetSharedDetailRetry();
        if (!cancelled) {
          commitSelectedSharedSessionIfCurrent(selectedSharedSessionId, result.detail);
          setSharedDetailError(null);
          triggerSharedPresenceReload();
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : '加载共享会话失败';
          setSharedDetailError(message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSharedSessionLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    accessToken,
    commitSelectedSharedSessionIfCurrent,
    loadSelectedSharedSessionDetail,
    selectedSharedSessionId,
    sharedDetailReloadTick,
    clearSharedPresenceRetry,
    client,
    clearSharedDetailRetry,
    resetSharedDetailRetry,
    resetSharedPresenceRetry,
    scheduleSharedDetailRetry,
    triggerSharedPresenceReload,
  ]);

  useEffect(() => {
    if (!accessToken || !selectedSharedSessionId) {
      setRuntimeTasks([]);
      setRuntimeTasksLoading(false);
      return;
    }

    let cancelled = false;
    setRuntimeTasks([]);
    setRuntimeTasksLoading(true);

    const matchingGroup = runtimeTaskGroups.find((group) =>
      group.sessionIds.includes(selectedSharedSessionId),
    );
    if (matchingGroup) {
      setRuntimeTasks(matchingGroup.tasks);
    }
    setRuntimeTasksLoading(false);

    return () => {
      cancelled = true;
    };
  }, [accessToken, selectedSharedSessionId, runtimeTaskGroups]);

  useEffect(() => {
    if (!accessToken || !selectedSharedSessionKey) {
      resetSharedPresenceRetry();
      return;
    }

    let cancelled = false;
    const syncPresence = async () => {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        if (!cancelled) {
          setSharedPresenceError('共享会话在线状态暂时无法刷新。');
          resetSharedPresenceRetry();
        }
        return;
      }
      const result = await client.touchSharedSessionPresenceResult(
        accessToken,
        selectedSharedSessionKey,
      );
      if (!result.ok || !result.presence) {
        if (!cancelled) {
          setSharedPresenceError(
            formatSharedSessionPresenceLoadError({
              errorMessage: result.errorMessage,
              retryable: result.retryable,
            }),
          );
          scheduleSharedPresenceRetry({
            computeDelay: computeSharedSessionPresenceRetryDelay,
            onRetry: () => {
              void syncPresence();
            },
            retryable: result.retryable,
          });
        }
        return;
      }
      if (!cancelled) {
        resetSharedPresenceRetry();
        setSharedPresenceError(null);
        setSharedPresenceLastSyncedAt(Date.now());
        setSelectedSharedSession((current) =>
          current && current.share.sessionId === selectedSharedSessionKey
            ? { ...current, presence: result.presence ?? [] }
            : current,
        );
      }
    };

    void syncPresence();
    const intervalId = window.setInterval(() => {
      void syncPresence();
    }, 30_000);

    return () => {
      cancelled = true;
      clearSharedPresenceRetry();
      window.clearInterval(intervalId);
    };
  }, [
    accessToken,
    clearSharedPresenceRetry,
    client,
    resetSharedPresenceRetry,
    scheduleSharedPresenceRetry,
    selectedSharedSessionKey,
    sharedPresenceReloadTick,
  ]);

  const createSharedSessionComment = useCallback(
    async (sessionId: string, input: { content: string }) => {
      if (!accessToken) {
        return false;
      }

      setSharedCommentBusy(true);
      setSharedActionError(null);
      setFeedback(null);
      try {
        const result = await client.createSharedSessionComment(accessToken, sessionId, input);
        patchSelectedSharedSessionIfCurrent(sessionId, (current) =>
          appendSharedSessionCommentPreview(current, { comment: result.comment, sessionId }),
        );
        if (result.detail) {
          commitSelectedSharedSessionIfCurrent(sessionId, result.detail);
        }
        return await refreshAndResolveFeedback('已发送共享评论');
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '发送共享评论失败';
        setSharedActionError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedCommentBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      client,
      patchSelectedSharedSessionIfCurrent,
      refreshAndResolveFeedback,
    ],
  );

  const replySharedSessionPermission = useCallback(
    async (
      sessionId: string,
      input: {
        alwaysOverride?: string[];
        decision: 'once' | 'session' | 'permanent' | 'reject';
        requestId: string;
      },
    ) => {
      if (!accessToken) {
        return false;
      }

      setSharedOperateBusy(true);
      setSharedActionError(null);
      setFeedback(null);
      try {
        const result = await client.replySharedSessionPermission(accessToken, sessionId, input);
        patchSelectedSharedSessionIfCurrent(sessionId, (current) =>
          applySharedSessionPermissionReplyPreview(current, {
            requestId: input.requestId,
            sessionId,
          }),
        );
        if (result.detail) {
          commitSelectedSharedSessionIfCurrent(sessionId, result.detail);
        }
        return await refreshAndResolveFeedback('已处理共享权限请求');
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '处理共享权限请求失败';
        setSharedActionError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedOperateBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      client,
      patchSelectedSharedSessionIfCurrent,
      refreshAndResolveFeedback,
    ],
  );

  const replySharedQuestion = useCallback(
    async (
      sessionId: string,
      input: { answers?: string[][]; requestId: string; status: 'answered' | 'dismissed' },
    ) => {
      if (!accessToken) {
        return false;
      }

      setSharedOperateBusy(true);
      setSharedActionError(null);
      setFeedback(null);
      try {
        const result = await client.replySharedSessionQuestion(accessToken, sessionId, input);
        patchSelectedSharedSessionIfCurrent(sessionId, (current) =>
          applySharedSessionQuestionReplyPreview(current, {
            requestId: input.requestId,
            sessionId,
          }),
        );
        if (result.detail) {
          commitSelectedSharedSessionIfCurrent(sessionId, result.detail);
        }
        return await refreshAndResolveFeedback('已处理共享提问');
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '处理共享提问失败';
        setSharedActionError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedOperateBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      client,
      patchSelectedSharedSessionIfCurrent,
      refreshAndResolveFeedback,
    ],
  );

  const createMember = useCallback(
    async (input: CreateTeamMemberInput) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.createMember(accessToken, input);
      }, '已新增团队成员');
    },
    [accessToken, client, runMutation],
  );

  const createTask = useCallback(
    async (input: CreateTeamTaskInput) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.createTask(accessToken, input);
      }, '已创建协作任务');
    },
    [accessToken, client, runMutation],
  );

  const updateTask = useCallback(
    async (taskId: string, input: UpdateTeamTaskInput) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.updateTask(accessToken, taskId, input);
      }, '已更新任务状态');
    },
    [accessToken, client, runMutation],
  );

  const createMessage = useCallback(
    async (input: CreateTeamMessageInput) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.createMessage(accessToken, input);
      }, '已发送团队消息');
    },
    [accessToken, client, runMutation],
  );

  const createSessionShare = useCallback(
    async (input: CreateTeamSessionShareInput) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.createSessionShare(accessToken, input);
      }, '已共享会话给团队成员');
    },
    [accessToken, client, runMutation],
  );

  const updateSessionShare = useCallback(
    async (shareId: string, input: { permission: TeamSessionShareRecord['permission'] }) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.updateSessionShare(accessToken, shareId, input);
      }, '已更新共享权限');
    },
    [accessToken, client, runMutation],
  );

  const deleteSessionShare = useCallback(
    async (shareId: string) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.deleteSessionShare(accessToken, shareId);
      }, '已取消共享会话');
    },
    [accessToken, client, runMutation],
  );

  const toggleSessionState = useCallback(
    async (sessionId: string, currentStatus: string) => {
      if (!accessToken) {
        return false;
      }
      const nextStatus: 'running' | 'paused' = currentStatus === 'running' ? 'paused' : 'running';
      return runMutation(
        async () => {
          await client.updateSessionState(accessToken, sessionId, {
            stateStatus: nextStatus,
          });
        },
        nextStatus === 'paused' ? '已暂停会话' : '已恢复会话',
      );
    },
    [accessToken, client, runMutation],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!accessToken) {
        return false;
      }
      return runMutation(async () => {
        await client.deleteSession(accessToken, sessionId);
      }, '已删除会话');
    },
    [accessToken, client, runMutation],
  );

  const applyRuntimeDiagnosticsPreview = useCallback(
    (diagnosticsPreview: TeamRuntimeReadModel['diagnostics']) => {
      setDiagnostics(diagnosticsPreview);
    },
    [],
  );

  const sharedOperateError = sharedActionError ?? sharedDetailError;

  return {
    applyRuntimeDiagnosticsPreview,
    auditLogs,
    busy,
    createMember,
    createMessage,
    createSharedSessionComment,
    createSessionShare,
    createTask,
    deleteSession,
    deleteSessionShare,
    diagnostics,
    error,
    feedback,
    loading,
    members,
    messages,
    replySharedSessionPermission,
    replySharedQuestion,
    runtimeTaskGroups,
    runtimeTasks,
    runtimeTaskRecords: sortTasks(mapRuntimeTasksToTeamTasks(runtimeTasks)),
    runtimeTasksLoading,
    selectedSharedSession,
    selectedSharedSessionId,
    refresh,
    sessionShares,
    sharedCommentBusy,
    sharedOperateBusy,
    sharedOperateError,
    sharedPresenceError,
    sharedPresenceLastSyncedAt,
    sharedPresenceNextRetryAt,
    sharedSessionLoading,
    sharedSessions,
    sessions,
    setSelectedSharedSessionId,
    tasks,
    toggleSessionState,
    updateSessionShare,
    updateTask,
  };
}
