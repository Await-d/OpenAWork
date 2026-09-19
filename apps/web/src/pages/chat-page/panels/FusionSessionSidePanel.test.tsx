// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HttpError } from '@openAwork/web-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionDockedSidePanel } from './FusionDockedSidePanel.js';
import {
  FusionSessionSidePanel,
  type FusionSessionSidePanelProps,
} from './FusionSessionSidePanel.js';
import {
  makeReviewPanelDiffEntry,
  makeReviewPanelProjection,
  makeReviewPanelSnapshot,
} from './review-panel-test-fixtures.js';

const getFileChangesMock = vi.fn();
const reviewFileChangeMock = vi.fn();
const toastMock = vi.hoisted(() => vi.fn());

vi.mock('@openAwork/web-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@openAwork/web-client')>();
  return {
    ...actual,
    createSessionsClient: () => ({
      getFileChanges: getFileChangesMock,
      reviewFileChange: reviewFileChangeMock,
    }),
  };
});

vi.mock('../../../components/common/feedback/ToastNotification.js', () => ({
  toast: toastMock,
}));

vi.mock('@openAwork/shared-ui', () => ({
  ContextPanel: () => <div data-testid="context-panel-mock" />,
  PlanHistoryPanel: () => <div data-testid="plan-history-panel-mock" />,
  UnifiedCodeDiff: (props: { readonly afterText?: string; readonly beforeText?: string }) => (
    <pre>{props.afterText ?? props.beforeText ?? ''}</pre>
  ),
}));

vi.mock('../../../components/file-editor/editor/FileEditorPanel.js', () => ({
  FileEditorPanel: () => <div data-testid="file-editor-panel-mock" />,
}));

vi.mock('../../../components/chat/misc/BuiltInBrowser.js', () => ({
  BuiltInBrowser: (props: { readonly hidden?: boolean }) => (
    <div data-hidden={props.hidden ? 'true' : 'false'} data-testid="built-in-browser-mock" />
  ),
}));

vi.mock('./sub-session-detail-panel.js', () => ({
  SubSessionDetailPanel: (props: {
    readonly childSessionId: string | null;
    readonly currentUserEmail: string;
  }) => (
    <div
      data-child-session-id={props.childSessionId ?? 'none'}
      data-current-user-email={props.currentUserEmail}
      data-testid="sub-session-detail-panel-mock"
    />
  ),
}));

function resetUiState(): void {
  useUIStateStore.setState({
    // 桌面 Fusion 下宿主面由 ChatPage 按「谁可见」派生：未提升时归停靠面板。
    browserPreviewSurface: 'dock',
    browserPreviewUrlByWorkspace: {},
    reviewPanelOpened: true,
    reviewPanelWidth: 400,
    fusionDockSplitPos: 35,
    sidePanelActiveTab: 'review',
  });
}

const WORKSPACE_PATH = '/home/await/project/OpenAWork';
const PREVIEW_URL = 'http://localhost:3000';

function setPreviewUrl(url: string): void {
  useUIStateStore.setState({ browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: url } });
}

function readFileEditor() {
  return {
    activeFile: null,
    activeFilePath: null,
    closeFile: () => undefined,
    isDirty: () => false,
    openFiles: [],
    saveError: null,
    setActiveFilePath: () => undefined,
    updateContent: () => undefined,
  };
}

function createBaseProps(): Omit<FusionSessionSidePanelProps, 'activeTab'> {
  return {
    contextUsageSnapshot: null,
    currentSessionId: 'session-1',
    currentUserEmail: 'user@example.com',
    effectiveWorkingDirectory: WORKSPACE_PATH,
    fileEditor: readFileEditor(),
    fileTree: <div data-testid="dock-file-tree" />,
    gatewayUrl: 'http://localhost:3000',
    handleSaveFile: async () => undefined,
    onCompactSession: () => undefined,
    onOpenFullSession: () => undefined,
    onPromoteToFullScreen: () => undefined,
    onTabChange: () => undefined,
    saving: false,
    selectedChildSessionId: null,
    token: 'token',
    workspaceFileItems: [],
    workspacePath: WORKSPACE_PATH,
  };
}

const RUNTIME_SUMMARY = {
  activePlanTaskCount: 2,
  childSessionCount: 1,
  dagEdgeCount: 2,
  dagNodeCount: 3,
  failedToolCallCount: 1,
  mcpServerCount: 4,
  pendingPermissionCount: 1,
  toolCallCount: 5,
  totalPlanTaskCount: 6,
} as const;

