// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMiddleTabContent, type MiddleTabRenderArgs } from './MiddleTabRouter.js';

const childState = vi.hoisted(() => ({
  health: null as null | {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  },
  usage: null as null | { selectedSessionId?: string | null; selectedSessionTitle?: string | null },
  timing: null as null | {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  },
  audit: null as null | { selectedSessionId?: string | null; selectedSessionTitle?: string | null },
  graph: null as null | { selectedSessionId?: string | null },
  init: null as null | { sessionId?: string | null },
  sharedGraph: 0,
  sharedInit: 0,
  artifacts: null as null | { selectedTeamId: string },
  review: null as null | { selectedTeamId: string },
  reviewQueue: 0,
  sharedFlow: 0,
  sharedLayered: 0,
  flow: null as null | { selectedTeam?: { id: string; title: string } | null },
  layered: null as null | { selectedTeam?: { id: string; title: string } | null },
  messages: null as null | { selectedTeam?: { id: string; title: string } | null },
  placeholderTitles: [] as string[],
}));

vi.mock('./overview/HealthView.js', () => ({
  HealthView: (props: {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  }) => {
    childState.health = props;
    return <div data-testid="health-view" />;
  },
}));

vi.mock('./metrics/UsageView.js', () => ({
  UsageView: (props: {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  }) => {
    childState.usage = props;
    return <div data-testid="usage-view" />;
  },
}));

vi.mock('./metrics/TimingView.js', () => ({
  TimingView: (props: {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  }) => {
    childState.timing = props;
    return <div data-testid="timing-view" />;
  },
}));

vi.mock('./governance/AuditView.js', () => ({
  AuditView: (props: {
    selectedSessionId?: string | null;
    selectedSessionTitle?: string | null;
  }) => {
    childState.audit = props;
    return <div data-testid="audit-view" />;
  },
}));

vi.mock('./overview/WorkspaceKnowledgeGraphView.js', () => ({
  WorkspaceKnowledgeGraphView: (props: { selectedSessionId?: string | null }) => {
    childState.graph = props;
    return <div data-testid="graph-view" />;
  },
}));

vi.mock('./overview/SharedSessionGraphView.js', () => ({
  SharedSessionGraphView: () => {
    childState.sharedGraph += 1;
    return <div data-testid="shared-graph-view" />;
  },
}));

vi.mock('./overview/TeamInitSummaryPanel.js', () => ({
  TeamInitSummaryPanel: (props: { sessionId?: string | null }) => {
    childState.init = props;
    return <div data-testid="init-view" />;
  },
}));

vi.mock('./overview/SharedSessionInitView.js', () => ({
  SharedSessionInitView: () => {
    childState.sharedInit += 1;
    return <div data-testid="shared-init-view" />;
  },
}));

vi.mock('./tasks/TeamArtifactSection.js', () => ({
  TeamArtifactSection: (props: { selectedTeamId: string }) => {
    childState.artifacts = props;
    return <div data-testid="artifact-view" />;
  },
}));

vi.mock('./tasks/ReviewMergedTab.js', () => ({
  ReviewMergedTab: (props: { selectedTeamId: string }) => {
    childState.review = props;
    return <div data-testid="review-view" />;
  },
}));

vi.mock('./tasks/ReviewTab.js', () => ({
  ReviewTab: () => {
    childState.reviewQueue += 1;
    return <div data-testid="review-queue-view" />;
  },
}));

