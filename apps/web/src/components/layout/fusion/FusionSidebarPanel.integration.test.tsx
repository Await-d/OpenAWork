// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import type { Session } from '../../../hooks/workspace/useSessions.js';
import type {
  WorkspaceSessionGroup,
  WorkspaceSessionTreeGroup,
} from '../../../utils/session/session-grouping.js';
import { UNBOUND_WORKSPACE_LABEL } from '../../../utils/session/session-grouping.js';
import {
  getFusionSidebarMocks,
  MARKET_PATH,
  OPENAWORK_PATH,
  prepareFusionSidebarMocks,
  renderFusionSidebar,
  resetFusionSidebarUiState,
  setFusionSidebarChatGroups,
} from './FusionSidebar.test-utils.js';

function createSession(id: string, title: string, workspacePath: string): Session {
  return {
    id,
    metadata_json: JSON.stringify({ workingDirectory: workspacePath }),
    state_status: 'idle',
    title,
    updated_at: '2026-07-07T08:00:00.000Z',
  };
}

function installPointerCaptureStubs(): void {
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
}

function installMatchMedia(width: number): () => void {
  const originalMatchMedia = window.matchMedia;

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const maxWidth = /max-width:\s*(\d+)px/.exec(query)?.[1];
      const matches = maxWidth ? width <= Number(maxWidth) : false;

      return {
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      };
    }),
  });

  return () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia,
    });
  };
}

beforeEach(() => {
  cleanup();
  prepareFusionSidebarMocks(true);
});

afterEach(() => {
  cleanup();
  resetFusionSidebarUiState(false);
});

