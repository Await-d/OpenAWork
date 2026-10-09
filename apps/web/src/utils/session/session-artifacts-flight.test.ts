import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listForSession = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createArtifactsClient: () => ({ listForSession }),
}));

const { fetchSessionArtifactsOnce, resetSessionArtifactFlightsForTesting } =
  await import('./session-artifacts-flight.js');

const BASE = {
  gatewayUrl: 'http://localhost:3000',
  token: 'token-1',
  sessionId: 's1',
};

describe('fetchSessionArtifactsOnce', () => {
  beforeEach(() => {
    listForSession.mockReset();
    resetSessionArtifactFlightsForTesting();
  });

  afterEach(() => {
    resetSessionArtifactFlightsForTesting();
  });

  it('同一会话同时在途的请求合并为一次网络往返', async () => {
    listForSession.mockResolvedValue({ contentArtifacts: [{ id: 'a1' }] });

    const [first, second] = await Promise.all([
      fetchSessionArtifactsOnce(BASE),
      fetchSessionArtifactsOnce(BASE),
    ]);

    expect(listForSession).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('产物列表是全量的，后来者不必比较任何阈值即可复用', async () => {
    listForSession.mockResolvedValue({ contentArtifacts: [{ id: 'a1' }] });

    const inFlight = fetchSessionArtifactsOnce(BASE);
    const reused = fetchSessionArtifactsOnce(BASE);
    const alsoReused = fetchSessionArtifactsOnce(BASE);

    const resolved = await inFlight;
    // 三个并发订阅者拿到同一个响应对象，底层只打了一次
    expect(await reused).toBe(resolved);
    expect(await alsoReused).toBe(resolved);
    expect(listForSession).toHaveBeenCalledTimes(1);
  });

  it('contentArtifacts 缺失时归一为空数组', async () => {
    listForSession.mockResolvedValue({});

    await expect(fetchSessionArtifactsOnce(BASE)).resolves.toEqual({ contentArtifacts: [] });
  });

  it('force 请求不复用在途结果，且不写入在途表', async () => {
    listForSession.mockResolvedValue({ contentArtifacts: [] });

    const forced = fetchSessionArtifactsOnce({ ...BASE, force: true });
    const alsoForced = fetchSessionArtifactsOnce({ ...BASE, force: true });

    await Promise.all([forced, alsoForced]);
    expect(listForSession).toHaveBeenCalledTimes(2);
  });

  it('不同会话不合并', async () => {
    listForSession.mockResolvedValue({ contentArtifacts: [] });

    await Promise.all([
      fetchSessionArtifactsOnce(BASE),
      fetchSessionArtifactsOnce({ ...BASE, sessionId: 's2' }),
    ]);

    expect(listForSession).toHaveBeenCalledTimes(2);
  });

  it('落定后清空在途表，后续请求重新发起（不缓存陈旧产物）', async () => {
    listForSession.mockResolvedValue({ contentArtifacts: [] });

    await fetchSessionArtifactsOnce(BASE);
    await fetchSessionArtifactsOnce(BASE);

    expect(listForSession).toHaveBeenCalledTimes(2);
  });

  it('单个调用方 abort 只取消自己的等待，共享请求仍服务其他订阅者', async () => {
    let release: (value: unknown) => void = () => undefined;
    listForSession.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const controller = new AbortController();
    const abandoned = fetchSessionArtifactsOnce({ ...BASE, signal: controller.signal });
    const kept = fetchSessionArtifactsOnce(BASE);

    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    release({ contentArtifacts: [{ id: 'a1' }] });
    await expect(kept).resolves.toEqual({ contentArtifacts: [{ id: 'a1' }] });
  });

  it('唯一订阅者放弃时会真正取消底层请求（面板卸载不留空转请求）', async () => {
    let capturedSignal: AbortSignal | undefined;
    listForSession.mockImplementation((_token: string, _sessionId: string, options: unknown) => {
      capturedSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise(() => undefined);
    });

    const controller = new AbortController();
    const pending = fetchSessionArtifactsOnce({ ...BASE, signal: controller.signal });
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('还有订阅者在等时不取消底层请求', async () => {
    let capturedSignal: AbortSignal | undefined;
    let release: (value: unknown) => void = () => undefined;
    listForSession.mockImplementation((_token: string, _sessionId: string, options: unknown) => {
      capturedSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    const first = new AbortController();
    const abandoned = fetchSessionArtifactsOnce({ ...BASE, signal: first.signal });
    const kept = fetchSessionArtifactsOnce(BASE);
    await Promise.resolve();

    first.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(false);

    release({ contentArtifacts: [{ id: 'a1' }] });
    await expect(kept).resolves.toEqual({ contentArtifacts: [{ id: 'a1' }] });
  });

  it('请求失败后不污染在途表', async () => {
    listForSession
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ contentArtifacts: [] });

    await expect(fetchSessionArtifactsOnce(BASE)).rejects.toThrow('boom');
    await expect(fetchSessionArtifactsOnce(BASE)).resolves.toEqual({ contentArtifacts: [] });
    expect(listForSession).toHaveBeenCalledTimes(2);
  });
});
