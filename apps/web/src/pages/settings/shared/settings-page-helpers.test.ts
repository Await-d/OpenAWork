// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  normalizeSubagentLimits,
  normalizeSubagentModelPolicy,
  parseBoundedIntegerInput,
  resolveSshDialogRestore,
  tauriInvoke,
} from './settings-page-helpers.js';

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

describe('normalizeSubagentModelPolicy', () => {
  it('undefined 时回退到 auto 默认值', () => {
    expect(normalizeSubagentModelPolicy(undefined)).toEqual({ modelMode: 'auto' });
  });

  it('非法取值回退到 auto', () => {
    expect(normalizeSubagentModelPolicy({ modelMode: 'unknown' })).toEqual({ modelMode: 'auto' });
    expect(normalizeSubagentModelPolicy('inherit-main')).toEqual({ modelMode: 'auto' });
  });

  it('inherit-main 时保留跟随主会话', () => {
    expect(normalizeSubagentModelPolicy({ modelMode: 'inherit-main' })).toEqual({
      modelMode: 'inherit-main',
    });
  });
});

describe('normalizeSubagentLimits', () => {
  it('undefined / 非对象时回落默认值（4 / 24 / 1）', () => {
    expect(normalizeSubagentLimits(undefined)).toEqual({
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
    expect(normalizeSubagentLimits('bad')).toEqual({
      maxRunningPerRoot: 4,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
  });

  it('保留合法取值', () => {
    expect(
      normalizeSubagentLimits({
        maxRunningPerRoot: 6,
        maxTotalPerRoot: 30,
        maxNestingDepth: 2,
      }),
    ).toEqual({ maxRunningPerRoot: 6, maxTotalPerRoot: 30, maxNestingDepth: 2 });
  });

  it('部分字段缺失时逐项回落默认值', () => {
    expect(normalizeSubagentLimits({ maxRunningPerRoot: 8 })).toEqual({
      maxRunningPerRoot: 8,
      maxTotalPerRoot: 24,
      maxNestingDepth: 1,
    });
  });

  it('越界值收敛到护栏边界', () => {
    expect(
      normalizeSubagentLimits({
        maxRunningPerRoot: 999,
        maxTotalPerRoot: 999,
        maxNestingDepth: 99,
      }),
    ).toEqual({ maxRunningPerRoot: 16, maxTotalPerRoot: 200, maxNestingDepth: 8 });
  });

  it('累计上限小于并发上限时自动抬升', () => {
    expect(normalizeSubagentLimits({ maxRunningPerRoot: 10, maxTotalPerRoot: 5 })).toEqual({
      maxRunningPerRoot: 10,
      maxTotalPerRoot: 10,
      maxNestingDepth: 1,
    });
  });
});

describe('parseBoundedIntegerInput', () => {
  it('合法整数原样返回', () => {
    expect(parseBoundedIntegerInput('7', 1, 16)).toBe(7);
  });

  it('越界 / 空串 / 非数字返回 null（调用方保留上一次有效值）', () => {
    expect(parseBoundedIntegerInput('99', 1, 16)).toBeNull();
    expect(parseBoundedIntegerInput('0', 1, 16)).toBeNull();
    expect(parseBoundedIntegerInput('', 1, 16)).toBeNull();
    expect(parseBoundedIntegerInput('abc', 1, 16)).toBeNull();
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
