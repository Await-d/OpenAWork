import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

/**
 * Regression: the SFTP-facing ops (getSftp / readFile / writeFile / listFiles)
 * previously wrapped a network callback in a promise that only settled when the
 * callback fired. On a half-open SFTP channel — the subsystem opens but the op
 * callback never arrives (stalled network, dead peer) — each promise stayed
 * pending forever. The hardened version races every SFTP op against a wall-clock
 * deadline and rejects with an identifiable error instead of hanging.
 */

interface FakeSftpBehavior {
  /** When false, readFile's callback never fires (simulates a hung op). */
  readFileResponds?: boolean;
}

function makeSftpClient(behavior: FakeSftpBehavior) {
  const sftp = {
    readFile(_path: string, _opts: unknown, cb: (err: Error | undefined, data: string) => void) {
      if (behavior.readFileResponds !== false) {
        queueMicrotask(() => cb(undefined, 'file-contents'));
      }
      // else: never call cb -> hung op.
    },
    writeFile() {},
    readdir() {},
  };
  const client = {
    on() {
      return client;
    },
    connect() {
      return client;
    },
    exec() {},
    sftp(cb: (err: Error | undefined, s: typeof sftp) => void) {
      cb(undefined, sftp);
    },
    end() {},
  };
  return { client };
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

describe('SSHConnectionManagerImpl SFTP timeout', () => {
  it('readFile 回调永不触发时，到达 SFTP 超时后 reject 而非永久挂起', async () => {
    vi.useFakeTimers();
    const fake = makeSftpClient({ readFileResponds: false });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c1', fake.client as never]]),
    });
    mgr.addConnection(conn('c1'));

    const p = mgr.readFile('c1', '/etc/hosts');
    const assertion = expect(p).rejects.toThrow(/SFTP readFile timed out/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('readFile 回调正常触发时返回内容（未受超时影响）', async () => {
    const fake = makeSftpClient({ readFileResponds: true });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c2', fake.client as never]]),
    });
    mgr.addConnection(conn('c2'));

    const result = await mgr.readFile('c2', '/etc/hosts');
    expect(result.content).toBe('file-contents');
    expect(result.path).toBe('/etc/hosts');
  });
});
