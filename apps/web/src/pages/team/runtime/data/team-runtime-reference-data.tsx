import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { TeamRuntimeAlertControlRecord, TeamMessageRecord } from '@openAwork/web-client';
import { createTeamClient } from '@openAwork/web-client';
import { categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type { CreateTeamSessionInput, SessionTask } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import { useTeamCollaboration } from '../../hooks/use-team-collaboration.js';
import type { TeamActionFeedback } from '../../hooks/use-team-collaboration.js';
import {
  type AgentTeamsMetricCard,
  type AgentTeamsOverviewCard,
  type AgentTeamsReviewCard,
  type AgentTeamsRoleChip,
  type AgentTeamsTaskLane,
} from './team-runtime-types.js';
import { collectRuntimeTasksForSession, mapTaskToLaneId, resolveTaskRecordsForView } from './team-runtime-task-lanes.js';
import { collectSessionScope } from './team-runtime-session-scope.js';
import { scopeTeamRuntimeOverviewData } from './team-runtime-overview-scope.js';
import {
  resolveActiveSharedSession,
  resolveSelectedSharedSummary,
} from './team-runtime-shared-context.js';
import { resolveSelectedRuntimeScopeSessionId } from './team-runtime-selection-context.js';
import {
  buildFooterLead,
  buildFooterStats,
  buildMetricCards,
} from './team-runtime-summary-metrics.js';
import {
  resolveTopSummaryAudience,
  resolveTopSummaryDescription,
  resolveTopSummaryStatus,
  resolveTopSummaryTitle,
} from './team-runtime-top-summary.js';
import { useTeamRuntimeProjection } from '../hooks/use-team-runtime-projection.js';
import { useTeamRuntimeRoleBindings } from '../hooks/use-team-runtime-role-bindings.js';
import { useTeamWorkflowTemplates } from '../hooks/use-team-workflow-templates.js';
import { useHandoffStore } from '../../../../stores/team/team-events.js';
import type { TeamSessionCreationDraft } from './team-session-creation.types.js';
import { EMPTY_VIEW_DATA } from './team-runtime-reference-empty.js';
import type {
  TaskDraftInput,
  TeamRuntimeReferenceDataOptions,
  TeamRuntimeReferenceViewData,
} from './team-runtime-reference-types.js';
import { ROLE_SLOT_CONFIG } from './team-runtime-reference-config.js';
import {
  buildTaskUpdateStatus,
  formatWorkspaceLabel,
  mapMemberStatusLabel,
} from './team-runtime-reference-formatters.js';
import {
  buildConversationCardsProjection,
  buildMessageCardsProjection,
  buildOfficeAgentsProjection,
  buildOverviewCardsProjection,
  buildReviewCardsProjection,
  buildRuntimeActivityProjection,
  buildTimelineProjection,
  buildWorkspaceGroupsProjection,
} from './team-runtime-reference-projections.js';
import {
  resolveSessionTreeTeamRuntimeStatus,
  type TeamRuntimeSemanticStatus,
} from './team-runtime-status.js';

const TeamRuntimeReferenceDataContext = createContext<TeamRuntimeReferenceViewData | null>(null);

export function TeamRuntimeReferenceDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: TeamRuntimeReferenceViewData;
}) {
  return (
    <TeamRuntimeReferenceDataContext value={value}>{children}</TeamRuntimeReferenceDataContext>
  );
}

export function useTeamRuntimeReferenceViewData(): TeamRuntimeReferenceViewData {
  return useContext(TeamRuntimeReferenceDataContext) ?? EMPTY_VIEW_DATA;
}