describe('FusionSidebar 展开 Panel', () => {
  it('点击新建会话走统一 newSession 入口并回到 Chat 首页', async () => {
    const sessionsResult = setFusionSidebarChatGroups([], []);
    renderFusionSidebar('/chat/open-session');

    fireEvent.click(screen.getByRole('button', { name: '新建会话' }));

    expect(useUIStateStore.getState().chatView).toBe('home');
    expect(useUIStateStore.getState().tabs.some((tab) => tab.type === 'draft')).toBe(true);
    expect(sessionsResult.newSession).toHaveBeenCalledWith();
    expect(getFusionSidebarMocks().preloadRouteModuleByPath).toHaveBeenCalledWith('/chat');
  });

  it('未指定工作区提供快捷新建会话入口', () => {
    const sessionsResult = setFusionSidebarChatGroups(
      [
        {
          sessions: [],
          workspaceLabel: UNBOUND_WORKSPACE_LABEL,
          workspacePath: null,
        },
      ],
      [
        {
          roots: [],
          sessions: [],
          workspaceLabel: UNBOUND_WORKSPACE_LABEL,
          workspacePath: null,
        },
      ],
    );

    renderFusionSidebar('/chat/open-session');

    fireEvent.click(
      screen.getByRole('button', { name: `在 ${UNBOUND_WORKSPACE_LABEL} 中新建会话` }),
    );

    expect(sessionsResult.newSession).toHaveBeenCalledWith(null);
  });

  it('选择团队会话时保留 Team 工作台上下文', async () => {
    renderFusionSidebar('/team');

    fireEvent.click(screen.getByRole('button', { name: 'Alpha kickoff' }));

    const signal = useUIStateStore.getState().teamSelectSessionSignal;
    expect(signal?.teamWorkspaceId).toBe('workspace-alpha');
    expect(signal?.sessionId).toBe('team-session-1');
    await waitFor(() => {
      expect(screen.getByTestId('location-probe').textContent).toBe(
        '/team/workspace-alpha?sessionId=team-session-1',
      );
    });
    expect(getFusionSidebarMocks().preloadRouteModuleByPath).toHaveBeenCalledWith('/team');
  });

  it('团队没有工作区或会话时仍展示团队分区', () => {
    getFusionSidebarMocks().useTeamSidebarSessions.mockReturnValue({
      error: null,
      loading: false,
      refresh: () => undefined,
      sessions: [],
      workspaceGroups: [],
      workspaces: [],
    });

    renderFusionSidebar('/team');

    expect(screen.getByText('暂无团队工作空间')).not.toBeNull();
  });

  it('点击会话行收起 Panel 后，焦点不会残留在 aria-hidden 容器内', () => {
    renderFusionSidebar('/chat/open-session');

    // 将焦点放到 Panel 内的会话按钮上
    const sessionButton = screen.getByRole('button', { name: 'OpenAWork plan' });
    sessionButton.focus();
    expect(document.activeElement).toBe(sessionButton);

    // 通过"收起面板"按钮关闭 Panel（openChatSession 不再关闭 Panel，
    // Panel 收起必须由用户主动点击收起按钮触发）
    fireEvent.click(screen.getByRole('button', { name: '收起面板' }));

    expect(useUIStateStore.getState().leftSidebarOpen).toBe(false);
    const hiddenPanel = document.querySelector('[data-fusion-sidebar-panel="true"]');
    expect(hiddenPanel).not.toBeNull();
    expect(hiddenPanel?.getAttribute('aria-hidden')).toBe('true');
    expect(hiddenPanel?.contains(document.activeElement)).toBe(false);
  });

  it('紧凑视口下通过抽屉承载 Panel，并支持打开后关闭', () => {
    const restoreMatchMedia = installMatchMedia(640);
    prepareFusionSidebarMocks(false);

    try {
      renderFusionSidebar('/chat/open-session');

      expect(screen.getByRole('button', { name: '展开会话侧栏' })).not.toBeNull();
      expect(screen.queryByRole('dialog', { name: '会话侧栏' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '展开会话侧栏' }));

      expect(screen.getByRole('dialog', { name: '会话侧栏' })).not.toBeNull();
      expect(screen.getByRole('button', { name: '关闭会话侧栏' })).not.toBeNull();

      fireEvent.click(screen.getByRole('button', { name: '关闭会话侧栏' }));

      expect(screen.queryByRole('dialog', { name: '会话侧栏' })).toBeNull();
      expect(screen.getByRole('button', { name: '展开会话侧栏' })).not.toBeNull();
    } finally {
      restoreMatchMedia();
    }
  });

  it('搜索态只渲染命中分组，计数使用命中数', () => {
    const hitSession = createSession('open-session', 'OpenAWork plan', OPENAWORK_PATH);
    const missedSession = createSession('market-session', 'Market roadmap', MARKET_PATH);
    const unfilteredGroups: WorkspaceSessionGroup<Session>[] = [
      { sessions: [hitSession], workspaceLabel: 'OpenAWork', workspacePath: OPENAWORK_PATH },
      { sessions: [missedSession], workspaceLabel: 'MarketAgent', workspacePath: MARKET_PATH },
    ];
    const filteredTrees: WorkspaceSessionTreeGroup<Session>[] = [
      {
        roots: [{ children: [], session: hitSession }],
        sessions: [hitSession],
        workspaceLabel: 'OpenAWork',
        workspacePath: OPENAWORK_PATH,
      },
    ];

    setFusionSidebarChatGroups(unfilteredGroups, filteredTrees, { sessionSearch: 'plan' });

    renderFusionSidebar('/chat/open-session');

    expect(
      document.getElementById(`fusion-session-group-${encodeURIComponent(OPENAWORK_PATH)}`),
    ).not.toBeNull();
    expect(
      document.getElementById(`fusion-session-group-${encodeURIComponent(MARKET_PATH)}`),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Market roadmap' })).toBeNull();
    expect(screen.getByTitle('匹配 1 个会话')).not.toBeNull();
  });

  it('首次加载且无数据时展示骨架行', () => {
    setFusionSidebarChatGroups([], [], { isLoadingSessions: true });

    renderFusionSidebar('/chat/open-session');

    expect(document.querySelector('.sidebar-skeleton')).not.toBeNull();
    expect(screen.queryByText('暂无会话')).toBeNull();
  });

  it('加载失败时展示错误态并可重试', () => {
    const sessionsResult = setFusionSidebarChatGroups([], [], {
      sessionsError: '会话列表加载失败',
    });

    renderFusionSidebar('/chat/open-session');

    expect(screen.getByText('会话列表加载失败')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    expect(sessionsResult.fetchSessions).toHaveBeenCalledTimes(1);
  });

  it('无会话时展示空态与新建入口', () => {
    setFusionSidebarChatGroups([], []);

    renderFusionSidebar('/chat/open-session');

    expect(screen.getByText('暂无会话')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '立即新建' }));

    expect(useUIStateStore.getState().chatView).toBe('home');
  });

  it('工作区分组按钮暴露 aria-expanded 与可用的 aria-controls 目标', () => {
    renderFusionSidebar('/chat/open-session');

    const bodyId = `fusion-session-group-${encodeURIComponent(OPENAWORK_PATH)}`;
    expect(document.getElementById(bodyId)).not.toBeNull();

    const toggle = document.querySelector(`[aria-controls="${bodyId}"]`);
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
  });

  it('拖拽侧栏手柄调整宽度并持久化到 store', () => {
    installPointerCaptureStubs();
    useUIStateStore.setState({ sidebarPanelWidth: 288 });

    renderFusionSidebar('/chat/open-session');

    const handle = screen.getByRole('separator', { name: '调整会话侧栏宽度' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 360, pointerId: 1 });

    expect(useUIStateStore.getState().sidebarPanelWidth).toBe(348);
  });
});
