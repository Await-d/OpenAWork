import { useEffect, useMemo, useState } from 'react';
import { createTeamClient } from '@openAwork/web-client';
import { useAuthStore } from '../../../../stores/auth/auth.js';
import {
  useTeamCollaboration,
  type TeamActionFeedback,
} from '../../hooks/use-team-collaboration.js';
import { useHandoffStore } from '../../../../stores/team/team-events.js';
import {
  filterActiveAuditEntries,
  useRollbackVoidWindows,
} from '../../../../stores/team/rollback-tombstones.js';
import type { AgentTeamsMetricCard, AgentTeamsOverviewCard } from './team-runtime-types.js';
import {
  collectRuntimeTasksForSession,
  resolveTaskRecordsForView,
} from './team-runtime-task-lanes.js';
import { collectSessionScope } from './team-runtime-session-scope.js';
import { scopeTeamRuntimeOverviewData } from './team-runtime-overview-scope.js';
import {
  resolveActiveSharedSession,
  resolveSelectedSharedSummary,
} from './team-runtime-shared-context.js';
import { resolveSelectedRuntimeScopeSessionId } from './team-runtime-selection-context.js';
import { buildMetricCards } from './team-runtime-summary-metrics.js';
import { useTeamRuntimeProjection } from '../hooks/use-team-runtime-projection.js';
import { useTeamRuntimeRoleBindings } from '../hooks/use-team-runtime-role-bindings.js';
import { useTeamWorkflowTemplates } from '../hooks/use-team-workflow-templates.js';
import { EMPTY_VIEW_DATA } from './team-runtime-reference-empty.js';
import { useGlobalTeamRuntimeSessions } from './team-runtime-reference-global-sessions.js';
import { buildLiveTeamRuntimeReferenceViewData } from './team-runtime-reference-live-view.js';
import { useTeamRuntimeReferenceActions } from './team-runtime-reference-actions.js';
import {
  buildAccentByMemberId,
  buildMemberNameById,
  buildRuntimeRoleChips,
  buildTaskLanes,
} from './team-runtime-reference-card-derivations.js';
import {
  buildBaseSessions,
  buildEffectiveSessions,
  buildRuntimeSessionStatuses,
  buildSharedSessionStatuses,
  collectAllRuntimeTasksFromGroups,
  mergeRuntimeTaskRecords,
} from './team-runtime-reference-sessions.js';
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
import type {
  TeamRuntimeReferenceDataOptions,
  TeamRuntimeReferenceViewData,
} from './team-runtime-reference-types.js';
import {
  TeamRuntimeReferenceDataProvider,
  useTeamRuntimeReferenceViewData,
} from './team-runtime-reference-context.js';

