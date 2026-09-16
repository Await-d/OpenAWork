// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionBrowserTab } from './FusionBrowserTab.js';
import sidePanelCss from './FusionSessionSidePanel.css?raw';

vi.mock('../../../components/chat/misc/BuiltInBrowser.js', () => ({
  BuiltInBrowser: (props: { readonly hidden?: boolean }) => (
    <div data-hidden={props.hidden ? 'true' : 'false'} data-testid="built-in-browser-mock" />
  ),
}));

vi.mock('../../../components/file-editor/editor/FileEditorPanel.js', () => ({
  FileEditorPanel: () => <div data-testid="file-editor-panel-mock" />,
}));

const WORKSPACE_PATH = '/home/await/project/OpenAWork';
const PREVIEW_URL = 'http://localhost:3000';

function resetUiState(): void {
  useUIStateStore.setState({
    browserPreviewSurface: 'editor',
    browserPreviewUrlByWorkspace: {},
    editorMode: false,
    editorPaneTabByWorkspace: {},
  });
}

function createEditorFileState() {
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

beforeEach(() => {
  cleanup();
  resetUiState();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe('FusionBrowserTab', () => {
  it('没有预览地址时展示空状态，提交地址后写入当前 workspace 桶并挂载浏览器', () => {
    render(
      <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />,
    );

    expect(screen.getByText('还没有预览地址')).not.toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    fireEvent.change(screen.getByLabelText('预览地址'), {
      target: { value: 'localhost:5173' },
    });
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace[WORKSPACE_PATH]).toBe(
      'http://localhost:5173',
    );
    expect(screen.getByTestId('built-in-browser-mock')).not.toBeNull();
  });

  it('已有预览地址时挂载 BuiltInBrowser 并传入 hidden=false', () => {
    useUIStateStore.setState({
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    render(
      <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />,
    );

    const browser = screen.getByTestId('built-in-browser-mock');
    expect(browser.getAttribute('data-hidden')).toBe('false');
    expect(screen.getByTestId('fusion-browser-tab-host')).not.toBeNull();
  });

  it('挂载时声明浏览器所有权，卸载时归还编辑器面板', () => {
    useUIStateStore.setState({
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    const view = render(
      <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />,
    );

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('dock');

    view.unmount();

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');
  });

  it('互斥：停靠面板持有浏览器时，编辑器面板不挂载第二个 BuiltInBrowser', () => {
    useUIStateStore.setState({
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    render(
      <>
        <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />
        <EditorBrowserWorkspace
          browserPreviewUrl={PREVIEW_URL}
          fileEditor={createEditorFileState()}
          handleSaveFile={async () => undefined}
          saving={false}
          workspacePath={WORKSPACE_PATH}
        />
      </>,
    );

    // 停靠面板声明所有权后，全应用只剩一个实例，且属于停靠面板。
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('fusion-browser-tab-host')).not.toBeNull();

    // 归还所有权后实例回到编辑器面板，数量仍为 1。
    act(() => {
      useUIStateStore.getState().setBrowserPreviewSurface('editor');
    });

    expect(screen.queryByTestId('fusion-browser-tab-host')).toBeNull();
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
  });

  it('互斥：停靠面板持有浏览器时，编辑器面板单独渲染也绝不挂载浏览器', () => {
    useUIStateStore.setState({
      browserPreviewSurface: 'dock',
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    render(
      <EditorBrowserWorkspace
        browserPreviewUrl={PREVIEW_URL}
        fileEditor={createEditorFileState()}
        handleSaveFile={async () => undefined}
        saving={false}
        workspacePath={WORKSPACE_PATH}
      />,
    );

    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();
  });

  it('宿主类名与 CSS 契约一致：纵向 flex 且允许浏览器子节点增长', () => {
    useUIStateStore.setState({
      browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: PREVIEW_URL },
    });

    render(
      <FusionBrowserTab currentSessionId="session-1" effectiveWorkingDirectory={WORKSPACE_PATH} />,
    );

    const host = screen.getByTestId('fusion-browser-tab-host');
    expect(host.className).toBe('fusion-side-panel__browser-host');

    // jsdom 不应用样式表也不做布局，宿主能否让浏览器吃到剩余高度完全取决于这条
    // 真实 CSS 规则；直接对样式源文本断言，避免规则被改回 row 时测试仍然全绿。
    const rule =
      sidePanelCss.match(/\.fusion-side-panel__browser-host\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
    expect(rule).toMatch(/flex:\s*1/);
    expect(rule).toMatch(/min-height:\s*320px/);
  });
});
