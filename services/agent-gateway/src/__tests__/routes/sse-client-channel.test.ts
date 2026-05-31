import { describe, expect, it, vi } from 'vitest';
import { createSseClientChannel } from '../../routes/sse-client-channel.js';

describe('createSseClientChannel', () => {
  it('write 成功时透传到 rawWrite，并保持 open', () => {
    const rawWrite = vi.fn();
    const channel = createSseClientChannel({ rawWrite });

    channel.write('hello');
    expect(rawWrite).toHaveBeenCalledWith('hello');
    expect(channel.closed).toBe(false);
  });

  it('close 幂等：仅执行一次全部 teardown 与 rawEnd', () => {
    const rawEnd = vi.fn();
    const teardownA = vi.fn();
    const teardownB = vi.fn();
    const channel = createSseClientChannel({ rawWrite: () => undefined, rawEnd });

    channel.addTeardown(teardownA);
    channel.addTeardown(teardownB);

    channel.close();
    channel.close();
    channel.close();

    expect(teardownA).toHaveBeenCalledTimes(1);
    expect(teardownB).toHaveBeenCalledTimes(1);
    expect(rawEnd).toHaveBeenCalledTimes(1);
    expect(channel.closed).toBe(true);
  });

  it('teardown 按注册的倒序执行', () => {
    const order: string[] = [];
    const channel = createSseClientChannel({ rawWrite: () => undefined });

    channel.addTeardown(() => order.push('first'));
    channel.addTeardown(() => order.push('second'));
    channel.addTeardown(() => order.push('third'));

    channel.close();
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('rawWrite 抛错（半开 socket）时主动触发 close 并拆除全部订阅', () => {
    const teardown = vi.fn();
    const rawEnd = vi.fn();
    const channel = createSseClientChannel({
      rawWrite: () => {
        throw new Error('EPIPE: broken pipe');
      },
      rawEnd,
    });
    channel.addTeardown(teardown);

    // 关键不变量：写失败不能只置位，必须真正拆除订阅 + heartbeat。
    channel.write('event: x\n\n');

    expect(channel.closed).toBe(true);
    expect(teardown).toHaveBeenCalledTimes(1);
    expect(rawEnd).toHaveBeenCalledTimes(1);
  });

  it('close 之后 write 是 no-op，不再触达 rawWrite', () => {
    const rawWrite = vi.fn();
    const channel = createSseClientChannel({ rawWrite });

    channel.close();
    channel.write('after close');

    expect(rawWrite).not.toHaveBeenCalled();
  });

  it('单个 teardown 抛错不阻断其余 teardown', () => {
    const good = vi.fn();
    const channel = createSseClientChannel({ rawWrite: () => undefined });

    channel.addTeardown(good);
    channel.addTeardown(() => {
      throw new Error('teardown boom');
    });

    expect(() => channel.close()).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('close 之后再 addTeardown 会立即执行（不静默泄漏）', () => {
    const late = vi.fn();
    const channel = createSseClientChannel({ rawWrite: () => undefined });

    channel.close();
    channel.addTeardown(late);

    expect(late).toHaveBeenCalledTimes(1);
  });

  it('rawEnd 抛错被吞掉，close 仍标记完成', () => {
    const channel = createSseClientChannel({
      rawWrite: () => undefined,
      rawEnd: () => {
        throw new Error('already ended');
      },
    });

    expect(() => channel.close()).not.toThrow();
    expect(channel.closed).toBe(true);
  });
});
