// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const desktopGatewayMocks = vi.hoisted(() => ({
  isTauriRuntime: vi.fn(() => false),
  pickDesktopFolder: vi.fn<() => Promise<string | null>>(async () => null),
}));

vi.mock('../../../utils/gateway/desktop-gateway.js', () => desktopGatewayMocks);

import WorkspacePickerModal, { type FileTreeNode } from './WorkspacePickerModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  desktopGatewayMocks.isTauriRuntime.mockReturnValue(false);
  desktopGatewayMocks.pickDesktopFolder.mockReset().mockResolvedValue(null);
});

describe('WorkspacePickerModal', () => {
  it('工作区根目录加载失败时会显示错误信息', async () => {
    render(
      <WorkspacePickerModal
        isOpen
        onClose={() => {}}
        onSelect={async () => {}}
        fetchWorkspaceRoots={async () => {
          throw new Error('roots unavailable');
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('roots unavailable')).toBeTruthy();
    });
  });

  it('初始化失败后可通过重试恢复目录列表', async () => {
    const fetchWorkspaceRoots = vi.fn(async () => ['/workspace/demo']);
    const fetchTree = vi
      .fn<
        (
          _: string,
          __?: number,
        ) => Promise<Array<{ path: string; name: string; type: 'directory' }>>
      >()
      .mockRejectedValueOnce(new Error('tree unavailable'))
      .mockResolvedValueOnce([
        {
          path: '/workspace/demo/src',
          name: 'src',
          type: 'directory',
        },
      ]);

    render(
      <WorkspacePickerModal
        isOpen
        onClose={() => {}}
        onSelect={async () => {}}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('tree unavailable')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '重试' }));

    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });
    expect(fetchTree).toHaveBeenCalledTimes(2);
  });

  it('可在当前目录下创建文件夹并刷新目录列表', async () => {
    const fetchWorkspaceRoots = vi.fn(async () => ['/workspace/demo']);
    const fetchTree = vi
      .fn<(path: string, depth?: number) => Promise<FileTreeNode[]>>()
      .mockResolvedValueOnce([
        {
          path: '/workspace/demo/src',
          name: 'src',
          type: 'directory',
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '/workspace/demo/feature',
          name: 'feature',
          type: 'directory',
        },
      ]);
    const createDirectory = vi.fn(async () => undefined);

    render(
      <WorkspacePickerModal
        isOpen
        onClose={() => {}}
        onSelect={async () => {}}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        createDirectory={createDirectory}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('src')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: 'feature' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(createDirectory).toHaveBeenCalledWith('/workspace/demo/feature');
    });
    await waitFor(() => {
      expect(screen.getByText('feature')).toBeTruthy();
    });
    expect(fetchTree).toHaveBeenNthCalledWith(1, '/workspace/demo', 1);
    expect(fetchTree).toHaveBeenNthCalledWith(2, '/workspace/demo', 1);
  });

  it('文件夹名称包含路径分隔符时不会创建目录', async () => {
    const fetchWorkspaceRoots = vi.fn(async () => ['/workspace/demo']);
    const fetchTree = vi.fn(async (): Promise<FileTreeNode[]> => []);
    const createDirectory = vi.fn(async () => undefined);

    render(
      <WorkspacePickerModal
        isOpen
        onClose={() => {}}
        onSelect={async () => {}}
        fetchWorkspaceRoots={fetchWorkspaceRoots}
        fetchTree={fetchTree}
        createDirectory={createDirectory}
      />,
    );

    await waitFor(() => {
      expect(fetchTree).toHaveBeenCalledWith('/workspace/demo', 1);
    });

    fireEvent.click(screen.getByRole('button', { name: '新建文件夹' }));
    fireEvent.change(screen.getByLabelText('文件夹名称'), { target: { value: '../bad' } });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(screen.getByText('文件夹名称不能包含路径分隔符')).toBeTruthy();
    });
    expect(createDirectory).not.toHaveBeenCalled();
  });

  it('桌面端可通过系统文件夹选择器直接完成选择', async () => {
    desktopGatewayMocks.isTauriRuntime.mockReturnValue(true);
    desktopGatewayMocks.pickDesktopFolder.mockResolvedValue('D:\\Projects\\OpenAWork');
    const onSelect = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const validatePath = vi.fn(async () => ({
      valid: true,
      path: 'D:\\Projects\\OpenAWork',
    }));

    render(
      <WorkspacePickerModal
        isOpen
        onClose={onClose}
        onSelect={onSelect}
        fetchWorkspaceRoots={async () => ['C:\\', 'D:\\']}
        fetchTree={async () => []}
        validatePath={validatePath}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '使用系统选择器' }));

    await waitFor(() => {
      expect(desktopGatewayMocks.pickDesktopFolder).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith('D:\\Projects\\OpenAWork');
    });
    expect(validatePath).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('桌面端打开弹窗时优先等待系统选择器，不会先因根目录树加载失败报错', async () => {
    desktopGatewayMocks.isTauriRuntime.mockReturnValue(true);
    const fetchTree = vi.fn(async () => {
      throw new Error('当前账号无权访问该工作区路径。');
    });

    render(
      <WorkspacePickerModal
        isOpen
        onClose={() => {}}
        onSelect={async () => {}}
        fetchWorkspaceRoots={async () => ['C:\\', 'D:\\']}
        fetchTree={fetchTree}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('系统文件夹选择器')).toBeTruthy();
    });
    expect(fetchTree).not.toHaveBeenCalled();
    expect(screen.queryByText('当前账号无权访问该工作区路径。')).toBeNull();
  });
});