export { TeamRuntimeReferenceDataProvider, useTeamRuntimeReferenceViewData };

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
  const [createdSessionInfo, setCreatedSessionInfo] = useState<{
    id: string;
    title: string | null;
  } | null>(null);
  const createdSessionId = createdSessionInfo?.id ?? null;
  const snapshotSharedSessions = activeWorkspaceSnapshot?.sharedSessions ?? [];
  const snapshotSessions = activeWorkspaceSnapshot?.sessions ?? [];

  const globalSessions = useGlobalTeamRuntimeSessions(accessToken, teamClient);

  const baseSessions = useMemo(
    () => buildBaseSessions(globalSessions, snapshotSessions, collaboration.sessions),
    [collaboration.sessions, globalSessions, snapshotSessions],
  );
  const effectiveSessions = useMemo(
    () =>
      buildEffectiveSessions(
        baseSessions,
        createdSessionInfo,
        activeWorkspace?.defaultWorkingRoot ?? null,
      ),
    [activeWorkspace?.defaultWorkingRoot, baseSessions, createdSessionInfo],
  );
  const effectiveSharedSessions =
    snapshotSharedSessions.length > 0 ? snapshotSharedSessions : collaboration.sharedSessions;

  useEffect(() => {
    if (createdSessionInfo && baseSessions.some((s) => s.id === createdSessionInfo.id)) {
      setCreatedSessionInfo(null);
    }
  }, [baseSessions, createdSessionInfo]);

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

  const handoffsMap = useHandoffStore((state) => state.handoffs);
  const rollbackVoidWindows = useRollbackVoidWindows();
  const handoffEntries = useMemo(() => Array.from(handoffsMap.values()), [handoffsMap]);
  // 回退回合的 handoff 不得进入概览 / 会话状态 / 交接摘要聚合，
  // 与 TeamPageV2 / use-team-run-state / use-team-middle-area 的读取期过滤保持一致。
  const activeHandoffEntries = useMemo(
    () => filterActiveAuditEntries(handoffEntries, rollbackVoidWindows),
    [handoffEntries, rollbackVoidWindows],
  );

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

  const {
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
  } = useTeamRuntimeReferenceActions({
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
  });

  // --- Split memos: shared intermediates ---
  const roleChips = useMemo(
    () => buildRuntimeRoleChips(collaboration.members, roleBindings.roleCards),
    [collaboration.members, roleBindings.roleCards],
  );

  const accentByMemberId = useMemo(
    () => buildAccentByMemberId(collaboration.members, roleChips),
    [collaboration.members, roleChips],
  );

  const memberNameById = useMemo(
    () => buildMemberNameById(collaboration.members),
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
      filterActiveAuditEntries(
        collectRuntimeTasksForSession(
          runtimeTaskGroupsSource,
          selectedRuntimeScopeSessionId,
          selectedSessionScope,
        ),
        rollbackVoidWindows,
      ),
    [
      rollbackVoidWindows,
      runtimeTaskGroupsSource,
      selectedRuntimeScopeSessionId,
      selectedSessionScope,
    ],
  );

  // 合并：优先用从 groups 按 scope 提取的任务（覆盖运行时会话场景），
  // 再补充 collaboration.runtimeTasks（共享会话场景下已按 selectedSharedSessionId 提取）。
  const effectiveRuntimeTasksForScope = useMemo(
    () => mergeRuntimeTaskRecords(scopedRuntimeTasksFromGroups, collaboration.runtimeTasks),
    [collaboration.runtimeTasks, scopedRuntimeTasksFromGroups],
  );

  const scopedOverviewData = useMemo(
    () =>
      scopeTeamRuntimeOverviewData({
        selectedSessionId: selectedRuntimeScopeSessionId,
        handoffs: activeHandoffEntries,
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
      activeHandoffEntries,
      selectedRuntimeScopeSessionId,
    ],
  );

  // 从 runtimeTaskGroups 展开全量任务列表（不按 session scope 过滤），
  // 供 runtimeSessionStatuses / sharedSessionStatuses 计算每个 session 的状态。
  // collaboration.runtimeTasks 只在共享会话选中时有数据，不能覆盖运行时会话场景。
  const allRuntimeTasksFromGroups = useMemo(
    () => collectAllRuntimeTasksFromGroups(runtimeTaskGroupsSource),
    [runtimeTaskGroupsSource],
  );

  // 合并 groups 展开的任务和 collaboration.runtimeTasks，作为全量任务来源。
  // 回退回合后，落进作废窗口的任务同样先在读取期过滤掉——`taskFailed` 是
  // 从这里投影给 workspaceGroups 的（失败计数、会话卡红点）。
  const effectiveAllRuntimeTasks = useMemo(
    () =>
      filterActiveAuditEntries(
        mergeRuntimeTaskRecords(allRuntimeTasksFromGroups, collaboration.runtimeTasks),
        rollbackVoidWindows,
      ),
    [allRuntimeTasksFromGroups, collaboration.runtimeTasks, rollbackVoidWindows],
  );

  const runtimeSessionStatuses = useMemo(
    () =>
      buildRuntimeSessionStatuses({
        sessions: effectiveSessions,
        handoffs: activeHandoffEntries,
        runtimeTasks: effectiveAllRuntimeTasks,
      }),
    [effectiveAllRuntimeTasks, effectiveSessions, activeHandoffEntries],
  );

  const sharedSessionStatuses = useMemo(
    () =>
      buildSharedSessionStatuses({
        sharedSessions: effectiveSharedSessions,
        sessions: effectiveSessions,
        handoffs: activeHandoffEntries,
        runtimeTasks: effectiveAllRuntimeTasks,
      }),
    [effectiveAllRuntimeTasks, effectiveSharedSessions, effectiveSessions, activeHandoffEntries],
  );

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

  const taskLanes = useMemo(
    () =>
      buildTaskLanes({
        selectedRuntimeTaskRecords,
        teamTasks: collaboration.tasks,
        memberNameById,
        accentByMemberId,
      }),
    [selectedRuntimeTaskRecords, memberNameById, accentByMemberId],
  );

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

    return buildLiveTeamRuntimeReferenceViewData({
      acknowledgeRuntimeAlert,
      activeSharedSession,
      activeWorkspace,
      activityStats,
      clearRuntimeAlertControl,
      collaboration,
      conversationCards,
      createSession,
      createSharedSessionComment,
      createTask,
      createWorkspace,
      defaultReceptionSessionId,
      defaultSelectedTeamId,
      deleteWorkspace,
      effectiveSessions,
      effectiveSharedSessions,
      effectiveWorkspaceGroups,
      hasAuth,
      historyTeams,
      localFeedback,
      messageCards,
      metricCards,
      moveTask,
      officeAgents,
      overviewCards,
      pendingReviewCount,
      projection,
      reconcileStaleDecisions,
      reconcileStaleRuntimeThreads,
      renameWorkspace,
      replyReview,
      reviewCards,
      roleBindingsLoading: roleBindings.loading,
      roleChips,
      runRuntimeAlertRemediation,
      runningTeams,
      runtimeActivity,
      runtimeSessionStatuses,
      scopedOverviewData,
      selectTeam,
      selectedRuntimeSession,
      selectedRuntimeStatus,
      selectedRuntimeTaskRecords,
      selectedSessionScope,
      selectedSharedStatus,
      selectedSharedSummary,
      sendMessage,
      sessionActionBusy,
      sharedActiveViewerCount,
      sharedCommentCount,
      submitReviewComment,
      suppressRuntimeAlert,
      taskLanes,
      timelineEvents,
      workflowTemplates,
      workspaceError,
      workspaceLoading,
      workspaceSnapshotError,
      workspaceSnapshotLoading,
      workspaces: options.workspaces ?? [],
    });
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
