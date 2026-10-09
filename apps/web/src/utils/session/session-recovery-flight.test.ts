import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getRecovery = vi.fn();

vi.mock('@openAwork/web-client', () => ({
  createSessionsClient: () => ({ getRecovery }),
}));

const { fetchSessionRecoveryOnce, resetSessionRecoveryFlightsForTesting } =
  await import('./session-recovery-flight.js');

function makeRecovery(messages: unknown[]) {
  return { activeStream: null, children: [], messages, session: { id: 's1' } };
}

const BASE = {
  gatewayUrl: 'http://localhost:3000',
  token: 'token-1',
  sessionId: 's1',
  messageLimit: 10,
};

describe('fetchSessionRecoveryOnce', () => {
  beforeEach(() => {
    getRecovery.mockReset();
    resetSessionRecoveryFlightsForTesting();
  });

  afterEach(() => {
    resetSessionRecoveryFlightsForTesting();
  });

  it('同一会话同时在途的请求合并为一次网络往返', async () => {
    getRecovery.mockResolvedValue(makeRecovery(['m1']));

    const [first, second] = await Promise.all([
      fetchSessionRecoveryOnce(BASE),
      fetchSessionRecoveryOnce(BASE),
    ]);

    expect(getRecovery).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('后来者要的条数不超过在途请求时复用同一响应', async () => {
    getRecovery.mockResolvedValue(makeRecovery(['m1']));

    const inFlight = fetchSessionRecoveryOnce({ ...BASE, messageLimit: 10 });
    const reused = fetchSessionRecoveryOnce({ ...BASE, messageLimit: 1 });

    await expect(inFlight).resolves.toBe(await reused);
    expect(getRecovery).toHaveBeenCalledTimes(1);
  });

  it('后来者要更多条数时独立发起，避免拿到被截断的子集', async () => {
    getRecovery.mockResolvedValue(makeRecovery(['m1']));

    const inFlight = fetchSessionRecoveryOnce({ ...BASE, messageLimit: 1 });
    const needsMore = fetchSessionRecoveryOnce({ ...BASE, messageLimit: 50 });

    await Promise.all([inFlight, needsMore]);
    expect(getRecovery).toHaveBeenCalledTimes(2);
  });

  it('since 不同的增量请求不合并', async () => {
    getRecovery.mockResolvedValue(makeRecovery([]));

    await Promise.all([
      fetchSessionRecoveryOnce({ ...BASE, since: 100 }),
      fetchSessionRecoveryOnce({ ...BASE, since: 200 }),
    ]);

    expect(getRecovery).toHaveBeenCalledTimes(2);
  });

  it('不同会话不合并', async () => {
    getRecovery.mockResolvedValue(makeRecovery([]));

    await Promise.all([
      fetchSessionRecoveryOnce(BASE),
      fetchSessionRecoveryOnce({ ...BASE, sessionId: 's2' }),
    ]);

    expect(getRecovery).toHaveBeenCalledTimes(2);
  });

  it('在途登记表在落定后清空，后续请求重新发起', async () => {
    getRecovery.mockResolvedValue(makeRecovery([]));

    await fetchSessionRecoveryOnce(BASE);
    await fetchSessionRecoveryOnce(BASE);

    expect(getRecovery).toHaveBeenCalledTimes(2);
  });

  it('单个调用方 abort 只取消自己的等待，共享请求仍服务其他订阅者', async () => {
    let release: (value: unknown) => void = () => undefined;
    getRecovery.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const controller = new AbortController();
    const abandoned = fetchSessionRecoveryOnce({ ...BASE, signal: controller.signal });
    const kept = fetchSessionRecoveryOnce(BASE);

    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });

    release(makeRecovery(['m1']));
    await expect(kept).resolves.toMatchObject({ session: { id: 's1' } });
  });

  it('唯一订阅者放弃时会真正取消底层请求（快速切会话不留空转请求）', async () => {
    let capturedSignal: AbortSignal | undefined;
    getRecovery.mockImplementation((_token: string, _sessionId: string, options: unknown) => {
      capturedSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise(() => undefined);
    });

    const controller = new AbortController();
    const pending = fetchSessionRecoveryOnce({ ...BASE, signal: controller.signal });
    await Promise.resolve();
    expect(capturedSignal?.aborted).toBe(false);

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('还有订阅者在等时不取消底层请求', async () => {
    let capturedSignal: AbortSignal | undefined;
    let release: (value: unknown) => void = () => undefined;
    getRecovery.mockImplementation((_token: string, _sessionId: string, options: unknown) => {
      capturedSignal = (options as { signal?: AbortSignal }).signal;
      return new Promise((resolve) => {
        release = resolve;
      });
    });

    const first = new AbortController();
    const abandoned = fetchSessionRecoveryOnce({ ...BASE, signal: first.signal });
    const kept = fetchSessionRecoveryOnce(BASE);
    await Promise.resolve();

    first.abort();
    await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
    expect(capturedSignal?.aborted).toBe(false);

    release(makeRecovery(['m1']));
    await expect(kept).resolves.toMatchObject({ session: { id: 's1' } });
  });

  it('请求失败后不污染在途登记表', async () => {
    getRecovery.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(makeRecovery([]));

    await expect(fetchSessionRecoveryOnce(BASE)).rejects.toThrow('boom');
    await expect(fetchSessionRecoveryOnce(BASE)).resolves.toBeDefined();
    expect(getRecovery).toHaveBeenCalledTimes(2);
  });
});
