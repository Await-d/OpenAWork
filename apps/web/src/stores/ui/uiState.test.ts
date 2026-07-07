import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  REVIEW_PANEL_WIDTH_BOUNDS,
  SIDEBAR_PANEL_WIDTH_BOUNDS,
  TERMINAL_PANEL_HEIGHT_BOUNDS,
  clampReviewPanelWidth,
  clampSidebarPanelWidth,
  clampTerminalPanelHeight,
  useUIStateStore,
} from './uiState.js';

function resetLayoutState(): void {
  useUIStateStore.setState({
    activeTabId: null,
    reviewPanelOpened: false,
    reviewPanelWidth: REVIEW_PANEL_WIDTH_BOUNDS.default,
    sidebarPanelOpened: true,
    sidebarPanelWidth: SIDEBAR_PANEL_WIDTH_BOUNDS.default,
    tabs: [],
    teamEditorMode: 'overlay',
    teamSplitPos: 50,
    terminalPanelHeight: TERMINAL_PANEL_HEIGHT_BOUNDS.default,
    terminalPanelOpened: false,
    workbenchLayoutMode: 'fusion',
  });
}

beforeEach(resetLayoutState);
afterEach(resetLayoutState);

describe('useUIStateStore tabs', () => {
  it('复用已打开的 session tab 并更新标题', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '旧标题');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-1', '新标题');

    const state = useUIStateStore.getState();
    expect(secondTabId).toBe(firstTabId);
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]?.title).toBe('新标题');
    expect(state.activeTabId).toBe(firstTabId);
  });

  it('关闭活跃 tab 后选择右侧相邻 tab', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    useUIStateStore.getState().selectTab(firstTabId);

    const nextTab = useUIStateStore.getState().closeTab(firstTabId);

    expect(nextTab?.id).toBe(secondTabId);
    expect(useUIStateStore.getState().activeTabId).toBe(secondTabId);
  });

  it('按方向循环选择相邻 tab', () => {
    const firstTabId = useUIStateStore.getState().addDraftTab();
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');
    useUIStateStore.getState().selectTab(secondTabId);

    const nextTab = useUIStateStore.getState().selectAdjacentTab('next');

    expect(nextTab?.id).toBe(firstTabId);
    expect(useUIStateStore.getState().activeTabId).toBe(firstTabId);
  });

  it('支持拖拽后的顺序重排', () => {
    const firstTabId = useUIStateStore.getState().addSessionTab('s-1', '会话一');
    const secondTabId = useUIStateStore.getState().addSessionTab('s-2', '会话二');

    useUIStateStore.getState().reorderTabs(0, 1);

    expect(useUIStateStore.getState().tabs.map((tab) => tab.id)).toEqual([secondTabId, firstTabId]);
  });
});

describe('sidebar panel width', () => {
  it('把侧栏面板宽度夹在持久化范围内', () => {
    expect(clampSidebarPanelWidth(10)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.min);
    expect(clampSidebarPanelWidth(9999)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.max);
    expect(clampSidebarPanelWidth(Number.NaN)).toBe(SIDEBAR_PANEL_WIDTH_BOUNDS.default);
  });
});

describe('chat panels state', () => {
  it('把审阅面板宽度和终端面板高度夹在持久化范围内', () => {
    expect(clampReviewPanelWidth(10)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.min);
    expect(clampReviewPanelWidth(9999)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.max);
    expect(clampReviewPanelWidth(Number.NaN)).toBe(REVIEW_PANEL_WIDTH_BOUNDS.default);

    expect(clampTerminalPanelHeight(10)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.min);
    expect(clampTerminalPanelHeight(9999)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.max);
    expect(clampTerminalPanelHeight(Number.NaN)).toBe(TERMINAL_PANEL_HEIGHT_BOUNDS.default);
  });

  it('持久化审阅与终端面板的开关状态', () => {
    useUIStateStore.getState().toggleReviewPanelOpened();
    useUIStateStore.getState().setTerminalPanelOpened(true);

    expect(useUIStateStore.getState().reviewPanelOpened).toBe(true);
    expect(useUIStateStore.getState().terminalPanelOpened).toBe(true);
  });
});

describe('workbench layout state', () => {
  it('保留 classic/fusion 切换和 Team 编辑器布局偏好', () => {
    useUIStateStore.getState().setWorkbenchLayoutMode('classic');
    useUIStateStore.getState().setTeamEditorMode('split');
    useUIStateStore.getState().setTeamSplitPos(90);

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('classic');
    expect(useUIStateStore.getState().teamEditorMode).toBe('split');
    expect(useUIStateStore.getState().teamSplitPos).toBe(80);

    useUIStateStore.getState().setWorkbenchLayoutMode('fusion');
    useUIStateStore.getState().setTeamSplitPos(10);

    expect(useUIStateStore.getState().workbenchLayoutMode).toBe('fusion');
    expect(useUIStateStore.getState().teamSplitPos).toBe(20);
  });
});