vi.mock('./office/OfficeThreeCanvas.js', () => ({
  OfficeThreeCanvas: () => <div data-testid="office-view" />,
}));
vi.mock('./conversation/shared-session-flow-view.js', () => ({
  SharedSessionFlowView: () => {
    childState.sharedFlow += 1;
    return <div data-testid="shared-flow-view" />;
  },
}));
vi.mock('./conversation/shared-session-layered-view.js', () => ({
  SharedSessionLayeredView: () => {
    childState.sharedLayered += 1;
    return <div data-testid="shared-layered-view" />;
  },
}));
vi.mock('./overview/OverviewTab.js', () => ({
  OverviewTab: () => <div data-testid="overview-view" />,
}));
vi.mock('./conversation/MessagesMergedTab.js', () => ({
  MessagesMergedTab: (props: { selectedTeam?: { id: string; title: string } | null }) => {
    childState.messages = props;
    return <div data-testid="messages-view" />;
  },
}));
vi.mock('./governance/team-runtime-settings-panel.js', () => ({
  TeamRuntimeSettingsPanel: () => <div data-testid="settings-view" />,
}));
vi.mock('./TabPlaceholder.js', () => ({
  TabPlaceholder: ({ title }: { title: string }) => {
    childState.placeholderTitles.push(title);
    return <div data-testid="placeholder-view">{title}</div>;
  },
}));
vi.mock('./TabContainer.js', () => ({
  TabContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tab-container">{children}</div>
  ),
}));
vi.mock('./conversation/LayeredConversationView.js', () => ({
  LayeredConversationView: (props: { selectedTeam?: { id: string; title: string } | null }) => {
    childState.layered = props;
    return <div data-testid="layered-view" />;
  },
}));
vi.mock('./conversation/LayerFlowView.js', () => ({
  LayerFlowView: (props: { selectedTeam?: { id: string; title: string } | null }) => {
    childState.flow = props;
    return <div data-testid="flow-view" />;
  },
}));
vi.mock('./governance/SharesView.js', () => ({
  SharesView: () => <div data-testid="shares-view" />,
}));
vi.mock('./governance/TemplatesTab.js', () => ({
  TemplatesTab: () => <div data-testid="templates-view" />,
}));

beforeEach(() => {
  cleanup();
  childState.health = null;
  childState.usage = null;
  childState.timing = null;
  childState.audit = null;
  childState.graph = null;
  childState.init = null;
  childState.sharedGraph = 0;
  childState.sharedInit = 0;
  childState.sharedFlow = 0;
  childState.sharedLayered = 0;
  childState.flow = null;
  childState.layered = null;
  childState.messages = null;
  childState.artifacts = null;
  childState.review = null;
  childState.reviewQueue = 0;
  childState.placeholderTitles = [];
});

afterEach(() => {
  cleanup();
});

function buildArgs(overrides: Partial<MiddleTabRenderArgs> = {}): MiddleTabRenderArgs {
  return {
    middleTab: 'health',
    selectedAgentId: 'agent-1',
    selectedTeamId: 'shared-1',
    selectedTeam: {
      id: 'shared-1',
      isSharedSession: true,
      status: 'running',
      subtitle: '共享运行',
      title: '共享会话 A',
    },
    officeSceneState: {} as MiddleTabRenderArgs['officeSceneState'],
    onSelectTeam: vi.fn(),
    onSelectAgent: vi.fn(),
    onOpenFullscreen: vi.fn(),
    onOpenClarifications: vi.fn(),
    onOpenHandoffContext: vi.fn(),
    onOpenBlockingTarget: vi.fn(),
    onClearFocusedHandoff: vi.fn(),
    onSelectLayerSession: vi.fn(),
    onCancelHandoff: vi.fn(),
    handoffs: new Map(),
    gatewayUrl: 'https://gateway.test',
    accessToken: 'token-test',
    activeWorkspaceName: '团队工作区',
    teamWorkspaceId: 'workspace-1',
    ...overrides,
  };
}

