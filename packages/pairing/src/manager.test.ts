import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PairingDisconnectedError,
  PairingManagerImpl,
  PairingTimeoutError,
  type ClientInfo,
} from './manager.js';

function makeClient(): ClientInfo {
  return { deviceName: 'Pixel', platform: 'android', connectedAt: Date.now() };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('PairingManagerImpl.waitForClient', () => {
  it('confirmClient 到达时 resolve，并清理 pending 注册', async () => {
    const mgr = new PairingManagerImpl(3000);
    const session = await mgr.generatePairingCode();

    const waitP = mgr.waitForClient(session.token, 10_000);
    const client = makeClient();
    expect(mgr.confirmClient(session.token, client)).toBe(true);

    await expect(waitP).resolves.toEqual(client);
  });

  it('超时未配对时以 PairingTimeoutError 拒绝，而不是永久挂起', async () => {
    vi.useFakeTimers();
    const mgr = new PairingManagerImpl(3000);
    const token = (await mgr.generatePairingCode()).token;

    const waitP = mgr.waitForClient(token, 5_000);
    const settled = expect(waitP).rejects.toBeInstanceOf(PairingTimeoutError);
    await vi.advanceTimersByTimeAsync(5_000);
    await settled;

    // 超时只拒绝等待者、清理注册，不会作废 session 本身（token 仍在 TTL 内），
    // 因此后续 confirm 仍返回 true，且不会触发任何已超时的 waiter。
    expect(mgr.confirmClient(token, makeClient())).toBe(true);
  });

  it('disconnect 取消等待计时器并清空 pending', async () => {
    vi.useFakeTimers();
    const mgr = new PairingManagerImpl(3000);
    const token = (await mgr.generatePairingCode()).token;

    // 不 await：仅注册一个等待者，随后 disconnect 应清理它的计时器。
    void mgr.waitForClient(token, 5_000).catch(() => undefined);
    await mgr.disconnect();

    // disconnect 已清空 pending 并取消计时器：推进时间不应触发遗留回调；
    // session 未作废，confirm 仍返回 true 但已无等待者。
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mgr.confirmClient(token, makeClient())).toBe(true);
  });

  it('disconnect 以 PairingDisconnectedError 拒绝 pending 等待者，调用栈得以解栈', async () => {
    const mgr = new PairingManagerImpl(3000);
    const token = (await mgr.generatePairingCode()).token;

    // 注册等待者，把它的 promise 暴露给本测试以验证 disconnect 真的把它 reject 掉
    // —— 而不是像旧实现那样仅清 Map / 清 timer 留下永久 pending。
    const waitP = mgr.waitForClient(token, 60_000);
    // 立即附上 rejection handler，避免 disconnect 之后到 await 之间触发 unhandled rejection。
    const settled = expect(waitP).rejects.toBeInstanceOf(PairingDisconnectedError);
    await mgr.disconnect();
    await settled;
  });

  it('waitForClient 不传 timeoutMs 时回退到 session TTL 兜底，超时即拒绝而非永远挂起', async () => {
    vi.useFakeTimers();
    const mgr = new PairingManagerImpl(3000);
    const token = (await mgr.generatePairingCode()).token;

    // 调用方不传 timeoutMs：旧实现会留下永远 pending 的孤儿 promise，
    // 即使 session TTL 过期也不会唤醒等待者；新实现按 PAIRING_TTL_MS（5min）兜底拒绝。
    const waitP = mgr.waitForClient(token);
    const settled = expect(waitP).rejects.toBeInstanceOf(PairingTimeoutError);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await settled;
  });

  it('waitForClient 传 0 / 负数 timeoutMs 时同样回退到默认兜底', async () => {
    vi.useFakeTimers();
    const mgr = new PairingManagerImpl(3000);
    const token = (await mgr.generatePairingCode()).token;

    const waitP = mgr.waitForClient(token, 0);
    const settled = expect(waitP).rejects.toBeInstanceOf(PairingTimeoutError);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    await settled;
  });
});

describe('PairingManagerImpl HTTP timeouts', () => {
  it('connectWithToken 透传 AbortSignal 给底层 fetch', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const mgr = new PairingManagerImpl(3000);
    await mgr.connectWithToken('http://host.test', 'tok');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    const init = firstCall ? firstCall[1] : undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('verifyConnection 在 fetch 失败时返回 false 而不抛', async () => {
    const fetchSpy = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.reject(new Error('network down')),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const mgr = new PairingManagerImpl(3000);
    // connectWithToken 需要先成功一次以设置 connectedHost。
    const okFetch = vi.fn(
      (_url: string, _init?: RequestInit): Promise<Response> =>
        Promise.resolve(new Response(null, { status: 200 })),
    );
    vi.stubGlobal('fetch', okFetch);
    await mgr.connectWithToken('http://host.test', 'tok');

    vi.stubGlobal('fetch', fetchSpy);
    await expect(mgr.verifyConnection()).resolves.toBe(false);
  });
});