export function useResolvedTeamRuntimeReferenceData(
  options: TeamRuntimeReferenceDataOptions = {},
): TeamRuntimeReferenceViewData {
  const activeWorkspace = options.activeWorkspace ?? null;
  const activeWorkspaceSnapshot = options.activeWorkspaceSnapshot ?? null;
  const selectedTeamId = options.selectedTeamId ?? null;
  const workspaceSnapshotError = options.workspaceSnapshotError ?? null;
  const workspaceSnapshotLoading = options.workspaceSnapshotLoading ?? false;
  const workspaceError = options.workspaceError ?? null;
  const workspaceLoading = options.workspaceLoading ?? false;
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const teamClient = useMemo(() => createTeamClient(gatewayUrl), [gatewayUrl]);
  const collaboration = useTeamCollaboration(options.teamWorkspaceId ?? undefined, {
    autoSelectSharedSession: false,
    enabled: options.collaborationEnabled ?? true,
  });
  const roleBindings = useTeamRuntimeRoleBindings();
  const workflowTemplates = useTeamWorkflowTemplates();
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<TeamActionFeedback | null>(null);
  // 新建 session 后立刻记住 id，让 defaultReceptionSessionId 能在 refresh 完成前就指向它
  const [createdSessionId, setCreatedSessionId] = useState<string | null>(null);
  const snapshotSharedSessions = activeWorkspaceSnapshot?.sharedSessions ?? [];
  const snapshotSessions = activeWorkspaceSnapshot?.sessions ?? [];
  const effectiveSessions = snapshotSessions.length > 0 ? snapshotSessions : collaboration.sessions;
  const effectiveSharedSessions =
    snapshotSharedSessions.length > 0 ? snapshotSharedSessions : collaboration.sharedSessions;

  useEffect(() => {
    if (!localFeedback || typeof window === 'undefined') {
      return;
    }
    const timer = window.setTimeout(() => {
      setLocalFeedback(null);
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [localFeedback]);

  // 真实执行流的 handoff（reception→pm1→pm2→executor…）。概览的"团队活动"指标
  // 必须基于它 + runtimeTasks + sessions，而不是 V1 的 team_messages/team_tasks
  // 手动协作表——后者在团队自动执行时根本不写入，导致概览长期显示 0（用了却统计不到）。
  const handoffsMap = useHandoffStore((state) => state.handoffs);
  const handoffEntries = useMemo(() => Array.from(handoffsMap.values()), [handoffsMap]);

  const selectedSharedSummary = useMemo(
    () =>
      resolveSelectedSharedSummary({
        selectedTeamId,
        snapshotSharedSessions,
        sharedSessions: collaboration.sharedSessions,
        selectedSharedSessionShare: collaboration.selectedSharedSession?.share ?? null,
        selectedSharedSessionId: collaboration.selectedSharedSessionId,
      }),
    [
      selectedTeamId,
      snapshotSharedSessions,
      collaboration.sharedSessions,
      collaboration.selectedSharedSession?.share,
      collaboration.selectedSharedSessionId,
    ],
  );

  const activeSharedSession = useMemo(
    () =>
      resolveActiveSharedSession({
        selectedTeamId,
        selectedSharedSession: collaboration.selectedSharedSession,
      }),
    [collaboration.selectedSharedSession, selectedTeamId],
  );

  const selectedRuntimeSession = useMemo(() => {
    return (
      (selectedTeamId != null
        ? effectiveSessions.find((session) => session.id === selectedTeamId)
        : null) ?? null
    );
  }, [effectiveSessions, selectedTeamId]);
  const selectedRuntimeScopeSessionId = useMemo(
    () =>
      resolveSelectedRuntimeScopeSessionId({
        selectedTeamId,
        sessions: effectiveSessions,
      }),
    [effectiveSessions, selectedTeamId],
  );

  const projection = useTeamRuntimeProjection({
    autoSelectSharedSession: false,
    auditLogs: collaboration.auditLogs,
    interactionRewriteArtifact: null,
    members: collaboration.members,
    messages: collaboration.messages,
    onSelectSharedSession: collaboration.setSelectedSharedSessionId,
    selectedSharedSession: activeSharedSession,
    selectedSharedSessionId: collaboration.selectedSharedSessionId,
    runtimeTaskGroups: collaboration.runtimeTaskGroups,
    sessionShares: collaboration.sessionShares,
    sessions: effectiveSessions,
    sharedSessions: effectiveSharedSessions,
    tasks: collaboration.tasks,
  });

  const hasAuth = Boolean(accessToken && gatewayUrl);

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
        return false;
      }

      // 把前端 draft 完整转成后端 createTeamSessionSchema 期望的 payload。
      // 注意：draft.source.kind 仅有 'blank' | 'saved-template'（向导未暴露
      // 'builtin-template'），后端 schema 兼容这两种。
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
        // 立刻把新建的 session 注入到 collaboration.sessions 中，
        // 避免等 refresh 完成前 defaultReceptionSessionId 为空导致对话区空白。
        // refresh 完成后会用完整数据覆盖这条临时记录。
        setCreatedSessionId(session.id);
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
        const scopeLevel = categorizeAlwaysPatterns(
          permissionRequest.previewAction,
          permissionRequest.scope,
          permissionRequest.always,
        ).at(-1);
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

  // --- Split memos: shared intermediates ---
  const roleChips = useMemo(
    () =>
      ROLE_SLOT_CONFIG.map((slot, index) => {
        const member = collaboration.members[index] ?? null;
        const binding = roleBindings.roleCards[index] ?? null;
        const boundAgent = binding?.selectedAgent ?? null;
        return {
          accent: slot.accent,
          badge:
            boundAgent?.label.slice(0, 1).toUpperCase() ??
            member?.name.slice(0, 1).toUpperCase() ??
            slot.badge,
          id: boundAgent?.id ?? member?.id ?? slot.id,
          leader: slot.leader || binding?.role === 'planner',
          provider:
            boundAgent?.label ?? boundAgent?.id ?? binding?.roleLabel ?? slot.fallbackProvider,
          role: boundAgent?.label ?? member?.name ?? slot.fallbackLabel,
          status: mapMemberStatusLabel(member?.status),
        } satisfies AgentTeamsRoleChip;
      }),
    [collaboration.members, roleBindings.roleCards],
  );

  const accentByMemberId = useMemo(() => {
    const map = new Map<string, string>();
    roleChips.forEach((chip, index) => {
      const memberId = collaboration.members[index]?.id;
      if (memberId) {
        map.set(memberId, chip.accent);
      }
    });
    return map;
  }, [collaboration.members, roleChips]);

  const memberNameById = useMemo(
    () => new Map(collaboration.members.map((member) => [member.id, member.name])),
    [collaboration.members],
  );

  const selectedSessionScope = useMemo(() => {
    return selectedRuntimeScopeSessionId
      ? collectSessionScope(selectedRuntimeScopeSessionId, effectiveSessions)
      : null;
  }, [effectiveSessions, selectedRuntimeScopeSessionId]);

  // runtimeTaskGroupsSource 优先用 workspace snapshot（更即时），回退到 collaboration。
  // 提前定义，供 scopedRuntimeTasksFromGroups 和 selectedRuntimeTaskRecords 共用。
  const runtimeTaskGroupsSource =
    activeWorkspaceSnapshot?.runtimeTaskGroups.length != null &&
    activeWorkspaceSnapshot.runtimeTaskGroups.length > 0
      ? activeWorkspaceSnapshot.runtimeTaskGroups
      : collaboration.runtimeTaskGroups;

  // 从 runtimeTaskGroups 按 session scope 提取全部相关任务。
  // collaboration.runtimeTasks 只在共享会话选中时才有数据（依赖 selectedSharedSessionId），
  // 选中运行时会话时为空——直接用它会导致 runtimeActivity 任务统计全为 0。
  // 这里用 collectRuntimeTasksForSession 按 session scope 提取，覆盖两种场景。
  // 使用 runtimeTaskGroupsSource 与 selectedRuntimeTaskRecords 保持同源。
  const scopedRuntimeTasksFromGroups = useMemo(
    () =>
      collectRuntimeTasksForSession(
        runtimeTaskGroupsSource,
        selectedRuntimeScopeSessionId,
        selectedSessionScope,
      ),
    [runtimeTaskGroupsSource, selectedRuntimeScopeSessionId, selectedSessionScope],
  );

  // 合并：优先用从 groups 按 scope 提取的任务（覆盖运行时会话场景），
  // 再补充 collaboration.runtimeTasks（共享会话场景下已按 selectedSharedSessionId 提取）。
  const effectiveRuntimeTasksForScope = useMemo(() => {
    const deduped = new Map<string, SessionTask>();
    for (const task of scopedRuntimeTasksFromGroups) {
      deduped.set(task.id, task);
    }
    for (const task of collaboration.runtimeTasks) {
      const existing = deduped.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        deduped.set(task.id, task);
      }
    }
    return Array.from(deduped.values());
  }, [collaboration.runtimeTasks, scopedRuntimeTasksFromGroups]);

  const scopedOverviewData = useMemo(
    () =>
      scopeTeamRuntimeOverviewData({
        selectedSessionId: selectedRuntimeScopeSessionId,
        handoffs: handoffEntries,
        runtimeTasks: effectiveRuntimeTasksForScope,
        sessions: effectiveSessions,
        messages: collaboration.messages,
        auditLogs: collaboration.auditLogs,
        sharedSessions: effectiveSharedSessions,
      }),
    [
      collaboration.auditLogs,
      collaboration.messages,
      effectiveRuntimeTasksForScope,
      effectiveSharedSessions,
      effectiveSessions,
      handoffEntries,
      selectedRuntimeScopeSessionId,
    ],
  );

  // 从 runtimeTaskGroups 展开全量任务列表（不按 session scope 过滤），
  // 供 runtimeSessionStatuses / sharedSessionStatuses 计算每个 session 的状态。
  // collaboration.runtimeTasks 只在共享会话选中时有数据，不能覆盖运行时会话场景。
  const allRuntimeTasksFromGroups = useMemo(
    () => {
      const deduped = new Map<string, SessionTask>();
      for (const group of runtimeTaskGroupsSource) {
        for (const task of group.tasks) {
          const existing = deduped.get(task.id);
          if (!existing || task.updatedAt > existing.updatedAt) {
            deduped.set(task.id, task);
          }
        }
      }
      return Array.from(deduped.values());
    },
    [runtimeTaskGroupsSource],
  );

  // 合并 groups 展开的任务和 collaboration.runtimeTasks，作为全量任务来源。
  const effectiveAllRuntimeTasks = useMemo(() => {
    const deduped = new Map<string, SessionTask>();
    for (const task of allRuntimeTasksFromGroups) {
      deduped.set(task.id, task);
    }
    for (const task of collaboration.runtimeTasks) {
      const existing = deduped.get(task.id);
      if (!existing || task.updatedAt > existing.updatedAt) {
        deduped.set(task.id, task);
      }
    }
    return Array.from(deduped.values());
  }, [allRuntimeTasksFromGroups, collaboration.runtimeTasks]);

  const runtimeSessionStatuses = useMemo(() => {
    const statuses = new Map<string, TeamRuntimeSemanticStatus>();
    for (const session of effectiveSessions) {
      statuses.set(
        session.id,
        resolveSessionTreeTeamRuntimeStatus({
          rootSessionId: session.id,
          paused: session.paused ?? false,
          stateStatus: session.stateStatus,
          sessions: effectiveSessions,
          handoffs: handoffEntries,
          runtimeTasks: effectiveAllRuntimeTasks,
        }),
      );
    }
    return statuses;
  }, [effectiveAllRuntimeTasks, effectiveSessions, handoffEntries]);

  const sharedSessionStatuses = useMemo(() => {
    const statuses = new Map<string, TeamRuntimeSemanticStatus>();
    for (const sharedSession of effectiveSharedSessions) {
      statuses.set(
        sharedSession.sessionId,
        resolveSessionTreeTeamRuntimeStatus({
          rootSessionId: sharedSession.sessionId,
          stateStatus: sharedSession.stateStatus,
          sessions: effectiveSessions,
          handoffs: handoffEntries,
          runtimeTasks: effectiveAllRuntimeTasks,
        }),
      );
    }
    return statuses;
  }, [effectiveAllRuntimeTasks, effectiveSharedSessions, effectiveSessions, handoffEntries]);

  const selectedRuntimeStatus = useMemo(
    () =>
      selectedRuntimeSession
        ? (runtimeSessionStatuses.get(selectedRuntimeSession.id) ?? 'idle')
        : null,
    [runtimeSessionStatuses, selectedRuntimeSession],
  );

  const selectedSharedStatus = useMemo(
    () =>
      selectedSharedSummary
        ? (sharedSessionStatuses.get(selectedSharedSummary.sessionId) ?? 'idle')
        : null,
    [selectedSharedSummary, sharedSessionStatuses],
  );

  const isSelectedTeamPaused =
    selectedSharedStatus === 'paused' || selectedRuntimeStatus === 'paused';

  const {
    workspaceGroups: effectiveWorkspaceGroups,
    runningTeams,
    historyTeams,
    defaultSelectedTeamId,
    defaultReceptionSessionId,
  } = useMemo(
    () =>
      buildWorkspaceGroupsProjection({
        activeWorkspaceDefaultWorkingRoot: activeWorkspace?.defaultWorkingRoot ?? null,
        createdSessionId,
        effectiveSharedSessions,
        effectiveSessions,
        runtimeSessionStatuses,
        sharedSessionStatuses,
        runtimeTasks: effectiveAllRuntimeTasks,
        selectedSharedSessionId: collaboration.selectedSharedSessionId,
      }),
    [
      activeWorkspace?.defaultWorkingRoot,
      effectiveAllRuntimeTasks,
      collaboration.selectedSharedSessionId,
      createdSessionId,
      effectiveSessions,
      effectiveSharedSessions,
      runtimeSessionStatuses,
      sharedSessionStatuses,
    ],
  );

  // --- Split memos: metric cards ---
  // --- Split memos: task lanes ---
  const selectedRuntimeTaskRecords = useMemo(
    () =>
      resolveTaskRecordsForView({
        selectedSessionId: selectedRuntimeScopeSessionId,
        selectedSessionScope,
        runtimeTaskGroups: runtimeTaskGroupsSource,
        teamTasks: collaboration.tasks,
        runtimeTaskRecords: collaboration.runtimeTaskRecords,
      }),
    [
      collaboration.runtimeTaskRecords,
      collaboration.tasks,
      runtimeTaskGroupsSource,
      selectedSessionScope,
      selectedRuntimeScopeSessionId,
    ],
  );

  const taskLanes = useMemo((): AgentTeamsTaskLane[] => {
    const lanes: AgentTeamsTaskLane[] = [
      { id: 'todo', title: '待办', cards: [] },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ];

    for (const task of selectedRuntimeTaskRecords) {
      const assigneeName = task.assignedAgent
        ? (memberNameById.get(task.assignedAgent) ?? task.assignedAgent)
        : task.assigneeId
          ? (memberNameById.get(task.assigneeId) ?? '未分配')
          : '未分配';
      const assigneeAccent =
        (task.assignedAgent ? accentByMemberId.get(task.assignedAgent) : undefined) ??
        (task.assigneeId ? accentByMemberId.get(task.assigneeId) : undefined) ??
        ROLE_SLOT_CONFIG[1].accent;
      lanes
        .find((lane) => lane.id === mapTaskToLaneId(task.status))
        ?.cards.push({
          assignee: assigneeName,
          assigneeAccent,
          description: task.result ?? '等待进一步推进与同步。',
          id: task.id,
          mutable: collaboration.tasks.some((item) => item.id === task.id),
          priority: task.priority,
          tags:
            task.status === 'failed'
              ? ['阻塞']
              : task.status === 'completed'
                ? ['已完成']
                : task.status === 'in_progress'
                  ? ['推进中']
                  : ['待认领'],
          title: task.title,
        });
    }
    return lanes;
  }, [selectedRuntimeTaskRecords, memberNameById, accentByMemberId]);

  // --- Split memos: conversation cards ---
  const conversationCards = useMemo(
    () =>
      buildConversationCardsProjection({
        auditLogs: scopedOverviewData.auditLogs,
        accentByMemberId,
        memberNameById,
        messages: scopedOverviewData.messages,
      }),
    [accentByMemberId, memberNameById, scopedOverviewData.auditLogs, scopedOverviewData.messages],
  );

  const messageCards = useMemo(
    () =>
      buildMessageCardsProjection({
        accentByMemberId,
        memberNameById,
        messages: scopedOverviewData.messages,
      }),
    [accentByMemberId, memberNameById, scopedOverviewData.messages],
  );

  const reviewCards = useMemo(
    () =>
      buildReviewCardsProjection({
        activeSharedSession,
        auditLogs: scopedOverviewData.auditLogs,
      }),
    [activeSharedSession, scopedOverviewData.auditLogs],
  );

  const { activityStats, timelineEvents } = useMemo(
    () =>
      buildTimelineProjection({
        accentByMemberId,
        auditLogs: scopedOverviewData.auditLogs,
        handoffs: scopedOverviewData.handoffs,
        memberNameById,
        messages: scopedOverviewData.messages,
        runtimeTasks: scopedOverviewData.runtimeTasks,
      }),
    [
      accentByMemberId,
      memberNameById,
      scopedOverviewData.auditLogs,
      scopedOverviewData.handoffs,
      scopedOverviewData.messages,
      scopedOverviewData.runtimeTasks,
    ],
  );

  const officeAgents = useMemo(
    () =>
      buildOfficeAgentsProjection({
        activeSharedSession,
        collaborationTasks: collaboration.tasks,
        isSelectedTeamPaused,
        roleBindings: roleBindings.roleCards,
        roleChips,
        taskLaneCount: taskLanes[1]?.cards.length ?? 0,
      }),
    [
      activeSharedSession,
      collaboration.tasks,
      isSelectedTeamPaused,
      roleBindings.roleCards,
      roleChips,
      taskLanes,
    ],
  );

  const pendingReviewCount =
    (activeSharedSession?.pendingPermissions.length ?? 0) +
    (activeSharedSession?.pendingQuestions.length ?? 0);

  const runtimeActivity = useMemo(
    () =>
      buildRuntimeActivityProjection({
        handoffs: scopedOverviewData.handoffs,
        runtimeTasks: scopedOverviewData.runtimeTasks,
        sessions: scopedOverviewData.sessions,
      }),
    [scopedOverviewData.handoffs, scopedOverviewData.runtimeTasks, scopedOverviewData.sessions],
  );
  const sharedActiveViewerCount = useMemo(
    () => activeSharedSession?.presence.filter((entry) => entry.active).length ?? 0,
    [activeSharedSession],
  );
  const sharedCommentCount = activeSharedSession?.comments.length ?? 0;

  const overviewCards = useMemo((): AgentTeamsOverviewCard[] => {
    const workingMembers = collaboration.members.filter(
      (member) => member.status === 'working',
    ).length;
    return buildOverviewCardsProjection({
      activeSharedSession,
      collaborationMemberCount: collaboration.members.length,
      collaborationTaskCount: collaboration.tasks.length,
      collaborationTasks: collaboration.tasks,
      collaborationWorkingMemberCount: workingMembers,
      pendingReviewCount,
      runtimeActivity,
      scopedAuditLogs: scopedOverviewData.auditLogs,
      scopedMessages: scopedOverviewData.messages,
      scopedSharedSessions: scopedOverviewData.sharedSessions,
      selectedRuntimeTaskRecordCount: selectedRuntimeTaskRecords.length,
      selectedSharedSummaryLabel: selectedSharedSummary
        ? (selectedSharedSummary.title ?? selectedSharedSummary.sessionId)
        : null,
      selectedSessionScope,
    });
  }, [
    collaboration.members,
    collaboration.tasks,
    activeSharedSession,
    scopedOverviewData,
    runtimeActivity,
    pendingReviewCount,
    selectedSessionScope,
    selectedSharedSummary?.sessionId,
    selectedSharedSummary?.title,
    selectedRuntimeTaskRecords.length,
  ]);

  const metricCards = useMemo(
    (): AgentTeamsMetricCard[] =>
      buildMetricCards({
        scoped: Boolean(selectedSessionScope),
        sharedSelected: Boolean(selectedSharedSummary),
        membersCount: collaboration.members.length,
        teamCompletedTaskCount: collaboration.tasks.filter((task) => task.status === 'completed')
          .length,
        teamTaskCount: collaboration.tasks.length,
        teamMessageCount: selectedSessionScope
          ? scopedOverviewData.messages.length
          : collaboration.messages.length,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        runtimeTaskTotal:
          runtimeActivity.runtimeTaskTotal > 0
            ? runtimeActivity.runtimeTaskTotal
            : selectedRuntimeTaskRecords.length,
        completedRuntimeTasks: runtimeActivity.completedTasks,
        failedRuntimeTasks: runtimeActivity.failedTasks,
        runningRuntimeTasks: runtimeActivity.runningTasks,
        pendingRuntimeTasks: selectedRuntimeTaskRecords.filter((task) => task.status === 'pending')
          .length,
        handoffTotal: runtimeActivity.handoffTotal,
        sharedSessionCount: effectiveSharedSessions.length,
        pendingReviewCount,
        sharedCommentCount,
        sharedViewerCount: sharedActiveViewerCount,
        sharedRunning: selectedSharedSummary?.stateStatus === 'running',
        sharedFailed: selectedSharedSummary?.stateStatus === 'failed',
      }),
    [
      collaboration.members.length,
      collaboration.messages.length,
      effectiveSharedSessions.length,
      collaboration.tasks,
      pendingReviewCount,
      runtimeActivity.completedTasks,
      runtimeActivity.failedTasks,
      runtimeActivity.handoffTotal,
      runtimeActivity.participatingLayerCount,
      runtimeActivity.runningTasks,
      runtimeActivity.runtimeTaskTotal,
      scopedOverviewData.messages,
      selectedRuntimeTaskRecords,
      selectedSessionScope,
      sharedActiveViewerCount,
      sharedCommentCount,
      selectedSharedSummary?.stateStatus,
      snapshotSharedSessions.length,
    ],
  );

  // --- Final assembly memo ---
  const liveValue = useMemo<TeamRuntimeReferenceViewData | null>(() => {
    if (!hasAuth) {
      return null;
    }

    const activeViewerCount = sharedActiveViewerCount;
    const workspaceOnlineCount = collaboration.members.filter(
      (member) => member.status === 'working',
    ).length;
    const topSummaryAudience = resolveTopSummaryAudience({
      sharedSelected: Boolean(selectedSharedSummary),
      sharedPresenceCount: activeSharedSession?.presence.length ?? 0,
      sharedActiveViewerCount: activeViewerCount,
      workspaceMemberCount: collaboration.members.length,
      workspaceOnlineCount,
    });
    // 运行/等待/异常计数：选中会话作用域时完全基于 scoped 数据，
    // 不回退到全局 collaboration.tasks——否则切会话后仪表盘数字不联动。
    // 仅在未选中会话（全局视图）时才用 V1 collaboration.tasks 做兼容回退。
    const isScoped = Boolean(selectedSessionScope);
    const failedTaskCount = isScoped
      ? runtimeActivity.failedTasks
      : (runtimeActivity.failedTasks ||
          collaboration.tasks.filter((task) => task.status === 'failed').length);
    const pendingTaskCount = isScoped
      ? selectedRuntimeTaskRecords.filter((task) => task.status === 'pending').length
      : collaboration.tasks.filter((task) => task.status === 'pending').length;
    const runningTaskCount = isScoped
      ? runtimeActivity.runningTasks
      : (runtimeActivity.runningTasks ||
          collaboration.tasks.filter((task) => task.status === 'in_progress').length);

    return {
      activeMode: 'live',
      activityStats,
      busy: collaboration.busy || sessionActionBusy,
      canCreateSession: hasAuth && Boolean(activeWorkspace),
      canCreateTemplate: workflowTemplates.canCreateTemplate,
      canManageRuntime: hasAuth && Boolean(activeWorkspace),
      canManageSessionEntries: hasAuth && Boolean(activeWorkspace),
      conversationCards,
      createSession,
      createTemplate: workflowTemplates.createTemplate,
      duplicateTemplate: workflowTemplates.duplicateTemplate,
      createWorkspace,
      createSessionShare: collaboration.createSessionShare,
      renameWorkspace,
      renameSession: collaboration.renameSession,
      deleteWorkspace,
      createTask,
      defaultSelectedAgentId: roleChips[0]?.id ?? 'leader',
      defaultSelectedTeamId,
      defaultReceptionSessionId,
      error: workspaceError ?? workspaceSnapshotError ?? collaboration.error,
      feedback: localFeedback ?? collaboration.feedback,
      footerLead: buildFooterLead({
        activeAgentCount: projection.buddyProjection.activeAgentCount,
        totalMembers: collaboration.members.length,
        scoped: Boolean(selectedSessionScope),
        sharedSelected: Boolean(selectedSharedSummary),
        sharedCommentCount,
        sharedViewerCount: activeViewerCount,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
      }),
      footerStats: buildFooterStats({
        scoped: isScoped,
        sharedSelected: Boolean(selectedSharedSummary),
        membersCount: collaboration.members.length,
        teamCompletedTaskCount: collaboration.tasks.filter((task) => task.status === 'completed')
          .length,
        teamTaskCount: collaboration.tasks.length,
        teamMessageCount: isScoped
          ? scopedOverviewData.messages.length
          : collaboration.messages.length,
        selectedSessionScopeSize: selectedSessionScope?.size ?? 0,
        participatingLayerCount: runtimeActivity.participatingLayerCount,
        runtimeTaskTotal:
          runtimeActivity.runtimeTaskTotal > 0
            ? runtimeActivity.runtimeTaskTotal
            : selectedRuntimeTaskRecords.length,
        completedRuntimeTasks: runtimeActivity.completedTasks,
        failedRuntimeTasks: failedTaskCount,
        runningRuntimeTasks: runningTaskCount,
        pendingRuntimeTasks: pendingTaskCount,
        handoffTotal: runtimeActivity.handoffTotal,
        sharedSessionCount: effectiveSharedSessions.length,
        pendingReviewCount,
        sharedCommentCount,
        sharedViewerCount: activeViewerCount,
        sharedRunning: selectedSharedSummary?.stateStatus === 'running',
        sharedFailed: selectedSharedSummary?.stateStatus === 'failed',
      }),
      historyTeams,
      loading:
        collaboration.loading ||
        roleBindings.loading ||
        workspaceLoading ||
        workspaceSnapshotLoading,
      messageCards,
      metricCards,
      moveTask,
      officeAgents,
      overviewCards,
      reviewCards,
      reviewBusy: collaboration.sharedOperateBusy || collaboration.sharedCommentBusy,
      replyReview,
      roleChips,
      runningTeams,
      selectTeam,
      sendMessage,
      sidebarSections: workflowTemplates.sections,
      submitReviewComment,
      createSharedSessionComment,
      toggleSessionState: collaboration.toggleSessionState,
      deleteSession: collaboration.deleteSession,
      updateSessionShare: collaboration.updateSessionShare,
      deleteSessionShare: collaboration.deleteSessionShare,
      templateCount: workflowTemplates.templateCount,
      templateError: workflowTemplates.error,
      templateLoading: workflowTemplates.loading,
      refreshTemplates: workflowTemplates.refreshLatest,
      templates: workflowTemplates.templateCards,
      updateTemplate: workflowTemplates.updateTemplate,
      removeTemplate: workflowTemplates.removeTemplate,
      taskLanes,
      timelineEvents,
      topSummary: {
        description: resolveTopSummaryDescription({
          activeWorkspaceName: activeWorkspace?.name ?? null,
          activeWorkspaceWorkingRoot: activeWorkspace?.defaultWorkingRoot ?? null,
          selectedRuntimeSessionTitle: selectedRuntimeSession?.title ?? null,
          selectedRuntimeSessionId: selectedRuntimeSession?.id ?? null,
          selectedRuntimeStatus,
          selectedSharedSessionTitle: selectedSharedSummary?.title ?? null,
          selectedSharedSessionId: selectedSharedSummary?.sessionId ?? null,
          selectedSharedStatus,
          selectedSharedWorkspaceLabel: selectedSharedSummary
            ? formatWorkspaceLabel(selectedSharedSummary.workspacePath)
            : null,
          workspaceOverviewLead: projection.workspaceOverviewLines[0] ?? null,
        }),
        memberCount: topSummaryAudience.memberCount,
        onlineCount: topSummaryAudience.onlineCount,
        status: resolveTopSummaryStatus({
          hasPausedRuntimeSessions: Array.from(runtimeSessionStatuses.values()).some(
            (status) => status === 'paused',
          ),
          selectedRuntimeStatus,
          selectedSharedStatus,
        }),
        title: resolveTopSummaryTitle({
          activeWorkspaceName: activeWorkspace?.name ?? null,
          selectedRuntimeSessionTitle: selectedRuntimeSession?.title ?? null,
          selectedRuntimeSessionId: selectedRuntimeSession?.id ?? null,
          selectedSharedSessionTitle: selectedSharedSummary?.title ?? null,
          selectedSharedSessionId: selectedSharedSummary?.sessionId ?? null,
        }),
      },
      workspaceGroups: effectiveWorkspaceGroups,
      workspaces: options.workspaces ?? [],
      auditLogs: collaboration.auditLogs,
      sessions: effectiveSessions,
      sessionShares: collaboration.sessionShares,
      sharedSessions: effectiveSharedSessions,
      selectedSharedSession: collaboration.selectedSharedSession,
      activeSharedSession,
      sharedSessionLoading: collaboration.sharedSessionLoading,
      setSelectedSharedSessionId: collaboration.setSelectedSharedSessionId,
      members: collaboration.members,
      diagnostics: collaboration.diagnostics,
      acknowledgeRuntimeAlert,
      clearRuntimeAlertControl,
      suppressRuntimeAlert,
      runRuntimeAlertRemediation,
      reconcileStaleDecisions,
      reconcileStaleRuntimeThreads,
    } satisfies TeamRuntimeReferenceViewData;
  }, [
    hasAuth,
    activeSharedSession,
    sharedActiveViewerCount,
    sharedCommentCount,
    collaboration.members,
    collaboration.tasks,
    collaboration.busy,
    collaboration.error,
    collaboration.feedback,
    localFeedback,
    collaboration.loading,
    collaboration.sharedSessions,
    collaboration.sharedSessionLoading,
    collaboration.sharedOperateBusy,
    collaboration.sharedCommentBusy,
    collaboration.toggleSessionState,
    collaboration.deleteSession,
    collaboration.updateSessionShare,
    collaboration.deleteSessionShare,
    sessionActionBusy,
    activeWorkspace,
    workspaceError,
    workspaceSnapshotError,
    workspaceLoading,
    workspaceSnapshotLoading,
    roleBindings.loading,
    workflowTemplates.canCreateTemplate,
    workflowTemplates.createTemplate,
    workflowTemplates.duplicateTemplate,
    workflowTemplates.error,
    workflowTemplates.loading,
    workflowTemplates.sections,
    workflowTemplates.templateCount,
    workflowTemplates.templateCards,
    workflowTemplates.updateTemplate,
    workflowTemplates.removeTemplate,
    workflowTemplates.refreshLatest,
    createSession,
    createWorkspace,
    collaboration.createSessionShare,
    renameWorkspace,
    collaboration.renameSession,
    deleteWorkspace,
    createTask,
    acknowledgeRuntimeAlert,
    clearRuntimeAlertControl,
    suppressRuntimeAlert,
    runRuntimeAlertRemediation,
    reconcileStaleDecisions,
    reconcileStaleRuntimeThreads,
    moveTask,
    replyReview,
    selectTeam,
    sendMessage,
    submitReviewComment,
    createSharedSessionComment,
    selectedRuntimeStatus,
    selectedSharedStatus,
    selectedSharedSummary,
    effectiveSessions,
    snapshotSharedSessions,
    projection.buddyProjection.activeAgentCount,
    projection.workspaceOverviewLines,
    pendingReviewCount,
    activityStats,
    conversationCards,
    defaultSelectedTeamId,
    defaultReceptionSessionId,
    effectiveWorkspaceGroups,
    historyTeams,
    messageCards,
    metricCards,
    officeAgents,
    overviewCards,
    reviewCards,
    roleChips,
    runningTeams,
    runtimeSessionStatuses,
    runtimeActivity,
    scopedOverviewData,
    selectedRuntimeTaskRecords,
    selectedSessionScope,
    taskLanes,
    timelineEvents,
    options.workspaces,
    collaboration.diagnostics,
    collaboration.setSelectedSharedSessionId,
    collaboration.selectedSharedSession,
  ]);

  const resolvedValue = liveValue ?? EMPTY_VIEW_DATA;

  return resolvedValue;
}
