// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerWorkspaceMenu } from './ComposerWorkspaceMenu.js';

type MenuProps = React.ComponentProps<typeof ComposerWorkspaceMenu>;

// 项目未开启 vitest globals，testing-library 的自动清理不会生效，这里显式清理。
afterEach(() => {
  cleanup();
});

function renderMenu(overrides: Partial<MenuProps> = {}): MenuProps {
  const props: MenuProps = {
    currentPath: null,
    savedWorkspacePaths: ['/repo/alpha', '/repo/beta'],
    onSelectWorkspace: vi.fn(),
    onClearWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenLocalFolder: vi.fn(),
    ...overrides,
  };

  render(<ComposerWorkspaceMenu {...props} />);
  return props;
}

function openMenu(): void {
  fireEvent.click(screen.getByTestId('composer-workspace-trigger'));
}

function typeSearch(value: string): HTMLElement {
  const input = screen.getByPlaceholderText('搜索工作空间');
  fireEvent.change(input, { target: { value } });
  return input;
}

describe('ComposerWorkspaceMenu', () => {
  it('未绑定时展示「选择工作空间」，打开后列出已保存工作区', () => {
    renderMenu();

    expect(screen.getByTestId('composer-workspace-trigger').textContent).toContain('选择工作空间');

    openMenu();

    expect(screen.getByPlaceholderText('搜索工作空间')).toBeTruthy();
    const optionTitles = screen
      .getAllByTestId('composer-workspace-option')
      .map((node) => node.getAttribute('title'));
    expect(optionTitles).toEqual(['/repo/alpha', '/repo/beta']);
  });

  it('搜索工作空间时按名称过滤', () => {
    renderMenu();
    openMenu();

    typeSearch('beta');

    const options = screen.getAllByTestId('composer-workspace-option');
    expect(options).toHaveLength(1);
    expect(options[0]?.getAttribute('title')).toBe('/repo/beta');
  });

  it('选择工作区后回调携带完整路径并关闭菜单', () => {
    const props = renderMenu();
    openMenu();

    const secondOption = screen.getAllByTestId('composer-workspace-option')[1];
    expect(secondOption).toBeTruthy();
    fireEvent.click(secondOption as HTMLElement);

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('/repo/beta');
    expect(screen.queryByTestId('composer-workspace-menu')).toBeNull();
  });

  it('已绑定时展示当前工作区并提供「不绑定工作区」', () => {
    const props = renderMenu({ currentPath: '/repo/alpha' });

    expect(screen.getByTestId('composer-workspace-trigger').textContent).toContain('alpha');

    openMenu();
    fireEvent.click(screen.getByTestId('composer-workspace-action-clear'));

    expect(props.onClearWorkspace).toHaveBeenCalledTimes(1);
  });

  it('未绑定时不展示「不绑定工作区」', () => {
    renderMenu();
    openMenu();

    expect(screen.queryByTestId('composer-workspace-action-clear')).toBeNull();
  });

  it('「新建工作空间」与「打开本地文件夹」分别触发对应回调', () => {
    const props = renderMenu();
    openMenu();

    fireEvent.click(screen.getByTestId('composer-workspace-action-create'));
    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1);

    openMenu();
    fireEvent.click(screen.getByTestId('composer-workspace-action-local-folder'));
    expect(props.onOpenLocalFolder).toHaveBeenCalledTimes(1);
  });

  it('搜索有结果时回车选中第一个匹配项', () => {
    const props = renderMenu();
    openMenu();

    const input = typeSearch('beta');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onSelectWorkspace).toHaveBeenCalledWith('/repo/beta');
  });

  it('搜索无结果时回车不会误触解绑 / 新建等操作项', () => {
    const props = renderMenu({ currentPath: '/repo/alpha' });
    openMenu();

    const input = typeSearch('zzz-不存在');
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onClearWorkspace).not.toHaveBeenCalled();
    expect(props.onCreateWorkspace).not.toHaveBeenCalled();
    expect(props.onOpenLocalFolder).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-workspace-menu')).toBeTruthy();
  });

  it('用方向键导航到操作项后回车可以执行', () => {
    const props = renderMenu();
    openMenu();

    const input = screen.getByPlaceholderText('搜索工作空间');
    // 条目顺序：alpha → beta → 新建工作空间 → 打开本地文件夹
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(props.onCreateWorkspace).toHaveBeenCalledTimes(1);
  });

  it('按 Escape 关闭菜单', () => {
    renderMenu();
    openMenu();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByTestId('composer-workspace-menu')).toBeNull();
  });

  it('提供 onOpenSshWorkspace 时渲染 SSH 入口并带上配置提示', () => {
    const onOpenSshWorkspace = vi.fn();
    renderMenu({ onOpenSshWorkspace });
    openMenu();

    const sshAction = screen.getByTestId('composer-workspace-action-ssh');
    expect(sshAction.textContent).toContain('连接 SSH 远端目录');
    expect(sshAction.textContent).toContain('可在弹窗内新建、编辑连接并测试连通');

    fireEvent.click(sshAction);

    expect(onOpenSshWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('composer-workspace-menu')).toBeNull();
  });

  it('未提供 onOpenSshWorkspace 时不渲染 SSH 入口', () => {
    renderMenu();
    openMenu();

    expect(screen.queryByTestId('composer-workspace-action-ssh')).toBeNull();
  });

  it('已绑定 SSH 远端时触发按钮显示 SSH 徽标，菜单提示远端执行', () => {
    renderMenu({
      currentPath: '/srv/app',
      currentSshConnection: { id: 'conn-1', label: 'prod（deploy@10.0.0.2:22）' },
    });

    expect(screen.getByTestId('composer-workspace-trigger').textContent).toContain('SSH');

    openMenu();

    const notice = screen.getByTestId('composer-workspace-ssh-notice');
    expect(notice.textContent).toContain('prod（deploy@10.0.0.2:22）');
    expect(notice.textContent).toContain('远程主机');
  });

  it('未绑定 SSH 远端时不渲染远端提示', () => {
    renderMenu({ currentPath: '/repo/alpha' });
    openMenu();

    expect(screen.queryByTestId('composer-workspace-ssh-notice')).toBeNull();
  });
});
