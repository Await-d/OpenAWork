import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateDesktopGateway,
  gatewayBindHost,
  pickDesktopFolder,
  waitForGatewayHealth,
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

describe('waitForGatewayHealth(固定总超时)', () => {
  it('网关已就绪时立即通过,不耗完整个预算', async () => {
    // jsdom 的 window 没有 __TAURI__ → isTauriRuntime() 为 false,走 HTTP 探测分支。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    );

    const before = Date.now();
    await expect(waitForGatewayHealth('http://127.0.0.1:3000', { timeoutMs: 5_000 })).resolves.toBe(
      true,
    );

    expect(Date.now() - before).toBeLessThan(500);
  });

  it('探测始终失败时按固定 deadline 结束,而不是次数 × 间隔', async () => {
    vi.stubGlobal('window', {} as Window & typeof globalThis);
    const fetchMock = vi.fn(async () => ({ ok: false }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    await expect(waitForGatewayHealth('http://127.0.0.1:3000', { timeoutMs: 1_200 })).resolves.toBe(
      false,
    );

    const elapsed = Date.now() - before;
    expect(elapsed).toBeGreaterThanOrEqual(1_100);
    expect(elapsed).toBeLessThan(2_500);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('startedAt 已耗尽预算时立即失败,不再整段重等', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const before = Date.now();
    await expect(
      waitForGatewayHealth('http://127.0.0.1:3000', {
        timeoutMs: 15_000,
        startedAt: Date.now() - 15_000,
      }),
    ).resolves.toBe(false);

    expect(Date.now() - before).toBeLessThan(200);
    expect(fetchMock).not.toHaveBeenCalled();
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