describe('renderMiddleTabContent', () => {
  it('选中共享会话时，health / usage / timing 会走共享链路', () => {
    render(renderMiddleTabContent(buildArgs({ middleTab: 'health' })));
    expect(screen.getByTestId('health-view')).toBeTruthy();
    expect(childState.health).toMatchObject({
      selectedSessionId: 'shared-1',
      selectedSessionTitle: '共享会话 A',
    });

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'usage' })));
    expect(screen.getByTestId('usage-view')).toBeTruthy();
    expect(childState.usage).toMatchObject({
      selectedSessionId: 'shared-1',
      selectedSessionTitle: '共享会话 A',
    });

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'timing' })));
    expect(screen.getByTestId('timing-view')).toBeTruthy();
    expect(childState.timing).toMatchObject({
      selectedSessionId: 'shared-1',
      selectedSessionTitle: '共享会话 A',
    });

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'audit' })));
    expect(screen.getByTestId('audit-view')).toBeTruthy();
    expect(childState.audit).toMatchObject({
      selectedSessionId: 'shared-1',
      selectedSessionTitle: '共享会话 A',
    });
  });

  it('选中共享会话时，图谱 / 初始化仍不会误用共享 sessionId 作为 runtime 根，任务产物和评审会走共享链路', () => {
    render(renderMiddleTabContent(buildArgs({ middleTab: 'graph' })));
    expect(screen.getByTestId('shared-graph-view')).toBeTruthy();
    expect(childState.graph).toBeNull();
    expect(childState.sharedGraph).toBe(1);

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'init' })));
    expect(screen.getByTestId('shared-init-view')).toBeTruthy();
    expect(childState.init).toBeNull();
    expect(childState.sharedInit).toBe(1);

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'artifacts' })));
    expect(screen.getByTestId('artifact-view')).toBeTruthy();
    expect(childState.artifacts).toMatchObject({ selectedTeamId: 'shared-1' });

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'review' })));
    expect(screen.getByTestId('review-queue-view')).toBeTruthy();
    expect(childState.reviewQueue).toBe(1);
    expect(childState.review).toBeNull();
  });

  it('选中共享会话时，flow / layered 会走共享专属视图，而不是本地 runtime 层级对话', () => {
    render(renderMiddleTabContent(buildArgs({ middleTab: 'flow' })));
    expect(screen.getByTestId('shared-flow-view')).toBeTruthy();
    expect(childState.sharedFlow).toBe(1);
    expect(childState.flow).toBeNull();

    cleanup();
    render(renderMiddleTabContent(buildArgs({ middleTab: 'layered' })));
    expect(screen.getByTestId('shared-layered-view')).toBeTruthy();
    expect(childState.sharedLayered).toBe(1);
    expect(childState.layered).toBeNull();
  });

  it('普通会话的 flow / layered / messages 会收到当前 selectedTeam，确保切换会话后按会话树收缩', () => {
    const selectedTeam = {
      id: 'session-runtime-1',
      status: 'running' as const,
      subtitle: 'PM1 · 运行中',
      title: '运行会话 1',
    };

    render(
      renderMiddleTabContent(
        buildArgs({
          middleTab: 'flow',
          selectedTeamId: selectedTeam.id,
          selectedTeam,
        }),
      ),
    );
    expect(screen.getByTestId('flow-view')).toBeTruthy();
    expect(childState.flow?.selectedTeam).toMatchObject({
      id: 'session-runtime-1',
      title: '运行会话 1',
    });
    expect(childState.sharedFlow).toBe(0);

    cleanup();
    render(
      renderMiddleTabContent(
        buildArgs({
          middleTab: 'layered',
          selectedTeamId: selectedTeam.id,
          selectedTeam,
        }),
      ),
    );
    expect(screen.getByTestId('layered-view')).toBeTruthy();
    expect(childState.layered?.selectedTeam).toMatchObject({
      id: 'session-runtime-1',
      title: '运行会话 1',
    });
    expect(childState.sharedLayered).toBe(0);

    cleanup();
    render(
      renderMiddleTabContent(
        buildArgs({
          middleTab: 'messages',
          selectedTeamId: selectedTeam.id,
          selectedTeam,
        }),
      ),
    );
    expect(screen.getByTestId('messages-view')).toBeTruthy();
    expect(childState.messages?.selectedTeam).toMatchObject({
      id: 'session-runtime-1',
      title: '运行会话 1',
    });
  });
});
