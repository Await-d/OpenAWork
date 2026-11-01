// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canPickDirectory,
  pickDirectory,
  resolveDirectoryPickerAvailability,
} from './pick-directory.js';

type TauriTestWindow = Window & {
  __TAURI__?: {
    core?: { invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  };
  __TAURI_INTERNALS__?: {
    invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  };
  isTauri?: boolean;
};

const tauriWindow = window as unknown as TauriTestWindow;

afterEach(() => {
  delete tauriWindow.__TAURI__;
  delete tauriWindow.__TAURI_INTERNALS__;
  delete tauriWindow.isTauri;
  window.localStorage.removeItem('desktop_gateway_mode');
});

describe('目录选择（桌面端能力探测）', () => {
  it('纯 Web 环境不可用，且调用时给出明确中文错误', async () => {
    expect(canPickDirectory()).toBe(false);
    await expect(pickDirectory()).rejects.toThrow(/不支持系统目录选择器/);
  });

  it('Tauri 运行时 + 本机网关模式时可用，并把选中的路径原样返回', async () => {
    const calls: Array<{ args?: Record<string, unknown>; cmd: string }> = [];
    tauriWindow.__TAURI_INTERNALS__ = {
      invoke: (cmd, args) => {
        calls.push({ cmd, args });
        return Promise.resolve('/srv/data');
      },
    };

    expect(canPickDirectory()).toBe(true);
    await expect(pickDirectory()).resolves.toBe('/srv/data');
    expect(calls[0]?.cmd).toBe('plugin:dialog|open');
    expect(calls[0]?.args).toMatchObject({
      options: expect.objectContaining({ directory: true, multiple: false }),
    });
  });

  it('用户取消（返回 null）时解析为 null，不抛错', async () => {
    tauriWindow.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) };

    await expect(pickDirectory()).resolves.toBeNull();
  });

  it('探测后切换为远程网关时，直接调用仍被拒绝且不触发 IPC', async () => {
    const invoke = vi.fn(() => Promise.resolve('/srv/data'));
    tauriWindow.__TAURI_INTERNALS__ = { invoke };
    expect(canPickDirectory()).toBe(true);
    window.localStorage.setItem('desktop_gateway_mode', 'remote');

    expect(canPickDirectory()).toBe(false);
    await expect(pickDirectory()).rejects.toThrow(/远程网关/);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('桌面端 IPC 通道未就绪时，直接调用返回不可用原因', async () => {
    tauriWindow.isTauri = true;

    await expect(pickDirectory()).rejects.toThrow(/通道未就绪/);
  });

  it('IPC 抛错时包裹为带原因的中文错误', async () => {
    tauriWindow.__TAURI_INTERNALS__ = {
      invoke: () => Promise.reject(new Error('dialog not allowed')),
    };

    await expect(pickDirectory()).rejects.toThrow(/打开系统目录选择器失败：dialog not allowed/);
  });
});

describe('目录选择器可用性（含不可用原因）', () => {
  it('纯 Web：不渲染入口，也无需解释', () => {
    expect(resolveDirectoryPickerAvailability()).toEqual({
      available: false,
      renderEntry: false,
      unavailableReason: null,
    });
  });

  it('桌面端但 IPC 通道缺失：渲染入口并说明通道未就绪', () => {
    tauriWindow.isTauri = true;

    expect(resolveDirectoryPickerAvailability()).toMatchObject({
      available: false,
      renderEntry: true,
      unavailableReason: expect.stringContaining('通道未就绪'),
    });
  });

  it('本地网关模式：可用', () => {
    tauriWindow.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) };

    expect(resolveDirectoryPickerAvailability()).toEqual({
      available: true,
      renderEntry: true,
      unavailableReason: null,
    });
  });

  it('远程网关模式：渲染禁用入口并解释为何不适用', () => {
    tauriWindow.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) };
    window.localStorage.setItem('desktop_gateway_mode', 'remote');

    expect(resolveDirectoryPickerAvailability()).toMatchObject({
      available: false,
      renderEntry: true,
      unavailableReason: expect.stringContaining('远程网关'),
    });
  });
});
