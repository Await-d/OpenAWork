// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatComposerMenu } from './ChatComposerMenu.js';
import type {
  ComposerMenuState,
  MentionItem,
} from '../../conversation-runtime/messages/support.js';

type MenuProps = React.ComponentProps<typeof ChatComposerMenu>;

// 项目未开启 vitest globals，testing-library 的自动清理不会生效，这里显式清理。
afterEach(() => {
  cleanup();
});

const MENTION_MENU: NonNullable<ComposerMenuState> = {
  type: 'mention',
  query: 'chat',
  start: 0,
  end: 5,
  selectedIndex: 0,
};

function renderMenu(overrides: Partial<MenuProps> = {}) {
  const props: MenuProps = {
    composerMenu: MENTION_MENU,
    currentItems: [],
    slashIncludesWorkspaceCatalog: false,
    composerListRef: { current: null },
    composerItemRefs: { current: [] },
    onComposerHover: vi.fn(),
    onApplyComposerSelection: vi.fn(),
    hasWorkspaceFiles: true,
    ...overrides,
  };

  return render(<ChatComposerMenu {...props} />);
}

describe('ChatComposerMenu 空列表状态', () => {
  it('mentionError 非空时展示错误行，并压过 loading 与空状态', () => {
    renderMenu({
      mentionLoading: true,
      mentionError: '检索工作区文件失败，请稍后重试。',
    });

    expect(screen.getByText('检索工作区文件失败，请稍后重试。')).toBeTruthy();
    expect(screen.queryByText('正在检索工作区文件…')).toBeNull();
    expect(screen.queryByText('未找到匹配「chat」的文件')).toBeNull();
    expect(screen.queryByText('暂无可引用的文件')).toBeNull();
  });

  it('无错误时按 loading → 无匹配 → 暂无可引用 顺序展示', () => {
    renderMenu({ mentionLoading: true });
    expect(screen.getByText('正在检索工作区文件…')).toBeTruthy();

    cleanup();
    renderMenu({ hasWorkspaceFiles: true });
    expect(screen.getByText('未找到匹配「chat」的文件')).toBeTruthy();

    cleanup();
    renderMenu({ hasWorkspaceFiles: false });
    expect(screen.getByText('暂无可引用的文件')).toBeTruthy();
  });
});

const DIRECTORY_ITEM: MentionItem = {
  id: 'dir:src/components',
  kind: 'mention',
  label: 'components/',
  description: 'src',
  insertText: '@src/components/',
  isDirectory: true,
};

const FILE_ITEM: MentionItem = {
  id: 'src/main.ts',
  kind: 'mention',
  label: 'main.ts',
  description: 'src',
  insertText: '@src/main.ts ',
};

describe('ChatComposerMenu 提及行图标', () => {
  it('目录行使用共享目录图标并传入目录名', () => {
    const { container } = renderMenu({ currentItems: [DIRECTORY_ITEM] });

    const leadingIcon = container.querySelector('[data-folder-icon-name="components"]');
    expect(leadingIcon).toBeTruthy();
    expect(leadingIcon?.getAttribute('width')).toBe('14');
    expect(container.querySelector('[data-file-icon-path]')).toBeNull();
  });

  it('文件行使用共享文件图标并传入相对路径', () => {
    const { container } = renderMenu({ currentItems: [FILE_ITEM] });

    const leadingIcon = container.querySelector('[data-file-icon-path="src/main.ts"]');
    expect(leadingIcon).toBeTruthy();
    expect(leadingIcon?.getAttribute('width')).toBe('14');
  });

  it('父目录提示渲染目录图标，名称取描述的最后一个路径段', () => {
    const { container } = renderMenu({
      currentItems: [{ ...FILE_ITEM, description: 'src/components' }],
    });

    const hintIcon = container.querySelector('[data-folder-icon-name="components"]');
    expect(hintIcon).toBeTruthy();
    expect(hintIcon?.getAttribute('width')).toBe('12');
  });

  it('工作区根目录（description 为空）不渲染父目录提示', () => {
    const { container } = renderMenu({
      currentItems: [{ ...FILE_ITEM, description: '' }],
    });

    expect(container.querySelector('[data-file-icon-path="src/main.ts"]')).toBeTruthy();
    expect(container.querySelector('[data-folder-icon-name]')).toBeNull();
  });
});
