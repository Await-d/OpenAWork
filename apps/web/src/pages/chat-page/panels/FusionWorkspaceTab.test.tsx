// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorBrowserWorkspace } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import type { EditorPaneTab } from '../../../components/file-editor/EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../../stores/ui/uiState.js';
import { FusionWorkspaceTab, type FusionWorkspaceTabProps } from './FusionWorkspaceTab.js';

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
const HOST_WIDTH = 300;

class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(): void {
    this.callback(
      [{ contentRect: { width: HOST_WIDTH } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }

  unobserve(): void {
    return undefined;
  }

  disconnect(): void {
    return undefined;
  }
}

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

function createProps(): FusionWorkspaceTabProps {
  return {
    activeTab: 'code',
    browserPreviewUrl: null,
    fileEditor: createFileEditor(),
    fileTree: <div data-testid="dock-file-tree" />,
    handleSaveFile: async () => undefined,
    onBrowserPreviewUrlChange: vi.fn(),
    onTabChange: vi.fn(),
    saving: false,
    workspacePath: WORKSPACE_PATH,
  };
}

function setPreviewUrl(url: string): void {
  useUIStateStore.setState({ browserPreviewUrlByWorkspace: { [WORKSPACE_PATH]: url } });
}

beforeEach(() => {
  cleanup();
  // 桌面 Fusion 下宿主面由 ChatPage 按「谁可见」派生：未提升时归停靠面板。
  useUIStateStore.setState({
    browserPreviewSurface: 'dock',
    browserPreviewUrlByWorkspace: {},
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useUIStateStore.setState({
    browserPreviewSurface: 'dock',
    browserPreviewUrlByWorkspace: {},
  });
});

describe('FusionWorkspaceTab', () => {
  it('一级扁平化：不渲染内部工具条（子 tab / 全屏都没有），也没有残留空行容器', () => {
    render(<FusionWorkspaceTab {...createProps()} browserPreviewUrl={PREVIEW_URL} />);

    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: '代码', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '全屏', hidden: true })).toBeNull();
    // 全屏提升入口已上移到面板一级 tab 条，但浏览器照常挂载。
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
  });

  it('无地址时预览（activeTab=browser）显示空态地址输入，提交后挂载唯一浏览器', () => {
    function StoreDrivenWorkspace() {
      const [tab, setTab] = useState<EditorPaneTab>('browser');
      const previewUrl =
        useUIStateStore((s) => s.browserPreviewUrlByWorkspace[WORKSPACE_PATH]) ?? null;
      const setBrowserPreviewUrlForWorkspace = useUIStateStore(
        (s) => s.setBrowserPreviewUrlForWorkspace,
      );
      return (
        <FusionWorkspaceTab
          {...createProps()}
          activeTab={tab}
          browserPreviewUrl={previewUrl}
          onBrowserPreviewUrlChange={(url) => setBrowserPreviewUrlForWorkspace(WORKSPACE_PATH, url)}
          onTabChange={setTab}
        />
      );
    }

    render(<StoreDrivenWorkspace />);

    expect(screen.getByTestId('fusion-workspace-tab-host')).not.toBeNull();
    expect(screen.getByTestId('dock-file-tree')).not.toBeNull();
    expect(screen.getByTestId('editor-browser-empty-state')).not.toBeNull();
    expect(screen.getByText('还没有预览地址')).not.toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    fireEvent.change(screen.getByLabelText('预览地址'), { target: { value: 'localhost:5173' } });
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    expect(useUIStateStore.getState().browserPreviewUrlByWorkspace[WORKSPACE_PATH]).toBe(
      'http://localhost:5173',
    );
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');
  });

  it('受控 activeTab：预览挂载唯一浏览器，切回代码保持挂载（keep-alive）', () => {
    const view = render(<FusionWorkspaceTab {...createProps()} browserPreviewUrl={PREVIEW_URL} />);

    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(browserNode.getAttribute('data-hidden')).toBe('true');

    view.rerender(
      <FusionWorkspaceTab {...createProps()} activeTab="browser" browserPreviewUrl={PREVIEW_URL} />,
    );

    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');

    view.rerender(
      <FusionWorkspaceTab {...createProps()} activeTab="code" browserPreviewUrl={PREVIEW_URL} />,
    );

    expect(screen.getByTestId('built-in-browser-mock')).toBe(browserNode);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('true');
  });

  it('新预览地址到达时通过 onTabChange 上报 browser（一级 tab 由父级切换）', () => {
    const onTabChange = vi.fn();
    const view = render(<FusionWorkspaceTab {...createProps()} onTabChange={onTabChange} />);

    expect(onTabChange).not.toHaveBeenCalled();

    view.rerender(
      <FusionWorkspaceTab
        {...createProps()}
        browserPreviewUrl={PREVIEW_URL}
        onTabChange={onTabChange}
      />,
    );

    expect(onTabChange).toHaveBeenCalledWith('browser');
  });

  it('窄宿主下按 45% 上限收敛文件树宽度（ResizeObserver 驱动）', () => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);

    render(<FusionWorkspaceTab {...createProps()} />);

    const handle = screen.getByRole('separator', { name: '调整文件树宽度' });
    expect(handle.getAttribute('aria-valuemax')).toBe(String(Math.floor(HOST_WIDTH * 0.45)));
    expect(handle.getAttribute('aria-valuenow')).toBe(String(Math.floor(HOST_WIDTH * 0.45)));
  });

  it('宿主面由 store 决定：dock 时面板挂载唯一浏览器，提升态（editor）时让位', () => {
    setPreviewUrl(PREVIEW_URL);
    render(<FusionWorkspaceTab {...createProps()} browserPreviewUrl={PREVIEW_URL} />);

    const browserNode = screen.getByTestId('built-in-browser-mock');
    expect(screen.getByTestId('fusion-workspace-tab-host').contains(browserNode)).toBe(true);

    act(() => {
      useUIStateStore.setState({ browserPreviewSurface: 'editor' });
    });

    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

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

  it('停靠实例不自行改写共享宿主面（单写者 = ChatPage 的可见性派生）', () => {
    useUIStateStore.setState({ browserPreviewSurface: 'editor' });

    const view = render(<FusionWorkspaceTab {...createProps()} />);

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');

    view.unmount();

    expect(useUIStateStore.getState().browserPreviewSurface).toBe('editor');
  });

  it('互斥：宿主面在停靠与主内容区间切换时始终恰好一个浏览器', () => {
    setPreviewUrl(PREVIEW_URL);

    function WorkspacePair() {
      return (
        <>
          <EditorBrowserWorkspace
            browserPreviewUrl={PREVIEW_URL}
            fileEditor={createFileEditor()}
            handleSaveFile={async () => undefined}
            saving={false}
            workspacePath={WORKSPACE_PATH}
          />
          <FusionWorkspaceTab {...createProps()} browserPreviewUrl={PREVIEW_URL} />
        </>
      );
    }

    render(<WorkspacePair />);

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(
      screen
        .getByTestId('fusion-workspace-tab-host')
        .contains(screen.getByTestId('built-in-browser-mock')),
    ).toBe(true);

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
});
