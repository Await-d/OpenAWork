import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type {
  CreateTeamSessionInput,
  SharedSessionDetailRecord,
  SharedSessionSummaryRecord,
  TeamClient,
  TeamMessageRecord,
  TeamRuntimeAlertControlRecord,
  TeamRuntimeSessionRecord,
  TeamWorkspaceDetail,
} from '@openAwork/web-client';
import { resolveAlwaysScopeSelection } from '@openAwork/shared-ui';
import type {
  TeamActionFeedback,
  useTeamCollaboration,
} from '../../hooks/use-team-collaboration.js';
import { buildTaskUpdateStatus } from './team-runtime-reference-formatters.js';
import type { TeamSessionCreationDraft } from './team-session-creation.types.js';
import type {
  TaskDraftInput,
  TeamRuntimeReferenceDataOptions,
} from './team-runtime-reference-types.js';
import type { AgentTeamsReviewCard } from './team-runtime-types.js';

export interface CreatedSessionInfo {
  id: string;
  title: string | null;
}

export interface TeamRuntimeReferenceActionsInput {
  accessToken: string | null;
  activeSharedSession: SharedSessionDetailRecord | null;
  activeWorkspace: TeamWorkspaceDetail | null;
  collaboration: ReturnType<typeof useTeamCollaboration>;
  effectiveSessions: TeamRuntimeSessionRecord[];
  effectiveSharedSessions: SharedSessionSummaryRecord[];
  options: TeamRuntimeReferenceDataOptions;
  selectedRuntimeScopeSessionId: string | null;
  setCreatedSessionInfo: Dispatch<SetStateAction<CreatedSessionInfo | null>>;
  setLocalFeedback: Dispatch<SetStateAction<TeamActionFeedback | null>>;
  setSessionActionBusy: Dispatch<SetStateAction<boolean>>;
  teamClient: TeamClient;
}

