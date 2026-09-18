// @vitest-environment jsdom
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionBrowserTab } from './FusionBrowserTab.js';
import { FusionWorkspaceTab, type FusionWorkspaceTabProps } from './FusionWorkspaceTab.js';
import { useFusionWorkspaceBrowserSurface } from './use-fusion-workspace-browser-surface.js';

vi.mock('../../../components/file-editor/editor/FileEditorPanel.js', () => ({
  FileEditorPanel: () => <div data-testid="file-editor-panel-mock" />,
}));

vi.mock('../../../components/chat/misc/BuiltInBrowser.js', () => ({
  BuiltInBrowser: (props: { readonly hidden?: boolean }) => (
    <div data-hidden={props.hidden ? 'true' : 'false'} data-testid="built-in-browser-mock" />
  ),
}));

const WORKSPACE_PATH = '/home/await/project/OpenAWork';
const PREVIEW_URL = 'http://localhost:3000';

function createFileEditor(): FusionWorkspaceTabProps['fileEditor'] {
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

function renderMainAreaWorkspace() {
  return (
    <EditorBrowserWorkspace
      browserPreviewUrl={PREVIEW_URL}
      fileEditor={createFileEditor()}
      handleSaveFile={async () => undefined}
      saving={false}
      workspacePath={WORKSPACE_PATH}
    />
  );
}

function renderDockWorkspace(activeTab: EditorPaneTab = 'code') {
  return (
    <FusionWorkspaceTab
      activeTab={activeTab}
      browserPreviewUrl={PREVIEW_URL}
      fileEditor={createFileEditor()}
      fileTree={<div data-testid="dock-file-tree" />}
      handleSaveFile={async () => undefined}
      onBrowserPreviewUrlChange={vi.fn()}
      onTabChange={vi.fn()}
      saving={false}
      workspacePath={WORKSPACE_PATH}
    />
  );
}

type PanelFirstLevelTab = 'code' | 'preview' | 'review' | 'context';

/**
 * 桌面 Fusion：主内容区与停靠面板两个工作区实例同时在场（面板 pane 常驻）。
 * 面板一级 tab 的派生规则与 `FusionSessionSidePanel` 一致：代码 / 预览共享 pane。
 */
function FusionDesktopHarness({
  editorMode,
  panelTab,
}: {
  readonly editorMode: boolean;
  readonly panelTab: PanelFirstLevelTab;
}) {
  useFusionWorkspaceBrowserSurface({ enabled: true, editorMode });
  const workspacePaneVisible = panelTab === 'code' || panelTab === 'preview';
  return (
    <>
      <div data-testid="main-surface">{renderMainAreaWorkspace()}</div>
      <div data-testid="dock-surface" hidden={!workspacePaneVisible}>
        {renderDockWorkspace(panelTab === 'preview' ? 'browser' : 'code')}
      </div>
    </>
  );
}

function expectSingleBrowserInside(surfaceTestId: string): void {
  const browsers = screen.getAllByTestId('built-in-browser-mock');
  expect(browsers).toHaveLength(1);
  expect(screen.getByTestId(surfaceTestId).contains(browsers[0] ?? null)).toBe(true);
}

beforeEach(() => {
  cleanup();
  useUIStateStore.setState({
    browserPreviewSurface: 'editor',
    browserPreviewUrlByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
  useUIStateStore.setState({
    browserPreviewSurface: 'editor',
    browserPreviewUrlByWorkspace: {},
  });
});

describe('useFusionWorkspaceBrowserSurface', () => {
  it('未提升归停靠面板，提升归主内容区', () => {
    const { rerender, unmount } = renderHook(
      ({ editorMode }: { readonly editorMode: boolean }) =>
        useFusionWorkspaceBrowserSurface({ enabled: true, editorMode }),
      { initialProps: { editorMode: false } },
    );

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');

    rerender({ editorMode: true });
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');

    rerender({ editorMode: false });
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');

    unmount();
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');
  });

  it('经典布局 / 移动端（enabled=false）不改写宿主面，交给 FusionBrowserTab', () => {
    useUIStateStore.setState({ browserPreviewSurface: 'dock' });

    renderHook(() => useFusionWorkspaceBrowserSurface({ enabled: false, editorMode: true }));

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');
  });
});

describe('工作区浏览器互斥组合', () => {
  it('面板停在代码且未提升：停靠面板拥有唯一浏览器，主内容区让位', () => {
    const view = render(<FusionDesktopHarness editorMode={false} panelTab="code" />);

    expectSingleBrowserInside('dock-surface');

    view.unmount();
  });

  it('面板停在预览且未提升：停靠面板拥有唯一浏览器', () => {
    const view = render(<FusionDesktopHarness editorMode={false} panelTab="preview" />);

    expectSingleBrowserInside('dock-surface');
    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');

    view.unmount();
  });

  it('提升态（代码 / 预览一级 tab）：主内容区拥有唯一浏览器，停靠面板让位', () => {
    for (const panelTab of ['code', 'preview'] as const) {
      const view = render(<FusionDesktopHarness editorMode={true} panelTab={panelTab} />);

      expectSingleBrowserInside('main-surface');

      view.unmount();
    }
  });

  it('面板切到审查 / Context、工作区 pane 常驻（keep-alive）时仍恰好一个浏览器', () => {
    for (const panelTab of ['review', 'context'] as const) {
      const view = render(<FusionDesktopHarness editorMode={false} panelTab={panelTab} />);

      expect(screen.getByTestId('dock-surface').hasAttribute('hidden')).toBe(true);
      expectSingleBrowserInside('dock-surface');

      view.unmount();
    }
  });

  it('提升 / 收回切换过程中每个可见状态都恰好一个浏览器', () => {
    const view = render(<FusionDesktopHarness editorMode={false} panelTab="preview" />);
    expectSingleBrowserInside('dock-surface');

    view.rerender(<FusionDesktopHarness editorMode={true} panelTab="preview" />);
    expectSingleBrowserInside('main-surface');

    view.rerender(<FusionDesktopHarness editorMode={false} panelTab="preview" />);
    expectSingleBrowserInside('dock-surface');
  });

  it('移动端浏览器 tab：FusionBrowserTab 持有唯一浏览器，主内容区不挂第二份', () => {
    useUIStateStore.setState({
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    render(
      <>
        <div data-testid="main-surface">{renderMainAreaWorkspace()}</div>
        <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />
      </>,
    );

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen
        .getByTestId('fusion-browser-tab-host')
        .contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);
  });

  it('经典布局：只有主内容区工作区时恰好一个浏览器，宿主面不被改写', () => {
    function ClassicHarness() {
      useFusionWorkspaceBrowserSurface({ enabled: false, editorMode: false });
      return <div data-testid="main-surface">{renderMainAreaWorkspace()}</div>;
    }

    render(<ClassicHarness />);

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen.getByTestId('main-surface').contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);
  });

  it('宿主面翻转后旧实例的浏览器让位、新实例接管，切回仍恰好一个', () => {
    render(<FusionDesktopHarness editorMode={false} panelTab="code" />);

    expect(
      screen.getByTestId('dock-surface').contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);

    act(() => {
      useUIStateStore.setState({ browserPreviewSurface: 'editor' });
    });

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen.getByTestId('main-surface').contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);

    act(() => {
      useUIStateStore.setState({ browserPreviewSurface: 'dock' });
    });

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen.getByTestId('dock-surface').contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);
  });
});
