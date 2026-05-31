import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildWorkspacePickerDataSource } from './workspace-picker-data-source.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildWorkspacePickerDataSource', () => {
  it('未登录时 fetchWorkspaceRoots 抛出中文错误', async () => {
    const source = buildWorkspacePickerDataSource({
      client: {} as never,
      token: null,
    });

    await expect(source.fetchWorkspaceRoots()).rejects.toThrow('未登录，无法读取工作区目录。');
  });

  it('roots 失败时抛出结构化错误文案', async () => {
    const source = buildWorkspacePickerDataSource({
      client: {
        listRootsResult: vi.fn(async () => ({
          ok: false,
          retryable: true,
          errorMessage: 'roots unavailable',
          roots: [],
        })),
      } as never,
      token: 'token-1',
    });

    await expect(source.fetchWorkspaceRoots()).rejects.toThrow('roots unavailable');
  });

  it('fetchTree 成功时返回节点列表', async () => {
    const source = buildWorkspacePickerDataSource({
      client: {
        fetchTreeResult: vi.fn(async () => ({
          ok: true,
          retryable: false,
          nodes: [{ path: '/workspace/demo/src', name: 'src', type: 'directory' }],
        })),
      } as never,
      token: 'token-1',
    });

    await expect(source.fetchTree('/workspace/demo')).resolves.toEqual([
      { path: '/workspace/demo/src', name: 'src', type: 'directory' },
    ]);
  });

  it('未登录时 validatePath 返回 invalid 结果', async () => {
    const source = buildWorkspacePickerDataSource({
      client: {} as never,
      token: null,
    });

    await expect(source.validatePath('/workspace/demo')).resolves.toEqual({
      valid: false,
      error: '未登录，无法校验路径。',
    });
  });
});