const confirmMock = vi.fn(() => false);

beforeEach(() => {
  cleanup();
  getFileChangesMock.mockReset();
  reviewFileChangeMock.mockReset();
  toastMock.mockReset();
  confirmMock.mockReset();
  confirmMock.mockReturnValue(false);
  vi.stubGlobal('confirm', confirmMock);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
  resetUiState();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetUiState();
});

describe('FusionSessionSidePanel', () => {
  it('在审查 tab 展示真实变更数量与 diff 内容', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/app.ts', {
          additions: 3,
          after: 'export const layout = "fusion";\n',
          deletions: 1,
        }),
        makeReviewPanelDiffEntry('src/team.ts', {
          additions: 1,
          deletions: 0,
        }),
      ]),
    );

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);

    await waitFor(() => {
      expect(screen.getAllByText('src/app.ts').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('tab', { name: /审查/ })[0]?.textContent).toContain('2');
    expect(screen.getByText('2 文件 · +4 / -1 · 强保证')).not.toBeNull();
    expect(screen.getByText(/export const layout/)).not.toBeNull();
  });

  it('桌面停靠面板提供 审查/子代理/代码/预览/Context 五个一级 tab 并上报切换动作', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="review"
        onTabChange={onTabChange}
      />,
    );

    const tablist = screen.getByRole('tablist', { name: '会话侧面板' });
    const reviewTab = screen.getByRole('tab', { name: '审查' });
    const agentTab = screen.getByRole('tab', { name: '子代理' });
    const codeTab = screen.getByRole('tab', { name: '代码' });
    const previewTab = screen.getByRole('tab', { name: '预览' });
    const contextTab = screen.getByRole('tab', { name: 'Context' });

    expect(tablist).not.toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '审查',
      '子代理',
      '代码',
      '预览',
      'Context',
    ]);
    expect(reviewTab.getAttribute('aria-selected')).toBe('true');
    expect(agentTab.getAttribute('aria-selected')).toBe('false');
    expect(codeTab.getAttribute('aria-selected')).toBe('false');
    expect(previewTab.getAttribute('aria-selected')).toBe('false');
    expect(contextTab.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(agentTab);
    expect(onTabChange).toHaveBeenCalledWith('agent');

    fireEvent.click(codeTab);
    expect(onTabChange).toHaveBeenLastCalledWith('code');

    fireEvent.click(previewTab);
    expect(onTabChange).toHaveBeenLastCalledWith('preview');

    fireEvent.click(contextTab);
    expect(onTabChange).toHaveBeenLastCalledWith('context');
  });

  it('子代理 tab 展示 subAgentCount 徽章', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" subAgentCount={2} />);

    expect(screen.getByRole('tab', { name: /子代理\s*2/ }).textContent).toContain('2');
  });

  it('子代理 tab 常驻挂载子会话详情面板，未激活时 hidden 且不打断其他 pane', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    const view = render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="review"
        selectedChildSessionId="child-session-1"
      />,
    );

    const agentPane = screen.getByTestId('fusion-panel-pane-agent');
    const detailPanel = screen.getByTestId('sub-session-detail-panel-mock');

    expect(agentPane.hasAttribute('hidden')).toBe(true);
    expect(agentPane.contains(detailPanel)).toBe(true);
    expect(detailPanel.getAttribute('data-child-session-id')).toBe('child-session-1');
    expect(detailPanel.getAttribute('data-current-user-email')).toBe('user@example.com');
    expect(screen.getByTestId('fusion-panel-pane-review').hasAttribute('hidden')).toBe(false);

    view.rerender(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="agent"
        selectedChildSessionId="child-session-1"
      />,
    );

    expect(screen.getByTestId('sub-session-detail-panel-mock')).toBe(detailPanel);
    expect(screen.getByTestId('fusion-panel-pane-agent').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('fusion-panel-pane-review').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('fusion-panel-pane-context').hasAttribute('hidden')).toBe(true);
  });

  it('agent 已是桌面一级 tab：直接选中子代理，不触发 tab 收敛', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel {...createBaseProps()} activeTab="agent" onTabChange={onTabChange} />,
    );

    expect(screen.getByRole('tab', { name: '子代理' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('fusion-panel-pane-agent').hasAttribute('hidden')).toBe(false);
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('侧栏 tab 支持方向键按 审查→子代理→代码→预览→Context 顺序切换焦点与激活目标', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="review"
        onTabChange={onTabChange}
      />,
    );

    const reviewTab = screen.getByRole('tab', { name: '审查' });
    const agentTab = screen.getByRole('tab', { name: '子代理' });
    const codeTab = screen.getByRole('tab', { name: '代码' });
    const previewTab = screen.getByRole('tab', { name: '预览' });
    const contextTab = screen.getByRole('tab', { name: 'Context' });

    reviewTab.focus();
    fireEvent.keyDown(reviewTab, { key: 'ArrowRight' });

    expect(onTabChange).toHaveBeenCalledWith('agent');
    expect(document.activeElement).toBe(agentTab);

    fireEvent.keyDown(agentTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('code');
    expect(document.activeElement).toBe(codeTab);

    fireEvent.keyDown(codeTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('preview');
    expect(document.activeElement).toBe(previewTab);

    fireEvent.keyDown(previewTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('context');
    expect(document.activeElement).toBe(contextTab);

    fireEvent.keyDown(contextTab, { key: 'End' });
    expect(onTabChange).toHaveBeenLastCalledWith('context');
    expect(document.activeElement).toBe(contextTab);

    fireEvent.keyDown(contextTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('review');

    fireEvent.keyDown(reviewTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenLastCalledWith('context');
  });

  it('代码一级 tab：唯一工作区实例 + 文件树，无内部工具条空行，全屏入口位于面板 tab 条', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="code" />);

    expect(screen.getByTestId('fusion-workspace-tab-host')).not.toBeNull();
    expect(screen.getByTestId('dock-file-tree')).not.toBeNull();
    expect(screen.getAllByTestId('file-editor-panel-mock')).toHaveLength(1);
    // 移除的二级 tab 条不能留下任何容器（否则就是 tab 条与内容之间的空行）。
    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: '代码', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览', hidden: true })).toBeNull();
    // 工作区 pane 的第一个子节点就是编辑器宿主：tab 条下直接贴内容，没有占位行。
    expect(screen.getByTestId('fusion-panel-pane-workspace').firstElementChild).toBe(
      screen.getByTestId('fusion-workspace-tab-host'),
    );

    const fullScreenButtons = screen.getAllByRole('button', { name: '全屏' });
    expect(fullScreenButtons).toHaveLength(1);
    const tabsRow = screen.getByRole('tablist', { name: '会话侧面板' }).parentElement;
    expect(tabsRow?.contains(fullScreenButtons[0] ?? null)).toBe(true);
    expect(
      screen.getByTestId('fusion-panel-pane-workspace').contains(fullScreenButtons[0] ?? null),
    ).toBe(false);

    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();
  });

  it('代码与预览共享同一个工作区 pane：切换一级 tab 不重挂工作区', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);

    const view = render(<FusionSessionSidePanel {...createBaseProps()} activeTab="code" />);
    const workspacePane = screen.getByTestId('fusion-panel-pane-workspace');
    const workspaceHost = screen.getByTestId('fusion-workspace-tab-host');
    expect(workspacePane.hasAttribute('hidden')).toBe(false);
    expect(screen.getAllByTestId('file-editor-panel-mock')).toHaveLength(1);

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="preview" />);

    expect(screen.getByTestId('fusion-panel-pane-workspace')).toBe(workspacePane);
    expect(screen.getByTestId('fusion-workspace-tab-host')).toBe(workspaceHost);
    expect(screen.getAllByTestId('file-editor-panel-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');
  });

  it('预览一级 tab 无地址时展示地址空态，提交后挂载唯一浏览器并停留在预览', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="preview"
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByTestId('editor-browser-empty-state')).not.toBeNull();
    expect(screen.getByText('还没有预览地址')).not.toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    fireEvent.change(screen.getByLabelText('预览地址'), { target: { value: 'localhost:4173' } });
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace[WORKSPACE_PATH]).toBe(
      'http://localhost:4173',
    );
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');
    // 地址到达触发内建自动切预览，映射回一级 tab 的 preview。
    expect(onTabChange).toHaveBeenCalledWith('preview');
  });

  it('keep-alive：审查 → 代码 → 预览 → 审查 工作区与浏览器宿主节点身份不变', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);

    const view = render(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);
    const workspaceHost = screen.getByTestId('fusion-workspace-tab-host');
    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(true);

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="code" />);
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('fusion-workspace-tab-host')).toBe(workspaceHost);
    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(browserNode.getAttribute('data-hidden')).toBe('true');

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="preview" />);
    expect(screen.getByTestId('fusion-workspace-tab-host')).toBe(workspaceHost);
    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(browserNode.getAttribute('data-hidden')).toBe('false');

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);
    expect(screen.getByTestId('fusion-workspace-tab-host')).toBe(workspaceHost);
    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(true);
  });

  it('工作区可见时新到预览地址会自动切到预览一级 tab（dev-server 检测路径）', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    useUIStateStore.setState({ sidePanelActiveTab: 'code' });

    function StoreDrivenPanel() {
      const activeTab = useUIStateStore((s) => s.sidePanelActiveTab);
      const setActiveTab = useUIStateStore((s) => s.setSidePanelActiveTab);
      return (
        <FusionSessionSidePanel
          {...createBaseProps()}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      );
    }

    render(<StoreDrivenPanel />);

    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    act(() => {
      setPreviewUrl(PREVIEW_URL);
    });

    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('preview');
    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(browserNode.getAttribute('data-hidden')).toBe('false');
  });

  it('停在审查时新到预览地址不抢一级 tab，浏览器在后台常驻且切到预览即可见', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    function StoreDrivenPanel() {
      const activeTab = useUIStateStore((s) => s.sidePanelActiveTab);
      const setActiveTab = useUIStateStore((s) => s.setSidePanelActiveTab);
      return (
        <FusionSessionSidePanel
          {...createBaseProps()}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      );
    }

    render(<StoreDrivenPanel />);
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    act(() => {
      setPreviewUrl(PREVIEW_URL);
    });

    expect(useUIStateStore.getState().sidePanelActiveTab).toBe('review');
    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(browserNode.getAttribute('data-hidden')).toBe('true');

    act(() => {
      useUIStateStore.getState().setSidePanelActiveTab('preview');
    });

    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(browserNode.getAttribute('data-hidden')).toBe('false');
  });

  it('内建全屏：代码一级 tab 提升 code', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onPromoteToFullScreen = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="code"
        onPromoteToFullScreen={onPromoteToFullScreen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '全屏' }));

    expect(onPromoteToFullScreen).toHaveBeenCalledWith('code');
  });

  it('内建全屏：预览一级 tab 有地址时提升 browser', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);
    const onPromoteToFullScreen = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="preview"
        onPromoteToFullScreen={onPromoteToFullScreen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '全屏' }));

    expect(onPromoteToFullScreen).toHaveBeenCalledWith('browser');
  });

  it('内建全屏：预览一级 tab 但无地址时提升回落到代码', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onPromoteToFullScreen = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="preview"
        onPromoteToFullScreen={onPromoteToFullScreen}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '全屏' }));

    expect(onPromoteToFullScreen).toHaveBeenCalledWith('code');
  });

  it('外部「放大」按钮已移除：全屏入口只随工作区 pane 出现，且不渲染内部工具条', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);
    expect(screen.queryByTestId('fusion-side-panel-promote')).toBeNull();
    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.queryAllByRole('button', { name: '全屏', hidden: true })).toHaveLength(0);

    cleanup();
    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="context" />);
    expect(screen.queryByTestId('fusion-side-panel-promote')).toBeNull();
    expect(screen.queryAllByRole('button', { name: '全屏', hidden: true })).toHaveLength(0);

    cleanup();
    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="code" />);
    expect(screen.queryByTestId('fusion-side-panel-promote')).toBeNull();
    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.getAllByRole('button', { name: '全屏' })).toHaveLength(1);
  });

  it('主内容区提升 / 分屏态：面板不再重复渲染全屏入口（屏幕上恰好一个）', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="code" workspacePromoted />);

    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.queryByTestId('fusion-side-panel-promote')).toBeNull();
    expect(screen.queryByRole('button', { name: '全屏', hidden: true })).toBeNull();
    expect(screen.getByTestId('fusion-workspace-tab-host')).not.toBeNull();
  });

  it('残留的 files tab 收敛到代码一级 tab，并通知父级同步共享 store', async () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel {...createBaseProps()} activeTab="files" onTabChange={onTabChange} />,
    );

    expect(screen.queryByRole('tab', { name: '文件' })).toBeNull();
    expect(screen.getByRole('tab', { name: '代码' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('fusion-workspace-tab-host')).not.toBeNull();

    await waitFor(() => {
      expect(onTabChange).toHaveBeenCalledWith('code');
    });
  });

  it('preview 已是桌面一级 tab：直接选中预览，不触发收敛', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="preview"
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByRole('tab', { name: '预览' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(false);
    expect(onTabChange).not.toHaveBeenCalled();
  });

  it('残留的移动端 browser tab 收敛到预览一级 tab，并保留浏览器互斥所有权', async () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);
    const onTabChange = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="browser"
        onTabChange={onTabChange}
      />,
    );

    expect(screen.queryByRole('tab', { name: '浏览器' })).toBeNull();
    expect(screen.getByRole('tab', { name: '预览' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('fusion-workspace-tab-host')).not.toBeNull();
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');

    await waitFor(() => {
      expect(onTabChange).toHaveBeenCalledWith('preview');
    });
  });

  it('在 Context tab 展示 token 用量并保留压缩入口', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const compactSession = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="context"
        contextUsageSnapshot={{ estimated: false, maxTokens: 4000, usedTokens: 2000 }}
        onCompactSession={compactSession}
      />,
    );

    expect(screen.getByText('50% 已用')).not.toBeNull();
    expect(screen.getByRole('meter', { name: '上下文用量' }).getAttribute('aria-valuenow')).toBe(
      '2000',
    );

    fireEvent.click(screen.getByRole('button', { name: '压缩会话' }));

    expect(compactSession).toHaveBeenCalledTimes(1);
  });

  it('在 Context tab 展示 Fusion 运行摘要，覆盖工具、计划、DAG、MCP 和审批信号', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="context"
        runtimeSummary={RUNTIME_SUMMARY}
      />,
    );

    expect(screen.getByText('工具调用')).not.toBeNull();
    expect(screen.getByText('5 次')).not.toBeNull();
    expect(screen.getByText('1 个失败')).not.toBeNull();
    expect(screen.getByText('计划任务')).not.toBeNull();
    expect(screen.getByText('2/6 进行中')).not.toBeNull();
    expect(screen.getByText('DAG')).not.toBeNull();
    expect(screen.getByText('3 节点 / 2 边')).not.toBeNull();
    expect(screen.getByText('MCP')).not.toBeNull();
    expect(screen.getByText('4 个服务')).not.toBeNull();
    expect(screen.getByText('待审批')).not.toBeNull();
    expect(screen.getByText('1 项')).not.toBeNull();
    expect(screen.getByText('子会话')).not.toBeNull();
    expect(screen.getByText('1 个')).not.toBeNull();
  });

  it('在 Context tab 融合旧版概览信息并避免重复 fallback 小卡', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const openRecoveryStrategy = vi.fn();

    render(
      <FusionSessionSidePanel
        {...createBaseProps()}
        activeTab="context"
        overview={{
          attachmentItems: [],
          artifactsWorkspaceHref: null,
          childSessions: [],
          compactions: [],
          contextUsageSnapshot: null,
          contentArtifactCount: 2,
          contentArtifactCountStatus: 'ready',
          currentSessionId: 'session-1',
          dialogueMode: 'coding',
          effectiveWorkingDirectory: '/home/await/project/OpenAWork',
          messages: [],
          onCompactSession: () => undefined,
          onOpenRecoveryStrategy: openRecoveryStrategy,
          pendingPermissions: [],
          pendingQuestionsCount: 1,
          sessionStateStatus: 'paused',
          sessionTasks: [],
          sessionTodos: [],
          upstreamSummaries: [],
          workspaceFileItems: [],
          yoloMode: false,
        }}
      />,
    );

    expect(screen.getByText('有效上下文')).not.toBeNull();
    expect(screen.getByText('会话消息')).not.toBeNull();
    expect(screen.getAllByText('0 条')).toHaveLength(2);
    expect(screen.getByText('产物工作区')).not.toBeNull();
    expect(screen.getByText('2 个')).not.toBeNull();
    expect(screen.queryByText('剩余 Token')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '恢复详情' }));

    expect(openRecoveryStrategy).toHaveBeenCalledTimes(1);
  });

  it('预览 → 审查 → 预览 不重挂浏览器宿主（页面状态保持）', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);

    const view = render(<FusionSessionSidePanel {...createBaseProps()} activeTab="preview" />);
    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(false);

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);

    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(true);
    expect(screen.getByTestId('fusion-panel-pane-review').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);

    view.rerender(<FusionSessionSidePanel {...createBaseProps()} activeTab="preview" />);

    expect(screen.getByTestId('fusion-panel-pane-workspace').hasAttribute('hidden')).toBe(false);
    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
  });

  it('单一浏览器互斥：宿主面在停靠与主内容区间切换时始终恰好一个实例', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);

    function PanelAndEditor() {
      return (
        <>
          <EditorBrowserWorkspace
            browserPreviewUrl={PREVIEW_URL}
            fileEditor={readFileEditor()}
            handleSaveFile={async () => undefined}
            saving={false}
            workspacePath={WORKSPACE_PATH}
          />
          <FusionSessionSidePanel {...createBaseProps()} activeTab="code" />
        </>
      );
    }

    render(<PanelAndEditor />);

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen
        .getByTestId('fusion-workspace-tab-host')
        .contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);

    // 提升态：主内容区接管，面板让位（两个实例都仍挂载，靠宿主面互斥）。
    act(() => {
      useUIStateStore.setState({ browserPreviewSurface: 'editor' });
    });

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen
        .getByTestId('fusion-workspace-tab-host')
        .contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(false);

    act(() => {
      useUIStateStore.setState({ browserPreviewSurface: 'dock' });
    });

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen
        .getByTestId('fusion-workspace-tab-host')
        .contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);
  });

  it('确认残留的 browser tab 聚合后仍只挂载一个浏览器实例', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    setPreviewUrl(PREVIEW_URL);

    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="browser" />);

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');
  });

  it('融合停靠面板的 tab 清单为 审查/子代理/代码/预览/Context，残留 browser tab 收敛到预览', async () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));
    const onTabChange = vi.fn();

    render(
      <FusionDockedSidePanel
        {...createBaseProps()}
        activeTab="browser"
        onTabChange={onTabChange}
      />,
    );

    expect(screen.getByTestId('fusion-docked-side-panel')).not.toBeNull();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      '审查',
      '子代理',
      '代码',
      '预览',
      'Context',
    ]);

    await waitFor(() => {
      expect(onTabChange).toHaveBeenCalledWith('preview');
    });
  });

  it('在融合 dock 内拖拽手柄可调整对话列/侍审查面板的分栏百分比', () => {
    getFileChangesMock.mockResolvedValue(makeReviewPanelProjection([]));

    render(<FusionDockedSidePanel {...createBaseProps()} activeTab="review" />);

    const panel = screen.getByTestId('fusion-docked-side-panel');
    expect(panel.style.flex).toBe('1 1 auto');

    const handle = screen.getByRole('separator', { name: '拖拽调整面板宽度' });
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 460, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 460, pointerId: 1 });

    // 拖拽手柄向左移动 40px（delta 为负，对话列收窄），fusionDockSplitPos 应下降。
    expect(useUIStateStore.getState().fusionDockSplitPos).toBeLessThan(35);
  });
});

