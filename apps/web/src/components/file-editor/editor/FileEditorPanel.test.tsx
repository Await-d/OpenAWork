// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  COMPOSER_REFERENCE_EVENT_NAME,
  type ComposerReferenceEventDetail,
} from '../../../utils/chat/composer-reference-events.js';
import { FileEditorPanel } from './FileEditorPanel.js';
import type { OpenFile } from '../../../hooks/editor/useFileEditor.js';

/**
 * Monaco 是 lazy 加载的重型依赖。这里把它换成一个记录型替身：
 * 渲染一个可被右键命中的 div，并把 `options.contextmenu` 暴露到 DOM 上，
 * 同时调用一次 `onMount` 让宿主拿到 editor 实例。
 */
const monacoMock = vi.hoisted(() => ({
  trigger: vi.fn(),
  focus: vi.fn(),
  revealLinesInCenterIfOutsideViewport: vi.fn(),
  setSelection: vi.fn(),
  setPosition: vi.fn(),
  /** 当前"选区"文本；空串表示没有选区。 */
  selection: { value: '' },
}));

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    default: ({
      onMount,
      options,
    }: {
      onMount?: (editor: unknown) => void;
      options?: Record<string, unknown>;
    }) => {
      React.useEffect(() => {
        onMount?.({
          getSelection: () => ({
            isEmpty: () => monacoMock.selection.value.length === 0,
            getEndPosition: () => ({ lineNumber: 1, column: 1 }),
          }),
          getModel: () => ({ getValueInRange: () => monacoMock.selection.value }),
          getPosition: () => ({ lineNumber: 1, column: 1 }),
          // 键盘呼出菜单时用来把光标位置换算成视口坐标（jsdom 下容器矩形全 0，
          // 所以最终锚点就是这个偏移本身）。
          getScrolledVisiblePosition: () => ({ top: 40, left: 60, height: 14 }),
          getDomNode: () => document.querySelector('[data-testid="monaco"]'),
          focus: monacoMock.focus,
          trigger: monacoMock.trigger,
          revealLinesInCenterIfOutsideViewport: monacoMock.revealLinesInCenterIfOutsideViewport,
          setSelection: monacoMock.setSelection,
          setPosition: monacoMock.setPosition,
        });
      }, [onMount]);

      return React.createElement(
        'div',
        {
          'data-testid': 'monaco',
          'data-contextmenu': String(options?.contextmenu),
        },
        // 模拟两类输入元素：overlay widget 的输入框（查找框），以及铺满编辑器、
        // 承载编辑交互的隐藏 textarea。
        React.createElement('input', { 'data-testid': 'monaco-widget-input' }),
        React.createElement('textarea', {
          'data-testid': 'monaco-inputarea',
          className: 'inputarea',
        }),
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  monacoMock.selection.value = '';
});

const WORKSPACE = '/workspace/demo';

function createOpenFile(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    path: `${WORKSPACE}/src/app.ts`,
    name: 'app.ts',
    content: 'console.log(1);',
    originalContent: 'console.log(1);',
    language: 'typescript',
    ...overrides,
  };
}

function renderPanel(file: OpenFile = createOpenFile()) {
  return render(
    <FileEditorPanel
      files={[file]}
      activeFile={file}
      activeFilePath={file.path}
      isDirty={() => false}
      onActivate={vi.fn()}
      onClose={vi.fn()}
      onChange={vi.fn()}
      onSave={vi.fn()}
      workspacePath={WORKSPACE}
    />,
  );
}

/** 等 Monaco 替身挂载完成，返回承载 onContextMenu 的外层容器。 */
async function findEditorHost(): Promise<HTMLElement> {
  const monaco = await screen.findByTestId('monaco');
  const host = monaco.parentElement;
  if (!host) {
    throw new Error('未找到编辑器容器');
  }
  return host;
}

