import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

/**
 * Regression: execCommand previously had neither a wall-clock timeout nor an
 * output cap. A remote command that never exits (or a stream that never emits
 * `close`) left the returned promise pending forever and leaked the channel;
 * a runaway command spewing output grew stdout/stderr without bound (OOM).
 * The hardened version bounds both: a deadline that resolves with timedOut,
 * and a per-stream byte cap that flags truncation.
 */

interface FakeStreamBehavior {
  stdoutChunks?: Buffer[];
  /** When false, the stream never calls its close callback (simulates a hang). */
  emitClose?: boolean;
  exitCode?: number;
  /** When false, `exec` never calls its callback (simulates a hung channel open). */
  openResponds?: boolean;
}

function makeExecClient(behavior: FakeStreamBehavior) {
  let destroyed = false;
  const stream = Object.assign(new EventEmitter(), {
    stderr: new EventEmitter(),
    destroy() {
      destroyed = true;
    },
  });
  const client = {
    on() {
      return client;
    },
    connect() {
      return client;
    },
    exec(_cmd: string, cb: (err: Error | undefined, s: typeof stream) => void) {
      if (behavior.openResponds !== false) {
        cb(undefined, stream);
        queueMicrotask(() => {
          for (const chunk of behavior.stdoutChunks ?? []) stream.emit('data', chunk);
          if (behavior.emitClose !== false) stream.emit('close', behavior.exitCode ?? 0);
        });
      }
    },
    sftp() {},
    end() {},
  };
  return { client, wasDestroyed: () => destroyed };
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

describe('SSHConnectionManagerImpl.execCommand robustness', () => {
  it('命令流不 close 时，到达 timeout 后以 timedOut 解析而非永久挂起', async () => {
    vi.useFakeTimers();
    const fake = makeExecClient({ emitClose: false, stdoutChunks: [Buffer.from('partial')] });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c1', fake.client as never]]),
    });
    mgr.addConnection(conn('c1'));

    const p = mgr.execCommand('c1', 'sleep infinity', { timeoutMs: 5_000 });
    const assertion = p.then((r) => r);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await assertion;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe('partial');
    expect(fake.wasDestroyed()).toBe(true);
  });

  it('通道打开回调永不触发时，到达 deadline 后以 timedOut 解析而非永久挂起', async () => {
    vi.useFakeTimers();
    const fake = makeExecClient({ openResponds: false });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c4', fake.client as never]]),
    });
    mgr.addConnection(conn('c4'));

    const p = mgr.execCommand('c4', 'pwd', { timeoutMs: 5_000 });
    const assertion = p.then((r) => r);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await assertion;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(-1);
    expect(result.stdout).toBe('');
  });

  it('输出超过 maxOutputBytes 时截断并打 truncated 标记', async () => {
    const big = Buffer.alloc(100, 0x61); // 100 × 'a'
    const fake = makeExecClient({ stdoutChunks: [big], exitCode: 0 });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c2', fake.client as never]]),
    });
    mgr.addConnection(conn('c2'));

    const result = await mgr.execCommand('c2', 'cat big', { maxOutputBytes: 10 });
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stdout.length).toBe(10);
    expect(result.exitCode).toBe(0);
  });

  it('正常命令在 cap 与 deadline 内返回完整输出、无 truncated/timedOut 标记', async () => {
    const fake = makeExecClient({ stdoutChunks: [Buffer.from('hello')], exitCode: 0 });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c3', fake.client as never]]),
    });
    mgr.addConnection(conn('c3'));

    const result = await mgr.execCommand('c3', 'echo hello');
    expect(result.stdout).toBe('hello');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBeUndefined();
    expect(result.stdoutTruncated).toBeUndefined();
  });
});
