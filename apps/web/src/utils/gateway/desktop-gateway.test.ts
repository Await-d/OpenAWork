import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateDesktopGateway,
  gatewayBindHost,
  pickDesktopFolder,
} from './desktop-gateway.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('gatewayBindHost', () => {
  it('returns 127.0.0.1 for localhost mode (default desktop-only access)', () => {
    expect(gatewayBindHost('localhost')).toBe('127.0.0.1');
  });

  it('returns 0.0.0.0 for lan mode (LAN sharing across same Wi-Fi)', () => {
    expect(gatewayBindHost('lan')).toBe('0.0.0.0');
  });
});

describe('authenticateDesktopGateway', () => {
  it('空地址时返回中文错误', async () => {
    await expect(authenticateDesktopGateway('')).rejects.toThrow('请先选择网关地址。');
  });

  it('非 Tauri 环境时返回中文错误', async () => {
    vi.stubGlobal('window', {} as Window & typeof globalThis);

    await expect(authenticateDesktopGateway('http://127.0.0.1:3000')).rejects.toThrow(
      '当前不在 Tauri 桌面环境中运行。',
    );
  });
});

describe('pickDesktopFolder', () => {
  it('在 Tauri 环境下调用原生 pick_folder 命令', async () => {
    const invoke = vi.fn(async () => 'D:\\Projects\\OpenAWork');
    const tauriWindow = {
      __TAURI__: {
        core: {
          invoke,
        },
      },
    };
    vi.stubGlobal('window', tauriWindow);

    await expect(pickDesktopFolder()).resolves.toBe('D:\\Projects\\OpenAWork');
    expect(invoke).toHaveBeenCalledWith('pick_folder', undefined);
  });
});
