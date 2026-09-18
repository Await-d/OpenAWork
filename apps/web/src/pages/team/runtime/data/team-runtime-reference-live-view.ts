import type {
  SessionTask,
  SharedSessionSummaryRecord,
  TeamAuditLogRecord,
  TeamMessageRecord,
  TeamRuntimeSessionRecord,
  TeamTaskRecord,
  TeamWorkspaceDetail,
  TeamWorkspaceSummary,
} from '@openAwork/web-client';
import type { HandoffEntry } from '../../../../stores/team/team-events.js';
import type {
  TeamActionFeedback,
  useTeamCollaboration,
} from '../../hooks/use-team-collaboration.js';
import type { useTeamRuntimeProjection } from '../hooks/use-team-runtime-projection.js';
import type { useTeamWorkflowTemplates } from '../hooks/use-team-workflow-templates.js';
import { formatWorkspaceLabel } from './team-runtime-reference-formatters.js';
import type { TeamRuntimeActivityProjection } from './team-runtime-reference-projections.js';
import { buildFooterLead, buildFooterStats } from './team-runtime-summary-metrics.js';
import type { TeamRuntimeOverviewScopeResult } from './team-runtime-overview-scope.js';
import type { TeamRuntimeSemanticStatus } from './team-runtime-status.js';
import {
  resolveTopSummaryAudience,
  resolveTopSummaryDescription,
  resolveTopSummaryStatus,
  resolveTopSummaryTitle,
} from './team-runtime-top-summary.js';
import type { TeamRuntimeReferenceViewData } from './team-runtime-reference-types.js';

export interface TeamRuntimeReferenceLiveViewInput {
  acknowledgeRuntimeAlert: TeamRuntimeReferenceViewData['acknowledgeRuntimeAlert'];
  activeSharedSession: TeamRuntimeReferenceViewData['activeSharedSession'];
  activeWorkspace: TeamWorkspaceDetail | null;
  activityStats: TeamRuntimeReferenceViewData['activityStats'];
  clearRuntimeAlertControl: TeamRuntimeReferenceViewData['clearRuntimeAlertControl'];
  collaboration: ReturnType<typeof useTeamCollaboration>;
  conversationCards: TeamRuntimeReferenceViewData['conversationCards'];
  createSession: TeamRuntimeReferenceViewData['createSession'];
  createSharedSessionComment: TeamRuntimeReferenceViewData['createSharedSessionComment'];
  createTask: TeamRuntimeReferenceViewData['createTask'];
  createWorkspace: TeamRuntimeReferenceViewData['createWorkspace'];
  defaultReceptionSessionId: string;
  defaultSelectedTeamId: string;
  deleteWorkspace: TeamRuntimeReferenceViewData['deleteWorkspace'];
  effectiveSessions: TeamRuntimeSessionRecord[];
  effectiveSharedSessions: SharedSessionSummaryRecord[];
  effectiveWorkspaceGroups: TeamRuntimeReferenceViewData['workspaceGroups'];
  hasAuth: boolean;
  historyTeams: TeamRuntimeReferenceViewData['historyTeams'];
  localFeedback: TeamActionFeedback | null;
  messageCards: TeamRuntimeReferenceViewData['messageCards'];
  metricCards: TeamRuntimeReferenceViewData['metricCards'];
  moveTask: TeamRuntimeReferenceViewData['moveTask'];
  officeAgents: TeamRuntimeReferenceViewData['officeAgents'];
  overviewCards: TeamRuntimeReferenceViewData['overviewCards'];
  pendingReviewCount: number;
  projection: ReturnType<typeof useTeamRuntimeProjection>;
  reconcileStaleDecisions: TeamRuntimeReferenceViewData['reconcileStaleDecisions'];
  reconcileStaleRuntimeThreads: TeamRuntimeReferenceViewData['reconcileStaleRuntimeThreads'];
  renameWorkspace: TeamRuntimeReferenceViewData['renameWorkspace'];
  replyReview: TeamRuntimeReferenceViewData['replyReview'];
  reviewCards: TeamRuntimeReferenceViewData['reviewCards'];
  roleBindingsLoading: boolean;
  roleChips: TeamRuntimeReferenceViewData['roleChips'];
  runRuntimeAlertRemediation: TeamRuntimeReferenceViewData['runRuntimeAlertRemediation'];
  runningTeams: TeamRuntimeReferenceViewData['runningTeams'];
  runtimeActivity: TeamRuntimeActivityProjection;
  runtimeSessionStatuses: ReadonlyMap<string, TeamRuntimeSemanticStatus>;
  scopedOverviewData: TeamRuntimeOverviewScopeResult<
    HandoffEntry,
    SessionTask,
    TeamRuntimeSessionRecord,
    TeamMessageRecord,
    TeamAuditLogRecord,
    SharedSessionSummaryRecord
  >;
  selectTeam: TeamRuntimeReferenceViewData['selectTeam'];
  selectedRuntimeSession: TeamRuntimeSessionRecord | null;
  selectedRuntimeStatus: TeamRuntimeSemanticStatus | null;
  selectedRuntimeTaskRecords: TeamTaskRecord[];
  selectedSessionScope: ReadonlySet<string> | null;
  selectedSharedStatus: TeamRuntimeSemanticStatus | null;
  selectedSharedSummary: SharedSessionSummaryRecord | null;
  sendMessage: TeamRuntimeReferenceViewData['sendMessage'];
  sessionActionBusy: boolean;
  sharedActiveViewerCount: number;
  sharedCommentCount: number;
  submitReviewComment: TeamRuntimeReferenceViewData['submitReviewComment'];
  suppressRuntimeAlert: TeamRuntimeReferenceViewData['suppressRuntimeAlert'];
  taskLanes: TeamRuntimeReferenceViewData['taskLanes'];
  timelineEvents: TeamRuntimeReferenceViewData['timelineEvents'];
  workflowTemplates: ReturnType<typeof useTeamWorkflowTemplates>;
  workspaceError: string | null;
  workspaceLoading: boolean;
  workspaceSnapshotError: string | null;
  workspaceSnapshotLoading: boolean;
  workspaces: TeamWorkspaceSummary[];
}

