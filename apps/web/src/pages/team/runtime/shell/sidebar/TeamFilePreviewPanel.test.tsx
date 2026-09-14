// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyTextToClipboard } from '../../../../../components/layout/file-tree/file-tree-actions.js';
import {
  COMPOSER_REFERENCE_EVENT_NAME,
  type ComposerReferenceEventDetail,
} from '../../../../../utils/chat/composer-reference-events.js';
import { TeamFilePreviewPanel } from './TeamFilePreviewPanel.js';

vi.mock('../../../../../components/layout/file-tree/file-tree-actions.js', () => ({
  copyTextToClipboard: vi.fn(async () => undefined),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const WORKSPACE = '/workspace/demo';
const FILE_PATH = `${WORKSPACE}/docs/data.json`;
const CONTENT = '{"answer":42}';

function renderPanel(
  overrides: {
    onOpenInEditor?: (path: string) => void;
    onClose?: () => void;
  } = {},
) {
  return render(
    <TeamFilePreviewPanel
      path={FILE_PATH}
      content={CONTENT}
      loading={false}
      error={null}
      onClose={overrides.onClose ?? vi.fn()}
      workspacePath={WORKSPACE}
      {...(overrides.onOpenInEditor ? { onOpenInEditor: overrides.onOpenInEditor } : {})}
    />,
  );
}

function stubSelection(anchorNode: Node | null, text: string): void {
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: anchorNode === null,
    anchorNode,
    rangeCount: anchorNode === null ? 0 : 1,
    toString: () => text,
    getRangeAt: () => ({
      toString: () => text,
      getBoundingClientRect: () => ({ left: 0, top: 0, height: 0 }),
    }),
  } as unknown as Selection);
}

describe('TeamFilePreviewPanel — 预览体右键菜单', () => {
  it('右键弹出菜单，并提供引用 / 复制路径 / 关闭', () => {
    renderPanel({ onOpenInEditor: vi.fn() });
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('team-file-preview-host'));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('引用到对话')).toBeTruthy();
    expect(screen.getByText('复制完整路径')).toBeTruthy();
    expect(within(screen.getByRole('menu')).getByText('在编辑器中打开')).toBeTruthy();
    expect(screen.getByText('关闭')).toBeTruthy();
    // 浮层没有 Monaco，也不该出现编辑动作。
    expect(screen.queryByText('粘贴')).toBeNull();
  });

  it('引用到对话用工作区相对路径，并带上选中文本', async () => {
    const received: string[] = [];
    const listener = (event: Event) => {
      received.push((event as CustomEvent<ComposerReferenceEventDetail>).detail.text);
    };
    window.addEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);

    try {
      renderPanel();
      const host = screen.getByTestId('team-file-preview-host');
      stubSelection(host, '  {"answer":42}  ');

      fireEvent.contextMenu(host);
      fireEvent.click(screen.getByText('引用选中内容到对话'));

      await waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toBe('@docs/data.json\n{"answer":42}');
    } finally {
      window.removeEventListener(COMPOSER_REFERENCE_EVENT_NAME, listener);
    }
  });

  it('没有 onOpenInEditor 时不出现「在编辑器中打开」', () => {
    renderPanel();
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('team-file-preview-host'));

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(within(screen.getByRole('menu')).queryByText('在编辑器中打开')).toBeNull();
  });

  it('「在编辑器中打开」把当前文件路径交回宿主', async () => {
    const onOpenInEditor = vi.fn();
    renderPanel({ onOpenInEditor });
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('team-file-preview-host'));
    fireEvent.click(within(screen.getByRole('menu')).getByText('在编辑器中打开'));

    await waitFor(() => expect(onOpenInEditor).toHaveBeenCalledWith(FILE_PATH));
  });

  it('「关闭」由菜单关掉浮层', async () => {
    const onClose = vi.fn();
    renderPanel({ onClose });
    stubSelection(null, '');

    fireEvent.contextMenu(screen.getByTestId('team-file-preview-host'));
    fireEvent.click(screen.getByText('关闭'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});

describe('TeamFilePreviewPanel — 键盘呼出', () => {
  it('菜单键也能弹出同一份菜单', () => {
    renderPanel();
    const host = screen.getByTestId('team-file-preview-host');
    stubSelection(null, '');

    expect(fireEvent.keyDown(host, { key: 'ContextMenu' })).toBe(false);

    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByText('复制全部内容')).toBeTruthy();
  });
});
