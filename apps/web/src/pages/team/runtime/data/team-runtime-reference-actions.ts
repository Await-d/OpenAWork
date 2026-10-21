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

/**
 * 统一的「busy + try/catch/finally」团队会话动作包装。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句、也不支持
 * try 内的值块（条件 / 逻辑 / 三元），本文件 10 处 try/catch/finally 会让整个 hook
 * 脱靶（实测 10 处同一诊断）。语义逐字照搬：`run` 的全流程仍在 try 内，catch 只做
 * 错误文案映射，finally 无条件清 busy；成功返回 `run` 的值、失败返回 `failureValue`
 * ——与原写法「catch 里 return X」完全一致。
 */
async function runTeamSessionActionOnce<T>(ctx: {
  setSessionActionBusy: (busy: boolean) => void;
  setLocalFeedback: (feedback: TeamActionFeedback) => void;
  /** catch 的兜底文案（`reason.message` 优先）。 */
  failureMessage: string;
  /** catch 时的返回值（按原样给出：null / false）。 */
  failureValue: T;
  run: () => Promise<T>;
}): Promise<T> {
  ctx.setSessionActionBusy(true);
  try {
    return await ctx.run();
  } catch (reason) {
    ctx.setLocalFeedback({
      message: reason instanceof Error ? reason.message : ctx.failureMessage,
      tone: 'error',
    });
    return ctx.failureValue;
  } finally {
    ctx.setSessionActionBusy(false);
  }
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

  // 把 collaboration 上的成员全部取成局部量：`collaboration.xxx(...)` 这种「hook 返回
  // 对象上的方法 / 属性访问」会让编译器把依赖推断成整个 collaboration 对象，与源码里
  // 写的具体字段不匹配 → "Existing memoization could not be preserved"、整个 hook 退出
  // 优化。取局部量后 body 与 deps 都用它，推断与源码一致（AGENTS.md「PreserveManualMemo」①）。
  // `createTask` 解构后要与下方同名 useCallback 区分，故取别名。
  const {
    applyRuntimeDiagnosticsPreview,
    createMessage,
    createSharedSessionComment: createSharedSessionCommentAction,
    createTask: createTeamTask,
    members,
    refresh,
    replySharedQuestion,
    replySharedSessionPermission,
    setSelectedSharedSessionId,
    tasks,
    updateTask,
  } = collaboration;
  // 同 ①：`options.onWorkspacesChanged?.()` 这种「对象上的可选方法调用」会让编译器把
  // 依赖推断成整个 options 对象，与源码写的 `options.onWorkspacesChanged` 不匹配。
  const { onWorkspacesChanged } = options;

  const selectTeam = useCallback(
    (teamId: string) => {
      const isSharedSession = effectiveSharedSessions.some(
        (session) => session.sessionId === teamId,
      );
      const isSession = effectiveSessions.some((session) => session.id === teamId);
      if (!isSharedSession && !isSession) {
        return;
      }
      setSelectedSharedSessionId(isSharedSession ? teamId : null);
    },
    [setSelectedSharedSessionId, effectiveSessions, effectiveSharedSessions],
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

      return createMessage({
        content,
        recipientMemberId: input.recipientMemberId ?? null,
        replyToMessageId: input.replyToMessageId ?? null,
        senderId: members[0]?.id,
        sessionId: input.sessionId ?? selectedRuntimeScopeSessionId,
        type: input.type ?? 'update',
      });
    },
    [createMessage, members, selectedRuntimeScopeSessionId],
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

      // 含 try/catch/finally 的动作体已下沉到模块级 `runTeamSessionActionOnce`（见其注释）。
      return runTeamSessionActionOnce<string | null>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '创建团队会话失败',
        failureValue: null,
        run: async () => {
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
          const refreshed = await refresh();
          setLocalFeedback({
            message: refreshed
              ? '已创建团队会话'
              : '已创建团队会话，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return session.id;
        },
      });
    },
    // run 回调里用到 setLocalFeedback / setCreatedSessionInfo，必须列入依赖
    // （AGENTS.md「PreserveManualMemo」②：setter 身份稳定，补上不改变触发节奏）。
    [
      accessToken,
      activeWorkspace,
      options.workspaces,
      refresh,
      setCreatedSessionInfo,
      setLocalFeedback,
      setSessionActionBusy,
      teamClient,
    ],
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

      return runTeamSessionActionOnce<string | null>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '创建工作区失败',
        failureValue: null,
        run: async () => {
          const created = await teamClient.createWorkspace(accessToken, {
            name: input.name,
            description: input.description ?? null,
            defaultWorkingRoot: input.defaultWorkingRoot ?? null,
          });
          const refreshed = await refresh();
          onWorkspacesChanged?.();
          setLocalFeedback({
            message: refreshed
              ? '已创建工作区'
              : '已创建工作区，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return created.id;
        },
      });
    },
    [accessToken, onWorkspacesChanged, refresh, setLocalFeedback, setSessionActionBusy, teamClient],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string) => {
      if (!accessToken || !workspaceId || !name.trim()) {
        return false;
      }
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '重命名工作区失败',
        failureValue: false,
        run: async () => {
          await teamClient.updateWorkspace(accessToken, workspaceId, { name: name.trim() });
          const refreshed = await refresh();
          onWorkspacesChanged?.();
          setLocalFeedback({
            message: refreshed
              ? '已重命名工作区'
              : '已重命名工作区，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [accessToken, onWorkspacesChanged, refresh, setLocalFeedback, setSessionActionBusy, teamClient],
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
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '删除工作区失败',
        failureValue: false,
        run: async () => {
          await teamClient.deleteWorkspace(accessToken, workspaceId);
          const refreshed = await refresh();
          onWorkspacesChanged?.();
          setLocalFeedback({
            message: refreshed
              ? '已删除工作区'
              : '已删除工作区，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [accessToken, onWorkspacesChanged, refresh, setLocalFeedback, setSessionActionBusy, teamClient],
  );

  const createTask = useCallback(
    async (input: TaskDraftInput) => {
      if (!input.title.trim()) {
        return false;
      }

      return createTeamTask({
        assigneeId: members[0]?.id,
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
    [createTeamTask, members],
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
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '确认告警失败',
        failureValue: false,
        run: async () => {
          const result = await teamClient.acknowledgeRuntimeAlert(accessToken, alertCode, {
            ...(note ? { note } : {}),
            ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
            ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
          });
          const refreshed = await refresh();
          if (!refreshed && result.runtime?.diagnostics) {
            applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
          }
          setLocalFeedback({
            message: refreshed
              ? '已确认当前告警'
              : '已确认当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [
      accessToken,
      applyRuntimeDiagnosticsPreview,
      options.teamWorkspaceId,
      refresh,
      setLocalFeedback,
      setSessionActionBusy,
      teamClient,
    ],
  );

  const clearRuntimeAlertControl = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      callOptions?: { sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '清除告警控制失败',
        failureValue: false,
        run: async () => {
          const result = await teamClient.clearRuntimeAlertControl(accessToken, alertCode, {
            ...(callOptions?.sessionId ? { sessionId: callOptions.sessionId } : {}),
            ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
          });
          const refreshed = await refresh();
          if (!refreshed && result.runtime?.diagnostics) {
            applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
          }
          setLocalFeedback({
            message: refreshed
              ? '已清除告警控制'
              : '已清除告警控制，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [
      accessToken,
      applyRuntimeDiagnosticsPreview,
      options.teamWorkspaceId,
      refresh,
      setLocalFeedback,
      setSessionActionBusy,
      teamClient,
    ],
  );

  const suppressRuntimeAlert = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      input?: { minutes?: number; note?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '静音告警失败',
        failureValue: false,
        run: async () => {
          const result = await teamClient.suppressRuntimeAlert(accessToken, alertCode, {
            ...input,
            ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
          });
          const refreshed = await refresh();
          if (!refreshed && result.runtime?.diagnostics) {
            applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
          }
          setLocalFeedback({
            message: refreshed
              ? '已静音当前告警'
              : '已静音当前告警，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [
      accessToken,
      applyRuntimeDiagnosticsPreview,
      options.teamWorkspaceId,
      refresh,
      setLocalFeedback,
      setSessionActionBusy,
      teamClient,
    ],
  );

  const reconcileStaleRuntimeThreads = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    return runTeamSessionActionOnce<boolean>({
      setSessionActionBusy,
      setLocalFeedback,
      failureMessage: '线程修复失败',
      failureValue: false,
      run: async () => {
        const result = await teamClient.reconcileStaleRuntimeThreads(accessToken, {
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已发起线程修复'
            : '已发起线程修复，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      },
    });
  }, [
    accessToken,
    applyRuntimeDiagnosticsPreview,
    options.teamWorkspaceId,
    refresh,
    setLocalFeedback,
    setSessionActionBusy,
    teamClient,
  ]);

  const reconcileStaleDecisions = useCallback(async () => {
    if (!accessToken) {
      return false;
    }
    return runTeamSessionActionOnce<boolean>({
      setSessionActionBusy,
      setLocalFeedback,
      failureMessage: '释放超时交互失败',
      failureValue: false,
      run: async () => {
        const result = await teamClient.reconcileStaleDecisions(accessToken, {
          ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
        });
        const refreshed = await refresh();
        if (!refreshed && result.runtime?.diagnostics) {
          applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
        }
        setLocalFeedback({
          message: refreshed
            ? '已释放超时交互'
            : '已释放超时交互，但最新运行时快照暂未刷新，系统会自动重试。',
          tone: 'success',
        });
        return true;
      },
    });
  }, [
    accessToken,
    applyRuntimeDiagnosticsPreview,
    options.teamWorkspaceId,
    refresh,
    setLocalFeedback,
    setSessionActionBusy,
    teamClient,
  ]);

  const runRuntimeAlertRemediation = useCallback(
    async (
      alertCode: TeamRuntimeAlertControlRecord['alertCode'],
      remediationOptions?: { force?: boolean; handoffId?: string; sessionId?: string },
    ) => {
      if (!accessToken) {
        return false;
      }
      return runTeamSessionActionOnce<boolean>({
        setSessionActionBusy,
        setLocalFeedback,
        failureMessage: '运行修复失败',
        failureValue: false,
        run: async () => {
          const result = await teamClient.runRuntimeAlertRemediation(accessToken, alertCode, {
            ...(remediationOptions?.force ? { force: remediationOptions.force } : {}),
            ...(remediationOptions?.handoffId ? { handoffId: remediationOptions.handoffId } : {}),
            ...(remediationOptions?.sessionId ? { sessionId: remediationOptions.sessionId } : {}),
            ...(options.teamWorkspaceId ? { teamWorkspaceId: options.teamWorkspaceId } : {}),
          });
          const refreshed = await refresh();
          if (!refreshed && result.runtime?.diagnostics) {
            applyRuntimeDiagnosticsPreview(result.runtime.diagnostics);
          }
          setLocalFeedback({
            message: refreshed
              ? '已触发运行修复'
              : '已触发运行修复，但最新运行时快照暂未刷新，系统会自动重试。',
            tone: 'success',
          });
          return true;
        },
      });
    },
    [
      accessToken,
      applyRuntimeDiagnosticsPreview,
      options.teamWorkspaceId,
      refresh,
      setLocalFeedback,
      setSessionActionBusy,
      teamClient,
    ],
  );

  const moveTask = useCallback(
    async (taskId: string, direction: 'left' | 'right') => {
      const currentTask = tasks.find((task) => task.id === taskId);
      if (!currentTask) {
        return false;
      }

      const nextStatus = buildTaskUpdateStatus(currentTask.status, direction);
      if (!nextStatus) {
        return false;
      }

      return updateTask(taskId, { status: nextStatus });
    },
    [tasks, updateTask],
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
        return replySharedSessionPermission(sessionId, {
          ...(status === 'approved' && scopeLevel ? { alwaysOverride: [scopeLevel.pattern] } : {}),
          decision: status === 'approved' ? 'session' : 'reject',
          requestId: permissionRequest.requestId,
        });
      }

      const questionRequest = activeSharedSession?.pendingQuestions.find(
        (request) => `question-${request.requestId}` === cardId,
      );
      if (questionRequest) {
        return replySharedQuestion(sessionId, {
          answers: status === 'approved' ? [['已在 Team 页面完成处理。']] : undefined,
          requestId: questionRequest.requestId,
          status: status === 'approved' ? 'answered' : 'dismissed',
        });
      }

      return false;
    },
    [activeSharedSession, replySharedQuestion, replySharedSessionPermission],
  );

  const submitReviewComment = useCallback(
    async (cardId: string, content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return createSharedSessionCommentAction(sessionId, {
        content: `[${cardId}] ${trimmed}`,
      });
    },
    [activeSharedSession, createSharedSessionCommentAction],
  );

  const createSharedSessionComment = useCallback(
    async (content: string) => {
      const sessionId = activeSharedSession?.share.sessionId;
      const trimmed = content.trim();
      if (!sessionId || !trimmed) {
        return false;
      }
      return createSharedSessionCommentAction(sessionId, {
        content: trimmed,
      });
    },
    [activeSharedSession, createSharedSessionCommentAction],
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
