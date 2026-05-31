import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

type Handlers = Record<string, (...args: unknown[]) => void>;

function makeFakeClient(behavior: 'ready' | 'error' | 'hang') {
  const handlers: Handlers = {};
  let ended = false;
  const client = {
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = cb;
      return client;
    },
    connect() {
      if (behavior === 'ready') queueMicrotask(() => handlers['ready']?.());
      if (behavior === 'error') queueMicrotask(() => handlers['error']?.(new Error('auth failed')));
      // 'hang' never emits.
      return client;
    },
    exec() {},
    sftp() {},
    end() {
      ended = true;
    },
  };
  return { client, wasEnded: () => ended };
}

function conn(id: string): SSHConnection {
  return {
    id,
    name: id,
    host: 'h',
    port: 22,
    username: 'u',
    authType: 'password',
    password: 'p',
    status: 'disconnected',
    createdAt: 0,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SSHConnectionManagerImpl.connect timeout', () => {
  it('握手既不 ready 也不 error 时，30s 后超时 reject 并 end 半开连接', async () => {
    vi.useFakeTimers();
    const fake = makeFakeClient('hang');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c1'));

    const p = mgr.connect('c1');
    const assertion = expect(p).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(fake.wasEnded()).toBe(true);
    expect(mgr.getStatus('c1')).toBe('error');
  });

  it('ready 事件正常 resolve 并标记 connected', async () => {
    const fake = makeFakeClient('ready');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c2'));
    await expect(mgr.connect('c2')).resolves.toBeUndefined();
    expect(mgr.getStatus('c2')).toBe('connected');
  });

  it('error 事件 reject 并标记 error', async () => {
    const fake = makeFakeClient('error');
    const mgr = new SSHConnectionManagerImpl({ clientFactory: () => Promise.resolve(fake.client) });
    mgr.addConnection(conn('c3'));
    await expect(mgr.connect('c3')).rejects.toThrow(/auth failed/);
    expect(mgr.getStatus('c3')).toBe('error');
  });
});
