// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  agentTeamsConversationCards,
  agentTeamsFooterLead,
  agentTeamsFooterStats,
  agentTeamsHistoryTeams,
  agentTeamsMessageCards,
  agentTeamsMetricCards,
  agentTeamsOfficeAgents,
  agentTeamsOverviewCards,
  agentTeamsReviewCards,
  agentTeamsRoleChips,
  agentTeamsRunningTeams,
  agentTeamsSidebarSections,
  agentTeamsTimelineEvents,
  agentTeamsWorkspaceGroups,
} from './team/runtime/team-runtime-reference-mock.js';

const mockUseTeamWorkspaceState = vi.fn();
const mockUseTeamWorkspaceSnapshotState = vi.fn();
const mockUseResolvedTeamRuntimeReferenceData = vi.fn();

vi.mock('./team/runtime/OfficeThreeCanvas.js', () => ({
  OfficeThreeCanvas: () => (
    <div data-testid="office-three-canvas">
      <span>场景控制</span>
      <span>当前缩放100%</span>
      <span>POWER_BAR</span>
    </div>
  ),
}));

vi.mock('./team/use-team-workspace-state.js', () => ({
  useTeamWorkspaceState: (...args: unknown[]) => mockUseTeamWorkspaceState(...args),
}));

vi.mock('./team/use-team-workspace-snapshot-state.js', () => ({
  useTeamWorkspaceSnapshotState: (...args: unknown[]) => mockUseTeamWorkspaceSnapshotState(...args),
}));

vi.mock('./team/runtime/team-runtime-reference-data.js', () => ({
  TeamRuntimeReferenceDataProvider: ({ children }: { children: ReactNode }) => children,
  useResolvedTeamRuntimeReferenceData: (...args: unknown[]) =>
    mockUseResolvedTeamRuntimeReferenceData(...args),
  useTeamRuntimeReferenceViewData: () => mockUseResolvedTeamRuntimeReferenceData(),
}));

