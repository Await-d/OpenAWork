// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveSshDialogRestore, tauriInvoke } from './settings-page-helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tauriInvoke', () => {
  it('runtime.isTauri=true 但 IPC 未注入时返回中文错误', async () => {
    vi.stubGlobal('window', { isTauri: true } as unknown as Window & typeof globalThis);

    await expect(tauriInvoke('noop')).rejects.toThrow('Tauri IPC 尚未就绪。');
  });

  it('非 Tauri 环境时返回中文错误', async () => {
    vi.stubGlobal('window', {} as unknown as Window & typeof globalThis);

    await expect(tauriInvoke('noop')).rejects.toThrow('当前不在 Tauri 桌面环境中运行。');
  });
});


describe('resolveSshDialogRestore', () => {
  it('命中第一个仍存在的对话，且连接已 connected 时拉文件', () => {
    const dialogs = [
      { connectionId: 'c1', cwd: '/home/a' },
      { connectionId: 'c2', cwd: '/srv' },
    ];
    const connections = [
      { id: 'c1', status: 'connected' },
      { id: 'c2', status: 'connected' },
    ];

    expect(resolveSshDialogRestore(dialogs, connections)).toEqual({
      connectionId: 'c1',
      cwd: '/home/a',
      shouldLoadFiles: true,
    });
  });

  it('命中对话但连接未就绪时只选中、不拉文件', () => {
    const dialogs = [{ connectionId: 'c1', cwd: '/var/log' }];
    const connections = [{ id: 'c1', status: 'connecting' }];

    expect(resolveSshDialogRestore(dialogs, connections)).toEqual({
      connectionId: 'c1',
      cwd: '/var/log',
      shouldLoadFiles: false,
    });
  });

  it('跳过连接已被删除的历史对话，落到下一个仍存在的对话', () => {
    const dialogs = [
      { connectionId: 'gone', cwd: '/x' },
      { connectionId: 'c2', cwd: '/y' },
    ];
    const connections = [{ id: 'c2', status: 'connected' }];

    expect(resolveSshDialogRestore(dialogs, connections)).toEqual({
      connectionId: 'c2',
      cwd: '/y',
      shouldLoadFiles: true,
    });
  });

  it('对话 cwd 为空时回退到根目录', () => {
    const dialogs = [{ connectionId: 'c1', cwd: '' }];
    const connections = [{ id: 'c1', status: 'connected' }];

    expect(resolveSshDialogRestore(dialogs, connections)?.cwd).toBe('/');
  });

  it('无可用对话时退化为第一个 connected 的连接', () => {
    const dialogs: { connectionId: string; cwd: string }[] = [];
    const connections = [
      { id: 'c1', status: 'disconnected' },
      { id: 'c2', status: 'connected' },
    ];

    expect(resolveSshDialogRestore(dialogs, connections)).toEqual({
      connectionId: 'c2',
      cwd: '/',
      shouldLoadFiles: true,
    });
  });

  it('既无对话又无 connected 连接时返回 null', () => {
    const connections = [{ id: 'c1', status: 'disconnected' }];

    expect(resolveSshDialogRestore([], connections)).toBeNull();
  });
});
