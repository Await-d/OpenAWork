// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionBrowserTab } from './FusionBrowserTab.js';

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
});
