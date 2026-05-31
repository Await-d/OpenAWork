// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspacePickerModal from './WorkspacePickerModal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
});