describe('FileEditorPanel — 代码视图右键菜单', () => {
  it('关闭 Monaco 自带菜单，把它交给自有菜单渲染', async () => {
    renderPanel();

    const monaco = await screen.findByTestId('monaco');
    expect(monaco.getAttribute('data-contextmenu')).toBe('false');
  });

  it('在编辑器上右键弹出自有菜单，并含补齐的 Monaco 编辑动作', async () => {
    renderPanel();
    const host = await findEditorHost();

    fireEvent.contextMenu(host);

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByText('引用到对话')).toBeTruthy();
    expect(screen.getByText('剪切')).toBeTruthy();
    expect(screen.getByText('复制')).toBeTruthy();
    expect(screen.getByText('粘贴')).toBeTruthy();
    expect(screen.getByText('全选')).toBeTruthy();
    expect(screen.getByText(`复制完整路径`)).toBeTruthy();
  });

  it('右键落在 overlay 控件的输入框上时不拦截，保留浏览器原生菜单', async () => {
    renderPanel();
    await findEditorHost();

    fireEvent.contextMenu(screen.getByTestId('monaco-widget-input'));

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('铺满编辑器的隐藏 inputarea 不算输入控件，仍走自有菜单', async () => {
    renderPanel();
    await findEditorHost();

    fireEvent.contextMenu(screen.getByTestId('monaco-inputarea'));

    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('把编辑动作转交给 Monaco 执行', async () => {
    renderPanel();
    const host = await findEditorHost();
    fireEvent.contextMenu(host);

    fireEvent.click(await screen.findByText('粘贴'));

    await waitFor(() =>
      expect(monacoMock.trigger).toHaveBeenCalledWith(
        'openAwork-context-menu',
        'editor.action.clipboardPasteAction',
        null,
      ),
    );
  });

  it('无选区时不出现「引用选中内容到对话」', async () => {
    renderPanel();
    const host = await findEditorHost();

    fireEvent.contextMenu(host);

    await screen.findByRole('menu');
    expect(screen.queryByText('引用选中内容到对话')).toBeNull();
  });

  it('有选区时提供「引用选中内容到对话」并把相对路径与文本写入引用事件', async () => {
    monacoMock.selection.value = 'const answer = 42;';
    const received: string[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<ComposerReferenceEventDetail>).detail.text);
    };
    window.addEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);

    try {
      renderPanel();
      const host = await findEditorHost();
      fireEvent.contextMenu(host);

      fireEvent.click(await screen.findByText('引用选中内容到对话'));

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toBe('@src/app.ts\nconst answer = 42;');
    } finally {
      window.removeEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);
    }
  });

  it('引用到对话使用相对路径', async () => {
    const received: string[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<ComposerReferenceEventDetail>).detail.text);
    };
    window.addEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);

    try {
      renderPanel();
      const host = await findEditorHost();
      fireEvent.contextMenu(host);

      fireEvent.click(await screen.findByText('引用到对话'));

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toBe('@src/app.ts ');
    } finally {
      window.removeEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);
    }
  });
});

describe('FileEditorPanel — 代码视图键盘呼出菜单', () => {
  it('Windows 菜单键就能弹出菜单，并挡掉浏览器原生行为', async () => {
    renderPanel();
    const host = await findEditorHost();

    // fireEvent 在事件被 preventDefault 时返回 false。
    expect(fireEvent.keyDown(host, { key: 'ContextMenu' })).toBe(false);

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByText('粘贴')).toBeTruthy();
  });

  it('Shift+F10 同样能呼出菜单（不再被 Monaco 的 showContextMenu 吃掉）', async () => {
    renderPanel();
    const host = await findEditorHost();

    expect(fireEvent.keyDown(host, { key: 'F10', shiftKey: true })).toBe(false);

    expect(await screen.findByRole('menu')).toBeTruthy();
  });

  it('其他按键既不弹菜单也不被拦截', async () => {
    renderPanel();
    const host = await findEditorHost();

    expect(fireEvent.keyDown(host, { key: 'a' })).toBe(true);
    expect(fireEvent.keyDown(host, { key: 'F10' })).toBe(true);

    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('键盘呼出时沿用 Monaco 的选区，因此也能引用选中内容', async () => {
    monacoMock.selection.value = 'picked line';
    renderPanel();
    const host = await findEditorHost();

    fireEvent.keyDown(host, { key: 'ContextMenu' });

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByText('引用选中内容到对话')).toBeTruthy();
  });
});

describe('FileEditorPanel — 标签栏键盘菜单', () => {
  it('焦点在标签上时按菜单键弹出标签菜单，而不是浏览器原生菜单', async () => {
    renderPanel();
    const tabButton = await screen.findByTitle('app.ts');

    expect(fireEvent.keyDown(tabButton, { key: 'ContextMenu' })).toBe(false);

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByText('关闭其他')).toBeTruthy();
  });
});

describe('FileEditorPanel — 预览视图菜单宿主', () => {
  const markdownFile = createOpenFile({
    path: `${WORKSPACE}/docs/readme.md`,
    name: 'readme.md',
    content: '# 标题',
    originalContent: '# 标题',
    language: 'markdown',
  });

  it('markdown 默认进入预览视图，右键由内容宿主接管', async () => {
    renderPanel(markdownFile);

    const host = await screen.findByTestId('file-editor-preview-host');
    fireEvent.contextMenu(host);

    expect(await screen.findByRole('menu')).toBeTruthy();
    expect(screen.getByText('在编辑器中打开')).toBeTruthy();
    // 预览视图没有编辑器动作。
    expect(screen.queryByText('粘贴')).toBeNull();
  });

  it('预览视图也能用键盘呼出菜单', async () => {
    renderPanel(markdownFile);

    const host = await screen.findByTestId('file-editor-preview-host');
    expect(fireEvent.keyDown(host, { key: 'ContextMenu' })).toBe(false);

    expect(await screen.findByRole('menu')).toBeTruthy();
  });
});