describe('FusionSessionSidePanel 审查操作', () => {
  const CONFLICT_BODY = {
    error: '当前工作区状态不满足恢复条件，暂不能应用恢复。',
    mode: 'file-review',
    target: { decision: 'rejected', filePath: 'src/app.ts', requestId: 'request:src/app.ts' },
    validateOnly: true,
    workspaceReview: {
      available: true,
      conflicts: [{ filePath: 'src/app.ts' }, { filePath: 'src/app.ts.bak' }],
      dirtyCount: 2,
    },
  };

  function renderReviewPanel(): void {
    render(<FusionSessionSidePanel {...createBaseProps()} activeTab="review" />);
  }

  async function waitForFileListed(filePath: string): Promise<void> {
    await waitFor(() => {
      expect(screen.getAllByText(filePath).length).toBeGreaterThan(0);
    });
  }

  it('接受单个文件变更后会提交审查决定并重新拉取投影', async () => {
    getFileChangesMock
      .mockResolvedValueOnce(makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]))
      .mockResolvedValueOnce(
        makeReviewPanelProjection([
          makeReviewPanelDiffEntry('src/app.ts', { reviewStatus: 'accepted' }),
        ]),
      );
    reviewFileChangeMock.mockResolvedValue({
      decision: {
        createdAt: '2026-01-01T00:00:00.000Z',
        decision: 'accepted',
        filePath: 'src/app.ts',
        requestId: 'request:src/app.ts',
      },
      revertClientRequestId: null,
    });

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '接受 src/app.ts' }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledWith('token', 'session-1', {
        decision: 'accepted',
        filePath: 'src/app.ts',
        requestId: 'request:src/app.ts',
      });
    });

    await waitFor(() => {
      expect(getFileChangesMock).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getAllByText('已接受').length).toBeGreaterThan(0);
    });

    expect(toastMock).toHaveBeenCalledWith('已接受：src/app.ts', 'success');
  });

  it('拒绝单个文件需要确认，确认后提交 rejected 决定', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );
    reviewFileChangeMock.mockResolvedValue({
      decision: {
        createdAt: '2026-01-01T00:00:00.000Z',
        decision: 'rejected',
        filePath: 'src/app.ts',
        requestId: 'request:src/app.ts',
      },
      revertClientRequestId: 'file-revert-1',
    });
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/app.ts' }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledWith('token', 'session-1', {
        decision: 'rejected',
        filePath: 'src/app.ts',
        requestId: 'request:src/app.ts',
      });
    });

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith('已拒绝：src/app.ts', 'success');
  });

  it('取消拒绝确认时不提交任何审查决定', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );
    confirmMock.mockReturnValue(false);

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/app.ts' }));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(reviewFileChangeMock).not.toHaveBeenCalled();
  });

  it('409 冲突会展示冲突详情并提供强制覆盖重试', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );
    reviewFileChangeMock
      .mockRejectedValueOnce(
        new HttpError('当前工作区状态不满足恢复条件，暂不能应用恢复。', 409, CONFLICT_BODY),
      )
      .mockResolvedValueOnce({
        decision: {
          createdAt: '2026-01-01T00:00:00.000Z',
          decision: 'rejected',
          filePath: 'src/app.ts',
          requestId: 'request:src/app.ts',
        },
        revertClientRequestId: 'file-revert-1',
      });
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/app.ts' }));

    await waitFor(() => {
      expect(screen.getByText('检测到工作区冲突')).not.toBeNull();
    });
    expect(screen.getByText('当前工作区状态不满足恢复条件，暂不能应用恢复。')).not.toBeNull();
    expect(screen.getByText(/工作区有 2 处冲突/)).not.toBeNull();
    expect(toastMock).toHaveBeenCalledWith('检测到工作区冲突：src/app.ts', 'warning');

    fireEvent.click(screen.getByRole('button', { name: '强制覆盖' }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledTimes(2);
    });
    expect(reviewFileChangeMock).toHaveBeenLastCalledWith('token', 'session-1', {
      decision: 'rejected',
      filePath: 'src/app.ts',
      requestId: 'request:src/app.ts',
      forceConflicts: true,
    });
  });

  it('400 拒绝会展示服务端原因且不提供强制覆盖', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );
    reviewFileChangeMock.mockRejectedValueOnce(
      new HttpError('该文件变更可信度不足，无法安全撤销。', 400, {
        error: '该文件变更可信度不足，无法安全撤销。',
      }),
    );
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/app.ts' }));

    await waitFor(() => {
      expect(screen.getByText('审查操作失败')).not.toBeNull();
    });
    expect(screen.getByText('该文件变更可信度不足，无法安全撤销。')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '强制覆盖' })).toBeNull();
    expect(toastMock).toHaveBeenCalledWith('审查失败：src/app.ts', 'error');
  });

  it('已提交的审查状态会显示徽章并禁用对应动作', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/app.ts', { reviewStatus: 'accepted' }),
      ]),
    );

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    expect(screen.getAllByText('已接受').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: '接受 src/app.ts' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: '拒绝 src/app.ts' }).hasAttribute('disabled')).toBe(
      false,
    );
  });

  it('批量拒绝只作用于当前范围内的文件', async () => {
    const inScopeFile = makeReviewPanelDiffEntry('src/in-scope.ts');
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/other.ts'), inScopeFile], {
        snapshots: [makeReviewPanelSnapshot([inScopeFile])],
      }),
    );
    reviewFileChangeMock.mockResolvedValue({
      decision: {
        createdAt: '2026-01-01T00:00:00.000Z',
        decision: 'rejected',
        filePath: 'src/in-scope.ts',
        requestId: 'request:src/in-scope.ts',
      },
      revertClientRequestId: 'file-revert-1',
    });
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/other.ts');

    fireEvent.click(screen.getByRole('button', { name: '当前' }));
    fireEvent.click(screen.getByRole('button', { name: /全部拒绝/ }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledTimes(1);
    });
    expect(reviewFileChangeMock).toHaveBeenCalledWith('token', 'session-1', {
      decision: 'rejected',
      filePath: 'src/in-scope.ts',
      requestId: 'request:src/in-scope.ts',
    });
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });

  it('强制覆盖成功后清除冲突卡片，无法再次提交回滚', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([makeReviewPanelDiffEntry('src/app.ts')]),
    );
    reviewFileChangeMock
      .mockRejectedValueOnce(
        new HttpError('当前工作区状态不满足恢复条件，暂不能应用恢复。', 409, CONFLICT_BODY),
      )
      .mockResolvedValue({
        decision: {
          createdAt: '2026-01-01T00:00:00.000Z',
          decision: 'rejected',
          filePath: 'src/app.ts',
          requestId: 'request:src/app.ts',
        },
        revertClientRequestId: 'file-revert-1',
      });
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/app.ts');

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/app.ts' }));

    await waitFor(() => {
      expect(screen.getByText('检测到工作区冲突')).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: '强制覆盖' }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText('检测到工作区冲突')).toBeNull();
    });

    expect(screen.queryByRole('button', { name: '强制覆盖' })).toBeNull();
    expect(reviewFileChangeMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledWith('已强制覆盖并拒绝：src/app.ts', 'success');
  });

  it('manual_revert 行保持可见但不可再提交审查决定', async () => {
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection([
        makeReviewPanelDiffEntry('src/rolled-back.ts', { sourceKind: 'manual_revert' }),
      ]),
    );

    renderReviewPanel();
    await waitForFileListed('src/rolled-back.ts');

    expect(screen.getAllByText('已回滚').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: '接受 src/rolled-back.ts' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: '拒绝 src/rolled-back.ts' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.queryByRole('button', { name: '接受' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
    expect(screen.getByRole('button', { name: /全部拒绝/ }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '拒绝 src/rolled-back.ts' }));

    expect(reviewFileChangeMock).not.toHaveBeenCalled();
  });

  it('批量拒绝跳过 manual_revert 行，只处理普通待审查文件', async () => {
    const normalInScope = makeReviewPanelDiffEntry('src/in-scope.ts');
    const revertedInScope = makeReviewPanelDiffEntry('src/rolled-back.ts', {
      sourceKind: 'manual_revert',
    });
    getFileChangesMock.mockResolvedValue(
      makeReviewPanelProjection(
        [makeReviewPanelDiffEntry('src/other.ts'), normalInScope, revertedInScope],
        { snapshots: [makeReviewPanelSnapshot([normalInScope, revertedInScope])] },
      ),
    );
    reviewFileChangeMock.mockResolvedValue({
      decision: {
        createdAt: '2026-01-01T00:00:00.000Z',
        decision: 'rejected',
        filePath: 'src/in-scope.ts',
        requestId: 'request:src/in-scope.ts',
      },
      revertClientRequestId: 'file-revert-1',
    });
    confirmMock.mockReturnValue(true);

    renderReviewPanel();
    await waitForFileListed('src/rolled-back.ts');

    fireEvent.click(screen.getByRole('button', { name: '当前' }));

    expect(
      screen.getByRole('button', { name: '全部拒绝当前范围的 1 个待审查文件' }),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /全部拒绝/ }));

    await waitFor(() => {
      expect(reviewFileChangeMock).toHaveBeenCalledTimes(1);
    });
    expect(reviewFileChangeMock).toHaveBeenCalledWith('token', 'session-1', {
      decision: 'rejected',
      filePath: 'src/in-scope.ts',
      requestId: 'request:src/in-scope.ts',
    });
    expect(reviewFileChangeMock).not.toHaveBeenCalledWith(
      'token',
      'session-1',
      expect.objectContaining({ filePath: 'src/rolled-back.ts' }),
    );
    expect(screen.getAllByText('已回滚').length).toBeGreaterThan(0);
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
