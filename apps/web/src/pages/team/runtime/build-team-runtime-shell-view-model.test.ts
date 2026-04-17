import { describe, expect, it, vi } from 'vitest';
import { buildTeamRuntimeShellViewModel } from './build-team-runtime-shell-view-model.js';

describe('buildTeamRuntimeShellViewModel', () => {
  it('maps selected workspace data and slices header metrics to four items', () => {
    const viewModel = buildTeamRuntimeShellViewModel({
      activeTabMeta: { key: 'overview', label: '总览', summary: '摘要' },
      buddyProjection: {
        activeAgentCount: 1,
        blockedCount: 0,
        pendingApprovalCount: 0,
        pendingQuestionCount: 0,
        runningCount: 2,
        sessionTitle: '共享会话 A',
        workspaceLabel: '/repo/apps/web',
      },
      busy: false,
      error: null,
      feedback: null,
      filteredSessionCount: 3,
      filteredSessionShareCount: 2,
      filteredSharedSessions: [],
      interactionDraft: 'draft',
      isSingleColumn: false,
      isTwoColumn: true,
      mainContent: 'main-content',
      metrics: [
        { hint: 'h1', label: 'm1', value: 1 },
        { hint: 'h2', label: 'm2', value: 2 },
        { hint: 'h3', label: 'm3', value: 3 },
        { hint: 'h4', label: 'm4', value: 4 },
        { hint: 'h5', label: 'm5', value: 5 },
      ],
      onActiveTabChange: vi.fn(),
      onInteractionDraftChange: vi.fn(),
      onLaunchWorkflowTemplate: vi.fn(async () => true),
      onRoleBindingChange: vi.fn(),
      onSelectSharedSession: vi.fn(),
      onSelectWorkspaceKey: vi.fn(),
      onSubmitInteractionDraft: vi.fn(),
      roleBindingAgents: [],
      roleBindingCards: [],
      roleBindingError: null,
      roleBindingLoading: false,
      selectedRunSummary: null,
      selectedSharedSessionId: 'session-a',
      selectedWorkspace: {
        description: 'desc',
        key: '/repo/apps/web',
        label: '/repo/apps/web',
        pausedCount: 0,
        runningCount: 2,
        sessionCount: 3,
        sharedSessionCount: 1,
        shareRecordCount: 2,
      },
      tabs: [
        { key: 'overview', label: '总览', summary: '摘要' },
        { key: 'tasks', label: '任务', summary: '任务摘要' },
      ],
      workflowLaunch: null,
      workspaceOverviewLines: ['line-1'],
      workspaceSummaries: [],
    });

    expect(viewModel.activeTabKey).toBe('overview');
    expect(viewModel.headerMetrics).toHaveLength(4);
    expect(viewModel.headerMetrics.map((item) => item.label)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(viewModel.selectedWorkspaceKey).toBe('/repo/apps/web');
    expect(viewModel.selectedWorkspaceLabel).toBe('/repo/apps/web');
    expect(viewModel.selectedWorkspaceRunningCount).toBe(2);
    expect(viewModel.mainContent).toBe('main-content');
  });

  it('falls back to the all-workspaces defaults when no workspace is selected', () => {
    const viewModel = buildTeamRuntimeShellViewModel({
      activeTabMeta: { key: 'tasks', label: '任务', summary: '任务摘要' },
      buddyProjection: {
        activeAgentCount: 0,
        blockedCount: 0,
        pendingApprovalCount: 0,
        pendingQuestionCount: 0,
        runningCount: 0,
        sessionTitle: null,
        workspaceLabel: '全部工作区',
      },
      busy: true,
      error: 'boom',
      feedback: { message: 'saved', tone: 'success' },
      filteredSessionCount: 0,
      filteredSessionShareCount: 0,
      filteredSharedSessions: [],
      interactionDraft: '',
      isSingleColumn: true,
      isTwoColumn: false,
      mainContent: null,
      metrics: [],
      onActiveTabChange: vi.fn(),
      onInteractionDraftChange: vi.fn(),
      onLaunchWorkflowTemplate: vi.fn(async () => false),
      onRoleBindingChange: vi.fn(),
      onSelectSharedSession: vi.fn(),
      onSelectWorkspaceKey: vi.fn(),
      onSubmitInteractionDraft: vi.fn(),
      roleBindingAgents: [],
      roleBindingCards: [],
      roleBindingError: 'role-error',
      roleBindingLoading: true,
      selectedRunSummary: null,
      selectedSharedSessionId: null,
      selectedWorkspace: null,
      tabs: [{ key: 'tasks', label: '任务', summary: '任务摘要' }],
      workflowLaunch: null,
      workspaceOverviewLines: [],
      workspaceSummaries: [],
    });

    expect(viewModel.selectedWorkspaceKey).toBe('__all_workspaces__');
    expect(viewModel.selectedWorkspaceLabel).toBe('全部工作区');
    expect(viewModel.selectedWorkspaceRunningCount).toBe(0);
    expect(viewModel.busy).toBe(true);
    expect(viewModel.error).toBe('boom');
    expect(viewModel.feedback).toEqual({ message: 'saved', tone: 'success' });
  });
});
