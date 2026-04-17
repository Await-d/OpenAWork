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

vi.mock('./team/runtime/OfficeThreeCanvas.js', () => ({
  OfficeThreeCanvas: () => (
    <div data-testid="office-three-canvas">
      <span>场景控制</span>
      <span>当前缩放100%</span>
      <span>POWER_BAR</span>
    </div>
  ),
}));

const mockUseResolvedTeamRuntimeReferenceData = vi.fn();

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

describe('TeamPage office reference layout', () => {
  it('renders the official Agent Teams office shell', async () => {
    await renderPage();

    expect(container?.textContent).toContain('AGENT TEAMS');
    expect(container?.textContent).toContain('研究团队-2026-03-31');
    expect(container?.textContent).toContain('已暂停');
    expect(container?.textContent).toContain('4 成员');
    expect(container?.textContent).toContain('0 在线');
    expect(container?.textContent).toContain('新建会话');
    expect(container?.textContent).toContain('OpenAWork');
    expect(container?.textContent).toContain('活跃 3 / 共 135');
    expect(container?.textContent).toContain('运行 16m 41s');
    expect(container?.textContent).toContain('模板');
  });

  it('renders the office tab by default with the pixel office scene labels', async () => {
    await renderPage();

    expect(container?.textContent).toContain('场景控制');
    expect(container?.textContent).toContain('当前缩放100%');
    expect(container?.textContent).toContain('[L] 团队负责人');
    expect(container?.textContent).toContain('研究员A');
    expect(container?.textContent).toContain('批评者');
    expect(container?.textContent).toContain('场景信息');
  });

  it('switches top tabs to the other placeholder panels', async () => {
    await renderPage();

    await clickTab('对话');
    expect(container?.textContent).toContain('团队对话');
    expect(container?.textContent).toContain('提问');

    await clickTab('任务');
    expect(container?.textContent).toContain('待办');
    expect(container?.textContent).toContain('进行中');

    await clickTab('消息');
    expect(container?.textContent).toContain('消息总线');

    await clickTab('状态总览');
    expect(container?.textContent).toContain('状态总览');
    expect(container?.textContent).toContain('页面还原度');

    await clickTab('评审');
    expect(container?.textContent).toContain('顶部团队条对齐度');
  });
});
