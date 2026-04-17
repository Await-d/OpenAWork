import type { TeamActionFeedback } from '../use-team-collaboration.js';
import type { TeamRuntimeMetric, TeamWorkspaceCardSummary } from './team-runtime-model.js';
import type { TeamRuntimeShellFrameProps } from './team-runtime-shell-frame.js';

export interface RuntimeShellTabMeta {
  key: string;
  label: string;
  summary: string;
}

interface BuildTeamRuntimeShellViewModelArgs {
  activeTabMeta: RuntimeShellTabMeta;
  buddyProjection: TeamRuntimeShellFrameProps['buddyProjection'];
  busy: boolean;
  error: string | null;
  feedback: TeamActionFeedback | null;
  filteredSessionCount: number;
  filteredSessionShareCount: number;
  filteredSharedSessions: TeamRuntimeShellFrameProps['filteredSharedSessions'];
  interactionDraft: string;
  isSingleColumn: boolean;
  isTwoColumn: boolean;
  mainContent: TeamRuntimeShellFrameProps['mainContent'];
  onActiveTabChange: TeamRuntimeShellFrameProps['onActiveTabChange'];
  onInteractionDraftChange: TeamRuntimeShellFrameProps['onInteractionDraftChange'];
  onLaunchWorkflowTemplate: TeamRuntimeShellFrameProps['onLaunchWorkflowTemplate'];
  onRoleBindingChange: TeamRuntimeShellFrameProps['onRoleBindingChange'];
  onSelectSharedSession: TeamRuntimeShellFrameProps['onSelectSharedSession'];
  onSelectWorkspaceKey: TeamRuntimeShellFrameProps['onSelectWorkspaceKey'];
  onSubmitInteractionDraft: TeamRuntimeShellFrameProps['onSubmitInteractionDraft'];
  onBuddyApproveAll?: TeamRuntimeShellFrameProps['onBuddyApproveAll'];
  onBuddyReviewBlocked?: TeamRuntimeShellFrameProps['onBuddyReviewBlocked'];
  onBuddyAnswerQuestions?: TeamRuntimeShellFrameProps['onBuddyAnswerQuestions'];
  roleBindingAgents: TeamRuntimeShellFrameProps['roleBindingAgents'];
  roleBindingCards: TeamRuntimeShellFrameProps['roleBindingCards'];
  roleBindingError: string | null;
  roleBindingLoading: boolean;
  selectedRunSummary: TeamRuntimeShellFrameProps['selectedRunSummary'];
  selectedSharedSessionId: string | null;
  selectedWorkspace: TeamWorkspaceCardSummary | null;
  tabs: RuntimeShellTabMeta[];
  workflowLaunch: TeamRuntimeShellFrameProps['workflowLaunch'];
  workspaceOverviewLines: string[];
  workspaceSummaries: TeamWorkspaceCardSummary[];
  metrics: TeamRuntimeMetric[];
}

export function buildTeamRuntimeShellViewModel({
  activeTabMeta,
  buddyProjection,
  busy,
  error,
  feedback,
  filteredSessionCount,
  filteredSessionShareCount,
  filteredSharedSessions,
  interactionDraft,
  isSingleColumn,
  isTwoColumn,
  mainContent,
  metrics,
  onActiveTabChange,
  onInteractionDraftChange,
  onLaunchWorkflowTemplate,
  onRoleBindingChange,
  onSelectSharedSession,
  onSelectWorkspaceKey,
  onSubmitInteractionDraft,
  onBuddyApproveAll,
  onBuddyReviewBlocked,
  onBuddyAnswerQuestions,
  roleBindingAgents,
  roleBindingCards,
  roleBindingError,
  roleBindingLoading,
  selectedRunSummary,
  selectedSharedSessionId,
  selectedWorkspace,
  tabs,
  workflowLaunch,
  workspaceOverviewLines,
  workspaceSummaries,
}: BuildTeamRuntimeShellViewModelArgs): TeamRuntimeShellFrameProps {
  return {
    activeTabKey: activeTabMeta.key,
    activeTabLabel: activeTabMeta.label,
    activeTabSummary: activeTabMeta.summary,
    buddyProjection,
    busy,
    error,
    feedback,
    filteredSessionCount,
    filteredSessionShareCount,
    filteredSharedSessions,
    headerMetrics: metrics.slice(0, 4),
    interactionDraft,
    isSingleColumn,
    isTwoColumn,
    mainContent,
    onActiveTabChange,
    onInteractionDraftChange,
    onLaunchWorkflowTemplate,
    onRoleBindingChange,
    onSelectSharedSession,
    onSelectWorkspaceKey,
    onSubmitInteractionDraft,
    onBuddyApproveAll,
    onBuddyReviewBlocked,
    onBuddyAnswerQuestions,
    roleBindingAgents,
    roleBindingCards,
    roleBindingError,
    roleBindingLoading,
    selectedRunSummary,
    selectedSharedSessionId,
    selectedWorkspaceKey: selectedWorkspace?.key ?? '__all_workspaces__',
    selectedWorkspaceLabel: selectedWorkspace?.label ?? '全部工作区',
    selectedWorkspaceRunningCount: selectedWorkspace?.runningCount ?? 0,
    tabs,
    workspaceOverviewLines,
    workspaceSummaries,
    workflowLaunch,
  };
}