function buildReferenceDataMock() {
  return {
    activeMode: 'live' as const,
    activityStats: {},
    busy: false,
    canCreateSession: false,
    canCreateTemplate: false,
    canManageRuntime: false,
    canManageSessionEntries: false,
    conversationCards: agentTeamsConversationCards,
    createSession: vi.fn(async () => false),
    createTemplate: vi.fn(async () => false),
    createWorkspace: vi.fn(async () => false),
    createTask: vi.fn(async () => false),
    defaultSelectedAgentId: agentTeamsRoleChips[0]?.id ?? 'leader',
    defaultSelectedTeamId: agentTeamsRunningTeams[0]?.id ?? 'team-research',
    deleteSession: vi.fn(async () => false),
    error: null,
    feedback: null,
    footerLead: agentTeamsFooterLead,
    footerStats: agentTeamsFooterStats,
    historyTeams: agentTeamsHistoryTeams,
    loading: false,
    messageCards: agentTeamsMessageCards,
    metricCards: agentTeamsMetricCards,
    moveTask: vi.fn(async () => false),
    officeAgents: agentTeamsOfficeAgents,
    overviewCards: agentTeamsOverviewCards,
    replyReview: vi.fn(async () => false),
    reviewBusy: false,
    reviewCards: agentTeamsReviewCards,
    roleChips: agentTeamsRoleChips,
    runningTeams: agentTeamsRunningTeams,
    selectTeam: vi.fn(),
    sendMessage: vi.fn(async () => false),
    sidebarSections: agentTeamsSidebarSections,
    submitReviewComment: vi.fn(async () => false),
    taskLanes: [
      { id: 'todo', title: '待办', cards: [] },
      { id: 'doing', title: '进行中', cards: [] },
      { id: 'review', title: '待评审', cards: [] },
    ],
    templateCount: agentTeamsSidebarSections.reduce(
      (count, section) => count + section.items.length,
      0,
    ),
    templateError: null,
    templateLoading: false,
    templates: [],
    timelineEvents: agentTeamsTimelineEvents,
    toggleSessionState: vi.fn(async () => false),
    topSummary: {
      description: '当前已接入真实 Team Runtime 视图。',
      memberCount: '4 成员',
      onlineCount: '0 在线',
      status: '已暂停',
      title: '研究团队-2026-03-31',
    },
    workspaceGroups: agentTeamsWorkspaceGroups,
    workspaces: [],
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderPage() {
  const { default: TeamPage } = await import('./TeamPage.js');
  await act(async () => {
    root?.render(
      <MemoryRouter initialEntries={['/team']}>
        <TeamPage />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickSidebarSession(label: string) {
  const sessionButton = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLElement | undefined;

  expect(sessionButton).toBeTruthy();

  await act(async () => {
    sessionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function clickTab(label: string) {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  ) as HTMLButtonElement | undefined;

  expect(button).toBeTruthy();

  await act(async () => {
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  mockUseTeamWorkspaceState.mockReturnValue({
    activeWorkspace: null,
    error: null,
    loading: false,
    refresh: vi.fn(),
    workspaces: [],
  });
  mockUseTeamWorkspaceSnapshotState.mockReturnValue({
    error: null,
    loading: false,
    snapshot: null,
  });
  mockUseResolvedTeamRuntimeReferenceData.mockReturnValue(buildReferenceDataMock());
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe('TeamPage office reference detail', () => {
  it('renders the left template rail and visible template groups', async () => {
    await renderPage();

    expect(container?.textContent).toContain('会话');
    expect(container?.textContent).toContain('模板');
    expect(container?.textContent).toContain('OpenAWork');
    expect(container?.textContent).toContain('windsurf_openai_api');
    expect(container?.textContent).toContain('未绑定工作区');
    expect(container?.textContent).toContain('运行中');
    expect(container?.textContent).toContain('研究团队');
    expect(container?.textContent).toContain('短视频学习助手开...');
    expect(container?.textContent).toContain('轻量讲解有官网搭...');
  });

  it('renders the top office controls and role chips', async () => {
    await renderPage();

    expect(container?.textContent).toContain('运行状态由共享会话驱动');
    expect(container?.textContent).toContain('团队负责人');
    expect(container?.textContent).toContain('研究员A');
    expect(container?.textContent).toContain('研究员B');
    expect(container?.textContent).toContain('批评者');
    expect(container?.textContent).toContain('Leader');
    expect(container?.textContent).toContain('弹出');
  });

  it('renders deeper office scene labels and stacked agent notes', async () => {
    await renderPage();

    expect(container?.textContent).toContain('POWER_BAR');
    expect(container?.textContent).toContain('等待他的批准');
    expect(container?.textContent).toContain('场景控制');
    expect(container?.textContent).toContain('场景信息');
    expect(container?.textContent).toContain('在线角色0/3');
    expect(container?.textContent).toContain('休息中');
  });

  it('updates the right-side session context when selecting another sidebar session', async () => {
    await renderPage();

    expect(container?.textContent).toContain('当前会话研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前会话开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前会话研究团队-2026-03-31');
  });

  it('updates the overview tab summary when selecting another sidebar session', async () => {
    await renderPage();

    await clickTab('状态总览');
    expect(container?.textContent).toContain('当前会话摘要');
    expect(container?.textContent).toContain('研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前会话摘要');
    expect(container?.textContent).toContain('开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前会话摘要研究团队-2026-03-31');
  });

  it('updates the conversation tab session summary when selecting another sidebar session', async () => {
    await renderPage();

    await clickTab('对话');
    expect(container?.textContent).toContain('当前对话会话');
    expect(container?.textContent).toContain('研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前对话会话');
    expect(container?.textContent).toContain('开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前对话会话研究团队-2026-03-31');
  });

  it('updates the tasks tab session summary when selecting another sidebar session', async () => {
    await renderPage();

    await clickTab('任务');
    expect(container?.textContent).toContain('当前任务会话');
    expect(container?.textContent).toContain('研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前任务会话');
    expect(container?.textContent).toContain('开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前任务会话研究团队-2026-03-31');
  });

  it('updates the messages tab session summary when selecting another sidebar session', async () => {
    await renderPage();

    await clickTab('消息');
    expect(container?.textContent).toContain('当前消息会话');
    expect(container?.textContent).toContain('研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前消息会话');
    expect(container?.textContent).toContain('开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前消息会话研究团队-2026-03-31');
  });

  it('updates the review tab session summary when selecting another sidebar session', async () => {
    await renderPage();

    await clickTab('评审');
    expect(container?.textContent).toContain('当前评审会话');
    expect(container?.textContent).toContain('研究团队-2026-03-31');

    await clickSidebarSession('开发团队-2026-04-01');

    expect(container?.textContent).toContain('当前评审会话');
    expect(container?.textContent).toContain('开发团队-2026-04-01');
    expect(container?.textContent).not.toContain('当前评审会话研究团队-2026-03-31');
  });

  it('uses the first workspace id to initialize the snapshot chain before route redirect completes', async () => {
    mockUseTeamWorkspaceState.mockReturnValue({
      activeWorkspace: null,
      error: null,
      loading: false,
      refresh: vi.fn(),
      workspaces: [
        {
          id: 'workspace-1',
          name: '默认工作区',
          description: null,
          visibility: 'private',
          defaultWorkingRoot: '/workspace/default',
          createdByUserId: 'user-1',
          createdAt: '2026-04-04T00:00:00.000Z',
          updatedAt: '2026-04-04T00:00:00.000Z',
        },
      ],
    });

    await renderPage();

    expect(mockUseTeamWorkspaceSnapshotState).toHaveBeenCalledWith('workspace-1');
  });
});
