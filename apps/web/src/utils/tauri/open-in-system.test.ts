// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_GATEWAY_MODE_KEY } from '../gateway/desktop-gateway.js';
import { canOpenPathInSystem, openPathInSystem } from './open-in-system.js';

function setGatewayMode(mode: 'local' | 'remote' | null): void {
  if (mode === null) {
    window.localStorage.removeItem(DESKTOP_GATEWAY_MODE_KEY);
    return;
  }
  window.localStorage.setItem(DESKTOP_GATEWAY_MODE_KEY, mode);
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__TAURI__');
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
  setGatewayMode(null);
});

describe('canOpenPathInSystem', () => {
  it('纯 Web 环境下返回 false', () => {
    expect(canOpenPathInSystem()).toBe(false);
  });

  it('桌面端且 IPC 通道可用时返回 true', () => {
    window.__TAURI__ = { core: { invoke: vi.fn() } };

    expect(canOpenPathInSystem()).toBe(true);
  });

  it('仅有 isTauri 标记、缺少 IPC 通道时返回 false', () => {
    (window as Window & { isTauri?: boolean }).isTauri = true;

    expect(canOpenPathInSystem()).toBe(false);

    Reflect.deleteProperty(window, 'isTauri');
  });

  it('远程网关模式下返回 false —— 文件在远端主机，本机 shell 打不开', () => {
    window.__TAURI__ = { core: { invoke: vi.fn() } };
    setGatewayMode('remote');

    expect(canOpenPathInSystem()).toBe(false);
  });

  it('本地网关模式下仍返回 true', () => {
    window.__TAURI__ = { core: { invoke: vi.fn() } };
    setGatewayMode('local');

    expect(canOpenPathInSystem()).toBe(true);
  });

  it('尚未记录网关模式时按本地处理（桌面端默认本机模式）', () => {
    window.__TAURI__ = { core: { invoke: vi.fn() } };
    setGatewayMode(null);

    expect(canOpenPathInSystem()).toBe(true);
  });
});

describe('openPathInSystem', () => {
  it('通过 open_artifact_path 命令把路径交给系统默认程序', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__TAURI__ = { core: { invoke } };

    await openPathInSystem('/tmp/report.md');

    expect(invoke).toHaveBeenCalledWith('open_artifact_path', { path: '/tmp/report.md' });
  });

  it('传入前去掉路径首尾空白', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__TAURI__ = { core: { invoke } };

    await openPathInSystem('   /tmp/notes.md   ');

    expect(invoke).toHaveBeenCalledWith('open_artifact_path', { path: '/tmp/notes.md' });
  });

  it('支持 __TAURI_INTERNALS__ 通道', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    // Typed through a local assertion: the global Window shape only declares
    // `__TAURI__`, while this channel is injected by Tauri v2 builds that
    // don't enable `withGlobalTauri`.
    (window as Window & { __TAURI_INTERNALS__?: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = {
      invoke,
    };

    await openPathInSystem('/tmp/a.txt');

    expect(invoke).toHaveBeenCalledWith('open_artifact_path', { path: '/tmp/a.txt' });
  });

  it('非桌面环境直接抛错且不触发调用', async () => {
    await expect(openPathInSystem('/tmp/report.md')).rejects.toThrow(
      '当前环境不支持用系统默认程序打开文件。',
    );
  });

  it('路径为空时抛错', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    window.__TAURI__ = { core: { invoke } };

    await expect(openPathInSystem('   ')).rejects.toThrow('文件路径为空，无法打开。');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('系统侧打开失败时包装为中文错误并保留原因', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('No application found'));
    window.__TAURI__ = { core: { invoke } };

    await expect(openPathInSystem('/tmp/mystery.bin')).rejects.toThrow(
      '用系统默认程序打开失败：No application found',
    );
  });
});