export function useTeamRuntimeReferenceActions(input: TeamRuntimeReferenceActionsInput) {
  const {
    accessToken,
    activeSharedSession,
    activeWorkspace,
    collaboration,
    effectiveSessions,
    effectiveSharedSessions,
    options,
    selectedRuntimeScopeSessionId,
    setCreatedSessionInfo,
    setLocalFeedback,
    setSessionActionBusy,
    teamClient,
  } = input;

  const selectTeam = useCallback(
    (teamId: string) => {
      const isSharedSession = effectiveSharedSessions.some(
        (session) => session.sessionId === teamId,
      );
      const isSession = effectiveSessions.some((session) => session.id === teamId);
      if (!isSharedSession && !isSession) {
        return;
      }
      collaboration.setSelectedSharedSessionId(isSharedSession ? teamId : null);
    },
    [collaboration.setSelectedSharedSessionId, effectiveSessions, effectiveSharedSessions],
  );

  const sendMessage = useCallback(
    async (input: {
      content: string;
      recipientMemberId?: string | null;
      replyToMessageId?: string | null;
      sessionId?: string | null;
      type?: TeamMessageRecord['type'];
    }) => {
      const content = input.content.trim();
      if (!content) {
        return false;
      }

      return collaboration.createMessage({
        content,
        recipientMemberId: input.recipientMemberId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        senderId: collaboration.members[0]?.id,
        sessionId: input.sessionId ?? selectedRuntimeScopeSessionId,
        type: input.type ?? 'update',
      });
    },
    [collaboration.createMessage, collaboration.members, selectedRuntimeScopeSessionId],
  );

  const createSession = useCallback(
    async (draft: TeamSessionCreationDraft) => {
      const targetWorkspace =
        options.workspaces?.find((ws) => ws.id === draft.teamWorkspaceId) ??
        activeWorkspace ??
        options.workspaces?.[0] ??
        null;
      if (!accessToken || !targetWorkspace) {
        setLocalFeedback({
          message: '当前工作区不可用，无法创建团队会话',
          tone: 'error',
        });
        return null;
      }

      const payload: CreateTeamSessionInput = {
        ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
        source: { kind: draft.source.kind },
        memberSlots: draft.memberSlots,
        optionalAgentIds: draft.optionalAgentIds,
        defaultProvider: draft.defaultProvider,
        workingDirectory: draft.workingDirectory,
      };
      if (draft.source.kind === 'saved-template' && draft.source.templateId) {
        payload.source = {
          kind: 'saved-template',
          templateId: draft.source.templateId,
        };
      }

      setSessionActionBusy(true);
      try {
        const session = await teamClient.createSession(accessToken, targetWorkspace.id, payload);
        if (!session.id) {
          setLocalFeedback({
            message: '创建团队会话失败，请稍后重试',
            tone: 'error',
          });
          return null;
        }
        setCreatedSessionInfo({
          id: session.id,
          title: session.title ?? (draft.title.trim() || null),
        });
        const refreshed = await collaboration.refresh();
        setLocalFeedback({
          message: refreshed
            ? '已创建团队会话'
            : '已创建团队会话，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return session.id;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '创建团队会话失败',
          tone: 'error',
        });
        return null;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, activeWorkspace, collaboration, options.workspaces, teamClient],
  );

  const createWorkspace = useCallback(
    async (input: { name: string; description?: string; defaultWorkingRoot?: string }) => {
      if (!accessToken) {
        setLocalFeedback({
          message: '当前未连接到网关，无法创建工作区',
          tone: 'error',
        });
        return null;
      }

      setSessionActionBusy(true);
      try {
        const created = await teamClient.createWorkspace(accessToken, {
          name: input.name,
          description: input.description ?? null,
          defaultWorkingRoot: input.defaultWorkingRoot ?? null,
        });
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已创建工作区'
            : '已创建工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return created.id;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '创建工作区失败',
          tone: 'error',
        });
        return null;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!accessToken || !workspaceId || !name.trim()) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        await teamClient.updateWorkspace(accessToken, workspaceId, { name: name.trim() });
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已重命名工作区'
            : '已重命名工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '重命名工作区失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const deleteWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!accessToken || !workspaceId) {
        setLocalFeedback({
          message: '当前工作区不可用，无法删除',
          tone: 'error',
        });
        return false;
      }
      setSessionActionBusy(true);
      try {
        await teamClient.deleteWorkspace(accessToken, workspaceId);
        const refreshed = await collaboration.refresh();
        options.onWorkspacesChanged?.();
        setLocalFeedback({
          message: refreshed
            ? '已删除工作区'
            : '已删除工作区，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '删除工作区失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.onWorkspacesChanged, teamClient],
  );

  const createTask = useCallback(
    async (input: TaskDraftInput) => {
      if (!input.title.trim()) {
        return false;
      }

      return collaboration.createTask({
        assigneeId: collaboration.members[0]?.id,
        priority: input.priority,
        status:
          input.status === 'completed'
            ? 'done'
            : input.status === 'in_progress'
              ? 'in_progress'
              : 'pending',
        title: input.title.trim(),
      });
    },
    [collaboration.createTask, collaboration.members],
  );

  const acknowledgeRuntimeAlert = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      note?: string,
      callOptions?: { sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.acknowledgeRuntimeAlert(accessToken, alertCode, {
          ...(note ? { note } : {}),
          ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已确认当前告警'
            : '已确认当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '确认告警失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const clearRuntimeAlertControl = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      callOptions?: { sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.clearRuntimeAlertControl(accessToken, alertCode, {
          ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已清除告警控制'
            : '已清除告警控制，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '清除告警控制失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const suppressRuntimeAlert = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      input?: { minutes?: number; note?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.suppressRuntimeAlert(accessToken, alertCode, {
          ...input,
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已静音当前告警'
            : '已静音当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '静音告警失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, teamClient],
  );

  const reconcileStaleRuntimeThreads = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    setSessionActionBusy(true);
    try {
      const result = await teamClient.reconcileStaleRuntimeThreads(accessToken, {
        ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
      });
      const refreshed = await collaboration.refresh();
      if (!refreshed && result.runtime?.diagnostics) {
        collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
      }
      setLocalFeedback({
        message: refreshed
          ? '已发起线程修复'
          : '已发起线程修复，但最新运行时快照暂未刷新，系统会自动重试。',
        tone: 'success',
      });
      return true;
    } catch (reason) {
      setLocalFeedback({
        message: reason instanceof Error ? reason.message : '线程修复失败',
        tone: 'error',
      });
      return false;
    } finally {
      setSessionActionBusy(false);
    }
  }, [accessToken, collaboration, options.teamWorkspaceId, teamClient]);

  const reconcileStaleDecisions = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    setSessionActionBusy(true);
    try {
      const result = await teamClient.reconcileStaleDecisions(accessToken, {
        ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
      });
      const refreshed = await collaboration.refresh();
      if (!refreshed && result.runtime?.diagnostics) {
        collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
      }
      setLocalFeedback({
        message: refreshed
          ? '已释放超时交互'
          : '已释放超时交互，但最新运行时快照暂未刷新，系统会自动重试。',
        tone: 'success',
      });
      return true;
    } catch (reason) {
      setLocalFeedback({
        message: reason instanceof Error ? reason.message : '释放超时交互失败',
        tone: 'error',
      });
      return false;
    } finally {
      setSessionActionBusy(false);
    }
  }, [accessToken, collaboration, options.teamWorkspaceId, teamClient]);

  const runRuntimeAlertRemediation = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      remediationOptions?: { force?: boolean; handoffId?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      setSessionActionBusy(true);
      try {
        const result = await teamClient.runRuntimeAlertRemediation(accessToken, alertCode, {
          ...(remediationOptions?.force ? { force: remediationOptions.force } : {}),
          ...(remediationOptions?.handoffId ? { handoffId: remediationOptions.handoffId } : {}),
          ...(remediationOptions?.sessionId ? { sessionId: remediationOptions.sessionId } : {}),
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await collaboration.refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          collaboration.applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已触发运行修复'
            : '已触发运行修复，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      } catch (reason) {
        setLocalFeedback({
          message: reason instanceof Error ? reason.message : '运行修复失败',
          tone: 'error',
        });
        return false;
      } finally {
        setSessionActionBusy(false);
      }
    },
    [accessToken, collaboration, options.teamWorkspaceId, teamClient],
  );

  const moveTask = useCallback(
    async (taskId: string, direction: 'left' | 'right') => {
      const currentTask = collaboration.tasks.find((task) => task.id === taskId);
      if (!currentTask) {
        return false;
      }

      const nextStatus = buildTaskUpdateStatus(currentTask.status, direction);
      if (!nextStatus) {
        return false;
      }

      return collaboration.updateTask(taskId, { status: nextStatus });
    },
    [collaboration.tasks, collaboration.updateTask],
  );

  const replyReview = useCallback(
    async (cardId: string, status: AgentTeamsReviewCard['status']) => {
      const sessionId = activeSharedSession?.share.sessionId;
      if (!sessionId || (status !== 'approved' && status !== 'rejected')) {
        return false;
      }

      const permissionRequest = activeSharedSession?.pendingPermissions.find(
        (request) => `permission-${request.requestId}` === cardId,
      );
      if (permissionRequest) {
        const { selectedLevel: scopeLevel } = resolveAlwaysScopeSelection(
          permissionRequest.previewAction,
          permissionRequest.scope,
          permissionRequest.always,
        );
        return collaboration.replySharedSessionPermission(sessionId, {
          ...(status === 'approved' && scopeLevel ? { alwaysOverride: [scopeLevel.pattern] } : {}),
          decision: status === 'approved' ? 'session' : 'reject',
          requestId: permissionRequest.requestId,
        });
      }

      const questionRequest = activeSharedSession?.pendingQuestions.find(
        (request) => `question-${request.requestId}` === cardId,
      );
      if (questionRequest) {
        return collaboration.replySharedQuestion(sessionId, {
          answers: status === 'approved' ? [['已在 Team 页面完成处理。']] : undefined,
          requestId: questionRequest.requestId,
          status: status === 'approved' ? 'answered' : 'dismissed',
        });
      }

      return false;
    },
    [
      activeSharedSession,
      collaboration.replySharedSessionPermission,
      collaboration.replySharedQuestion,
    ],
  );

  const submitReviewComment = useCallback(
    async (cardId: string, content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return collaboration.createSharedSessionComment(sessionId, {
        content: `[${cardId}] ${trimmed}`,
      });
    },
    [activeSharedSession, collaboration.createSharedSessionComment],
  );

  const createSharedSessionComment = useCallback(
    async (content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return collaboration.createSharedSessionComment(sessionId, {
        content: trimmed,
      });
    },
    [activeSharedSession, collaboration.createSharedSessionComment],
  );

  return {
    acknowledgeRuntimeAlert,
    clearRuntimeAlertControl,
    createSession,
    createSharedSessionComment,
    createTask,
    createWorkspace,
    deleteWorkspace,
    moveTask,
    reconcileStaleDecisions,
    reconcileStaleRuntimeThreads,
    renameWorkspace,
    replyReview,
    runRuntimeAlertRemediation,
    selectTeam,
    sendMessage,
    submitReviewComment,
    suppressRuntimeAlert,
  };
}
