import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createTeamClient,
  type CreateTeamMemberInput,
  type CreateTeamMessageInput,
  type CreateTeamSessionShareInput,
  type CreateTeamTaskInput,
  type SharedSessionDetailRecord,
  type SharedSessionSummaryRecord,
  type TeamAuditLogRecord,
  type TeamMemberRecord,
  type TeamMessageRecord,
  type TeamRuntimeReadModel,
  type TeamSessionShareRecord,
  type TeamTaskRecord,
  type UpdateTeamTaskInput,
} from '@openAwork/web-client';
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';

interface TeamSnapshot extends TeamRuntimeReadModel {}

export interface TeamActionFeedback {
  message: string;
  tone: 'error' | 'success';
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

export function useTeamCollaboration() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [auditLogs, setAuditLogs] = useState<TeamAuditLogRecord[]>([]);
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
      title: string | null;
      updatedAt: string;
      workspacePath: string | null;
    }>
  >([]);
  const [selectedSharedSessionId, setSelectedSharedSessionId] = useState<string | null>(null);
  const [selectedSharedSession, setSelectedSharedSession] =
    useState<SharedSessionDetailRecord | null>(null);
  const [sharedCommentBusy, setSharedCommentBusy] = useState(false);
  const [sharedOperateBusy, setSharedOperateBusy] = useState(false);
  const [sharedOperateError, setSharedOperateError] = useState<string | null>(null);
  const [sharedSessionLoading, setSharedSessionLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<TeamActionFeedback | null>(null);
  const selectedSharedSessionIdRef = useRef<string | null>(null);

  const client = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const sessionsClient = useMemo(() => createSessionsClient(gatewayUrl), [gatewayUrl]);

  useEffect(() => {
    selectedSharedSessionIdRef.current = selectedSharedSessionId;
  }, [selectedSharedSessionId]);

  const commitSelectedSharedSessionIfCurrent = useCallback(
    (sessionId: string, detail: SharedSessionDetailRecord | null) => {
      if (selectedSharedSessionIdRef.current !== sessionId) {
        return;
      }
      setSelectedSharedSession(detail);
    },
    [],
  );

  const loadSelectedSharedSessionDetail = useCallback(
    async (sessionId: string) => {
      if (!accessToken) {
        return null;
      }
      return sessionsClient.getSharedWithMe(accessToken, sessionId);
    },
    [accessToken, sessionsClient],
  );

  const loadSnapshot = useCallback(async (): Promise<TeamSnapshot> => {
    if (!accessToken) {
      return {
        auditLogs: [],
        members: [],
        messages: [],
        sessionShares: [],
        sharedSessions: [],
        sessions: [],
        tasks: [],
      };
    }

    const runtime = await client.getRuntime(accessToken);

    return {
      auditLogs: sortAuditLogs(runtime.auditLogs),
      members: sortMembers(runtime.members),
      messages: sortMessages(runtime.messages),
      sessionShares: sortSessionShares(runtime.sessionShares),
      sharedSessions: sortSharedSessions(runtime.sharedSessions),
      sessions: runtime.sessions,
      tasks: sortTasks(runtime.tasks),
    };
  }, [accessToken, client]);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setAuditLogs([]);
      setMembers([]);
      setTasks([]);
      setMessages([]);
      setSessionShares([]);
      setSharedSessions([]);
      setSessions([]);
      setSelectedSharedSessionId(null);
      setSelectedSharedSession(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadSnapshot();
      setAuditLogs(snapshot.auditLogs);
      setMembers(snapshot.members);
      setTasks(snapshot.tasks);
      setMessages(snapshot.messages);
      setSessionShares(snapshot.sessionShares);
      setSharedSessions(snapshot.sharedSessions);
      setSessions(snapshot.sessions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载团队协作数据失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, loadSnapshot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runMutation = useCallback(
    async (action: () => Promise<void>, successMessage: string) => {
      setBusy(true);
      setError(null);
      setFeedback(null);
      try {
        await action();
        const snapshot = await loadSnapshot();
        setAuditLogs(snapshot.auditLogs);
        setMembers(snapshot.members);
        setTasks(snapshot.tasks);
        setMessages(snapshot.messages);
        setSessionShares(snapshot.sessionShares);
        setSharedSessions(snapshot.sharedSessions);
        setSessions(snapshot.sessions);
        setFeedback({ message: successMessage, tone: 'success' });
        return true;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '团队协作操作失败';
        setError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [loadSnapshot],
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
      setSelectedSharedSession(null);
      setSharedSessionLoading(false);
      setSharedOperateError(null);
      return;
    }

    let cancelled = false;
    setSelectedSharedSession(null);
    setSharedSessionLoading(true);
    loadSelectedSharedSessionDetail(selectedSharedSessionId)
      .then(async (detail) => {
        if (!detail) {
          return;
        }

        let nextDetail = detail;
        try {
          const presence = await sessionsClient.touchSharedPresence(
            accessToken,
            selectedSharedSessionId,
          );
          nextDetail = { ...detail, presence };
        } catch (_error) {
          nextDetail = detail;
        }

        if (!cancelled) {
          commitSelectedSharedSessionIfCurrent(selectedSharedSessionId, nextDetail);
          setSharedOperateError(null);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          const message = reason instanceof Error ? reason.message : '加载共享会话失败';
          setError(message);
          commitSelectedSharedSessionIfCurrent(selectedSharedSessionId, null);
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
    sessionsClient,
  ]);

  useEffect(() => {
    if (!accessToken || !selectedSharedSessionId) {
      return;
    }

    let cancelled = false;
    const syncPresence = async () => {
      try {
        const presence = await sessionsClient.touchSharedPresence(
          accessToken,
          selectedSharedSessionId,
        );
        if (!cancelled) {
          setSelectedSharedSession((current) =>
            current && current.share.sessionId === selectedSharedSessionId
              ? { ...current, presence }
              : current,
          );
        }
      } catch (_error) {
        return;
      }
    };

    void syncPresence();
    const intervalId = window.setInterval(() => {
      void syncPresence();
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [accessToken, selectedSharedSessionId, sessionsClient]);

  const createSharedSessionComment = useCallback(
    async (sessionId: string, input: { content: string }) => {
      if (!accessToken) {
        return false;
      }

      setSharedCommentBusy(true);
      setError(null);
      setFeedback(null);
      try {
        await sessionsClient.createSharedComment(accessToken, sessionId, input);
        const refreshedDetail = await loadSelectedSharedSessionDetail(sessionId);
        commitSelectedSharedSessionIfCurrent(sessionId, refreshedDetail);
        const snapshot = await loadSnapshot();
        setAuditLogs(snapshot.auditLogs);
        setSharedSessions(snapshot.sharedSessions);
        setFeedback({ message: '已发送共享评论', tone: 'success' });
        return true;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '发送共享评论失败';
        setError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedCommentBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      loadSelectedSharedSessionDetail,
      loadSnapshot,
      sessionsClient,
    ],
  );

  const replySharedPermission = useCallback(
    async (
      sessionId: string,
      input: { decision: 'once' | 'session' | 'permanent' | 'reject'; requestId: string },
    ) => {
      if (!accessToken) {
        return false;
      }

      setSharedOperateBusy(true);
      setSharedOperateError(null);
      setFeedback(null);
      try {
        await sessionsClient.replySharedPermission(accessToken, sessionId, input);
        const refreshedDetail = await loadSelectedSharedSessionDetail(sessionId);
        commitSelectedSharedSessionIfCurrent(sessionId, refreshedDetail);
        const snapshot = await loadSnapshot();
        setAuditLogs(snapshot.auditLogs);
        setSharedSessions(snapshot.sharedSessions);
        setFeedback({ message: '已处理共享权限请求', tone: 'success' });
        return true;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '处理共享权限请求失败';
        setSharedOperateError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedOperateBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      loadSelectedSharedSessionDetail,
      loadSnapshot,
      sessionsClient,
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
      setSharedOperateError(null);
      setFeedback(null);
      try {
        await sessionsClient.replySharedQuestion(accessToken, sessionId, input);
        const refreshedDetail = await loadSelectedSharedSessionDetail(sessionId);
        commitSelectedSharedSessionIfCurrent(sessionId, refreshedDetail);
        const snapshot = await loadSnapshot();
        setAuditLogs(snapshot.auditLogs);
        setSharedSessions(snapshot.sharedSessions);
        setFeedback({ message: '已处理共享提问', tone: 'success' });
        return true;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : '处理共享提问失败';
        setSharedOperateError(message);
        setFeedback({ message, tone: 'error' });
        return false;
      } finally {
        setSharedOperateBusy(false);
      }
    },
    [
      accessToken,
      commitSelectedSharedSessionIfCurrent,
      loadSelectedSharedSessionDetail,
      loadSnapshot,
      sessionsClient,
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

  return {
    auditLogs,
    busy,
    createMember,
    createMessage,
    createSharedSessionComment,
    createSessionShare,
    createTask,
    deleteSessionShare,
    error,
    feedback,
    loading,
    members,
    messages,
    replySharedPermission,
    replySharedQuestion,
    selectedSharedSession,
    selectedSharedSessionId,
    refresh,
    sessionShares,
    sharedCommentBusy,
    sharedOperateBusy,
    sharedOperateError,
    sharedSessionLoading,
    sharedSessions,
    sessions,
    setSelectedSharedSessionId,
    tasks,
    updateSessionShare,
    updateTask,
  };
}
