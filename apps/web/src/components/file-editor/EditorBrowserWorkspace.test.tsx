// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorBrowserWorkspaceProps } from './EditorBrowserWorkspace.js';
import { EditorBrowserWorkspace } from './EditorBrowserWorkspace.js';
import { useUIStateStore } from '../../stores/ui/uiState.js';
import { useState } from 'react';

vi.mock('./editor/FileEditorPanel.js', () => ({
  FileEditorPanel: () => <div data-testid="file-editor-panel-mock" />,
}));

vi.mock('../chat/misc/BuiltInBrowser.js', () => ({
  BuiltInBrowser: (props: { readonly hidden?: boolean }) => (
    <div data-hidden={props.hidden ? 'true' : 'false'} data-testid="built-in-browser-mock" />
  ),
}));

/**
 * vitest 的 `css: false` 会把 `.css?raw` 也替换成空串，因此直读源文本
 * （cwd = apps/web）。
 */
const workspaceCss = readFileSync(
  `${process.cwd()}/src/components/file-editor/editor-browser-workspace.css`,
  'utf8',
);

const WORKSPACE_PATH = '/home/await/project/OpenAWork';
const PREVIEW_URL = 'http://localhost:3000';

function createFileEditor(): EditorBrowserWorkspaceProps['fileEditor'] {
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

function renderWorkspace(props: Partial<EditorBrowserWorkspaceProps> = {}) {
  return render(
    <EditorBrowserWorkspace
      fileEditor={createFileEditor()}
      handleSaveFile={async () => undefined}
      saving={false}
      workspacePath={WORKSPACE_PATH}
      {...props}
    />,
  );
}

beforeEach(() => {
  cleanup();
  useUIStateStore.setState({ browserPreviewSurface: 'editor' });
});

afterEach(() => {
  cleanup();
  useUIStateStore.setState({ browserPreviewSurface: 'editor' });
});

describe('EditorBrowserWorkspace 浏览器入口', () => {
  it('缺省不改变既有行为：无地址时没有预览子 tab，地址到达后自动挂到唯一浏览器', () => {
    const view = renderWorkspace();

    expect(screen.queryByRole('button', { name: '预览' })).toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    view.rerender(
      <EditorBrowserWorkspace
        browserPreviewUrl={PREVIEW_URL}
        fileEditor={createFileEditor()}
        handleSaveFile={async () => undefined}
        saving={false}
        workspacePath={WORKSPACE_PATH}
      />,
    );

    expect(screen.getByRole('button', { name: '预览' })).not.toBeNull();
    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '代码' }));

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('true');
  });

  it('alwaysShowBrowserTab：无地址时也提供预览入口，空态输入地址后回调规范化 URL', () => {
    const onBrowserPreviewUrlChange = vi.fn();
    renderWorkspace({ alwaysShowBrowserTab: true, onBrowserPreviewUrlChange });

    fireEvent.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.getByTestId('editor-browser-empty-state')).not.toBeNull();
    expect(screen.getByText('还没有预览地址')).not.toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();

    const input = screen.getByLabelText('预览地址');
    const submit = screen.getByRole('button', { name: '打开预览' });
    expect(submit.hasAttribute('disabled')).toBe(true);

    fireEvent.change(input, { target: { value: 'localhost:5173' } });
    expect(submit.hasAttribute('disabled')).toBe(false);

    fireEvent.click(submit);

    expect(onBrowserPreviewUrlChange).toHaveBeenCalledTimes(1);
    expect(onBrowserPreviewUrlChange).toHaveBeenCalledWith('http://localhost:5173');
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();
  });

  it('未提供写回回调时不渲染地址输入（主内容区 / 移动端空态保持原样）', () => {
    renderWorkspace({ alwaysShowBrowserTab: true });

    fireEvent.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.queryByTestId('editor-browser-empty-state')).toBeNull();
    expect(screen.queryByLabelText('预览地址')).toBeNull();
    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();
  });

  it('hidePaneTabs：不渲染内部工具条（无空行容器），浏览器照常挂载', () => {
    renderWorkspace({
      activeTab: 'browser',
      alwaysShowBrowserTab: true,
      browserPreviewUrl: PREVIEW_URL,
      hidePaneTabs: true,
      onTabChange: vi.fn(),
      onToggleFullScreen: vi.fn(),
    });

    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: '代码', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '全屏', hidden: true })).toBeNull();

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');
  });

  it('hidePaneTabs：无地址时保留空态地址输入，输入后回调规范化 URL', () => {
    const onBrowserPreviewUrlChange = vi.fn();

    renderWorkspace({
      activeTab: 'browser',
      alwaysShowBrowserTab: true,
      hidePaneTabs: true,
      onBrowserPreviewUrlChange,
      onTabChange: vi.fn(),
      onToggleFullScreen: vi.fn(),
    });

    expect(screen.queryByTestId('editor-browser-workspace-toolbar')).toBeNull();
    expect(screen.getByTestId('editor-browser-empty-state')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '代码', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: '预览', hidden: true })).toBeNull();

    fireEvent.change(screen.getByLabelText('预览地址'), { target: { value: 'localhost:5173' } });
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    expect(onBrowserPreviewUrlChange).toHaveBeenCalledWith('http://localhost:5173');
  });

  it('缺省（主内容区 / 移动端）仍渲染内建工具条与全屏按钮', () => {
    const onToggleFullScreen = vi.fn();

    renderWorkspace({ browserPreviewUrl: PREVIEW_URL, onToggleFullScreen });

    expect(screen.getByTestId('editor-browser-workspace-toolbar')).not.toBeNull();
    expect(screen.getByRole('button', { name: '代码' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '预览' })).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '全屏' }));
    expect(onToggleFullScreen).toHaveBeenCalledTimes(1);
  });

  it('地址写入后浏览器恰好挂载一次，并被内建自动切换带到预览', () => {
    function Harness() {
      const [url, setUrl] = useState<string | null>(null);
      return (
        <EditorBrowserWorkspace
          alwaysShowBrowserTab
          browserPreviewUrl={url}
          fileEditor={createFileEditor()}
          handleSaveFile={async () => undefined}
          onBrowserPreviewUrlChange={setUrl}
          saving={false}
          workspacePath={WORKSPACE_PATH}
        />
      );
    }

    render(<Harness />);

    fireEvent.click(screen.getByRole('button', { name: '预览' }));
    fireEvent.change(screen.getByLabelText('预览地址'), { target: { value: 'localhost:4173' } });
    fireEvent.click(screen.getByRole('button', { name: '打开预览' }));

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: '代码' }));

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);
    expect(screen.getByTestId('built-in-browser-mock').getAttribute('data-hidden')).toBe('true');
  });

  it('已有地址被清空时回到空态，而不是留下没有地址来源的空白浏览器', () => {
    const onBrowserPreviewUrlChange = vi.fn();
    const sharedProps = {
      activeTab: 'browser' as const,
      alwaysShowBrowserTab: true,
      onBrowserPreviewUrlChange,
      onTabChange: vi.fn(),
    };
    const view = renderWorkspace({ ...sharedProps, browserPreviewUrl: PREVIEW_URL });

    expect(screen.getAllByTestId('built-in-browser-mock')).toHaveLength(1);

    view.rerender(
      <EditorBrowserWorkspace
        {...sharedProps}
        browserPreviewUrl={null}
        fileEditor={createFileEditor()}
        handleSaveFile={async () => undefined}
        saving={false}
        workspacePath={WORKSPACE_PATH}
      />,
    );

    expect(screen.queryByTestId('built-in-browser-mock')).toBeNull();
    expect(screen.getByTestId('editor-browser-empty-state')).not.toBeNull();
    expect(screen.getByLabelText('预览地址')).not.toBeNull();
  });

  it('空态样式契约：表单 intrinsic 换行，可在 ~360px 停靠宽度下使用', () => {
    const formRule = workspaceCss.match(
      /\.editor-browser-workspace__empty-form\s*\{([^}]*)\}/,
    )?.[1];
    const inputRule = workspaceCss.match(
      /\.editor-browser-workspace__empty-input\s*\{([^}]*)\}/,
    )?.[1];

    expect(formRule).toBeTruthy();
    expect(formRule).toMatch(/flex-wrap:\s*wrap/);
    expect(inputRule).toBeTruthy();
    expect(inputRule).toMatch(/min-width:\s*0/);
  });
});