export function buildLiveTeamRuntimeReferenceViewData(
  input: TeamRuntimeReferenceLiveViewInput,
): TeamRuntimeReferenceViewData {
  const activeViewerCount = input.sharedActiveViewerCount;
  const workspaceOnlineCount = input.collaboration.members.filter(
    (member) => member.status === 'working',
  ).length;
  const topSummaryAudience = resolveTopSummaryAudience({
    sharedSelected: Boolean(input.selectedSharedSummary),
    sharedPresenceCount: input.activeSharedSession?.presence.length ?? 0,
    sharedActiveViewerCount: activeViewerCount,
    workspaceMemberCount: input.collaboration.members.length,
    workspaceOnlineCount,
  });
  const isScoped = Boolean(input.selectedSessionScope);
  const failedTaskCount = isScoped
    ? input.runtimeActivity.failedTasks
    : input.runtimeActivity.failedTasks ||
      input.collaboration.tasks.filter((task) => task.status === 'failed').length;
  const pendingTaskCount = isScoped
    ? input.selectedRuntimeTaskRecords.filter((task) => task.status === 'pending').length
    : input.collaboration.tasks.filter((task) => task.status === 'pending').length;
  const runningTaskCount = isScoped
    ? input.runtimeActivity.runningTasks
    : input.runtimeActivity.runningTasks ||
      input.collaboration.tasks.filter((task) => task.status === 'in_progress').length;

  return {
    activeMode: 'live',
    activityStats: input.activityStats,
    busy: input.collaboration.busy || input.sessionActionBusy,
    canCreateSession: input.hasAuth && Boolean(input.activeWorkspace),
    canCreateTemplate: input.workflowTemplates.canCreateTemplate,
    canManageRuntime: input.hasAuth && Boolean(input.activeWorkspace),
    canManageSessionEntries: input.hasAuth && Boolean(input.activeWorkspace),
    conversationCards: input.conversationCards,
    createSession: input.createSession,
    createTemplate: input.workflowTemplates.createTemplate,
    duplicateTemplate: input.workflowTemplates.duplicateTemplate,
    createWorkspace: input.createWorkspace,
    createSessionShare: input.collaboration.createSessionShare,
    renameWorkspace: input.renameWorkspace,
    renameSession: input.collaboration.renameSession,
    deleteWorkspace: input.deleteWorkspace,
    createTask: input.createTask,
    defaultSelectedAgentId: input.roleChips[0]?.id ?? 'leader',
    defaultSelectedTeamId: input.defaultSelectedTeamId,
    defaultReceptionSessionId: input.defaultReceptionSessionId,
    error: input.workspaceError ?? input.workspaceSnapshotError ?? input.collaboration.error,
    feedback: input.localFeedback ?? input.collaboration.feedback,
    footerLead: buildFooterLead({
      activeAgentCount: input.projection.buddyProjection.activeAgentCount,
      totalMembers: input.collaboration.members.length,
      scoped: Boolean(input.selectedSessionScope),
      sharedSelected: Boolean(input.selectedSharedSummary),
      sharedCommentCount: input.sharedCommentCount,
      sharedViewerCount: activeViewerCount,
      participatingLayerCount: input.runtimeActivity.participatingLayerCount,
      selectedSessionScopeSize: input.selectedSessionScope?.size ?? 0,
    }),
    footerStats: buildFooterStats({
      scoped: isScoped,
      sharedSelected: Boolean(input.selectedSharedSummary),
      membersCount: input.collaboration.members.length,
      teamCompletedTaskCount: input.collaboration.tasks.filter(
        (task) => task.status === 'completed',
      ).length,
      teamTaskCount: input.collaboration.tasks.length,
      teamMessageCount: isScoped
        ? input.scopedOverviewData.messages.length
        : input.collaboration.messages.length,
      selectedSessionScopeSize: input.selectedSessionScope?.size ?? 0,
      participatingLayerCount: input.runtimeActivity.participatingLayerCount,
      runtimeTaskTotal:
        input.runtimeActivity.runtimeTaskTotal > 0
          ? input.runtimeActivity.runtimeTaskTotal
          : input.selectedRuntimeTaskRecords.length,
      completedRuntimeTasks: input.runtimeActivity.completedTasks,
      failedRuntimeTasks: failedTaskCount,
      runningRuntimeTasks: runningTaskCount,
      pendingRuntimeTasks: pendingTaskCount,
      handoffTotal: input.runtimeActivity.handoffTotal,
      sharedSessionCount: input.effectiveSharedSessions.length,
      pendingReviewCount: input.pendingReviewCount,
      sharedCommentCount: input.sharedCommentCount,
      sharedViewerCount: activeViewerCount,
      sharedRunning: input.selectedSharedSummary?.stateStatus === 'running',
      sharedFailed: input.selectedSharedSummary?.stateStatus === 'failed',
    }),
    historyTeams: input.historyTeams,
    loading:
      input.collaboration.loading ||
      input.roleBindingsLoading ||
      input.workspaceLoading ||
      input.workspaceSnapshotLoading,
    messageCards: input.messageCards,
    metricCards: input.metricCards,
    moveTask: input.moveTask,
    officeAgents: input.officeAgents,
    overviewCards: input.overviewCards,
    reviewCards: input.reviewCards,
    reviewBusy: input.collaboration.sharedOperateBusy || input.collaboration.sharedCommentBusy,
    replyReview: input.replyReview,
    roleChips: input.roleChips,
    runningTeams: input.runningTeams,
    selectTeam: input.selectTeam,
    sendMessage: input.sendMessage,
    sidebarSections: input.workflowTemplates.sections,
    submitReviewComment: input.submitReviewComment,
    createSharedSessionComment: input.createSharedSessionComment,
    toggleSessionState: input.collaboration.toggleSessionState,
    deleteSession: input.collaboration.deleteSession,
    updateSessionShare: input.collaboration.updateSessionShare,
    deleteSessionShare: input.collaboration.deleteSessionShare,
    templateCount: input.workflowTemplates.templateCount,
    templateError: input.workflowTemplates.error,
    templateLoading: input.workflowTemplates.loading,
    refreshTemplates: input.workflowTemplates.refreshLatest,
    templates: input.workflowTemplates.templateCards,
    updateTemplate: input.workflowTemplates.updateTemplate,
    removeTemplate: input.workflowTemplates.removeTemplate,
    taskLanes: input.taskLanes,
    timelineEvents: input.timelineEvents,
    topSummary: {
      description: resolveTopSummaryDescription({
        activeWorkspaceName: input.activeWorkspace?.name ?? null,
        activeWorkspaceWorkingRoot: input.activeWorkspace?.defaultWorkingRoot ?? null,
        selectedRuntimeSessionTitle: input.selectedRuntimeSession?.title ?? null,
        selectedRuntimeSessionId: input.selectedRuntimeSession?.id ?? null,
        selectedRuntimeStatus: input.selectedRuntimeStatus,
        selectedSharedSessionTitle: input.selectedSharedSummary?.title ?? null,
        selectedSharedSessionId: input.selectedSharedSummary?.sessionId ?? null,
        selectedSharedStatus: input.selectedSharedStatus,
        selectedSharedWorkspaceLabel: input.selectedSharedSummary
          ? formatWorkspaceLabel(input.selectedSharedSummary.workspacePath)
          : null,
        workspaceOverviewLead: input.projection.workspaceOverviewLines[0] ?? null,
      }),
      memberCount: topSummaryAudience.memberCount,
      onlineCount: topSummaryAudience.onlineCount,
      status: resolveTopSummaryStatus({
        hasPausedRuntimeSessions: Array.from(input.runtimeSessionStatuses.values()).some(
          (status) => status === 'paused',
        ),
        selectedRuntimeStatus: input.selectedRuntimeStatus,
        selectedSharedStatus: input.selectedSharedStatus,
      }),
      title: resolveTopSummaryTitle({
        activeWorkspaceName: input.activeWorkspace?.name ?? null,
        selectedRuntimeSessionTitle: input.selectedRuntimeSession?.title ?? null,
        selectedRuntimeSessionId: input.selectedRuntimeSession?.id ?? null,
        selectedSharedSessionTitle: input.selectedSharedSummary?.title ?? null,
        selectedSharedSessionId: input.selectedSharedSummary?.sessionId ?? null,
      }),
    },
    workspaceGroups: input.effectiveWorkspaceGroups,
    workspaces: input.workspaces,
    auditLogs: input.collaboration.auditLogs,
    sessions: input.effectiveSessions,
    sessionShares: input.collaboration.sessionShares,
    sharedSessions: input.effectiveSharedSessions,
    selectedSharedSession: input.collaboration.selectedSharedSession,
    activeSharedSession: input.activeSharedSession,
    sharedSessionLoading: input.collaboration.sharedSessionLoading,
    setSelectedSharedSessionId: input.collaboration.setSelectedSharedSessionId,
    members: input.collaboration.members,
    diagnostics: input.collaboration.diagnostics,
    acknowledgeRuntimeAlert: input.acknowledgeRuntimeAlert,
    clearRuntimeAlertControl: input.clearRuntimeAlertControl,
    suppressRuntimeAlert: input.suppressRuntimeAlert,
    runRuntimeAlertRemediation: input.runRuntimeAlertRemediation,
    reconcileStaleDecisions: input.reconcileStaleDecisions,
    reconcileStaleRuntimeThreads: input.reconcileStaleRuntimeThreads,
  } satisfies TeamRuntimeReferenceViewData;
}
