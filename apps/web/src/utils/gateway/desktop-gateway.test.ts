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

  it('startedAt 已耗尽预算时不再整段重等,但仍会做完最后一次探测', async () => {
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
    // 预算虽已耗尽，仍必须看一眼「此刻是否其实已经就绪」：`start_gateway` 在原生
    // 侧可能已经吃掉整段预算（它自己也要等健康），直接返回 false 会把「已经启动
    // 成功的网关」误判成失败——这正是「网关明明在跑、桌面端却报健康检查未通过」
    // 的一条成因。代价只有一次探测，不会重新整段等待。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('预算已耗尽但网关其实已就绪时仍判定成功', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true }) as Response),
    );

    await expect(
      waitForGatewayHealth('http://127.0.0.1:3000', {
        timeoutMs: 15_000,
        startedAt: Date.now() - 15_000,
      }),
    ).resolves.toBe(true);
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
