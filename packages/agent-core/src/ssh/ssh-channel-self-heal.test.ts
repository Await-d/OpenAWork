import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

/**
 * Regression: a live transport whose `sshd` session budget (`MaxSessions`)
 * saturates refuses every new channel with "(SSH) Channel open failure: open
 * failed". Neither `exec` nor `sftp` recovers on its own, and the gateway's
 * auto-reconnect never fires because the TCP transport is still up — so a
 * bound SSH session wedges permanently. The manager now counts consecutive
 * channel-open failures per connection; once the threshold is crossed it tears
 * the transport down and re-establishes it, then retries the in-flight call on
 * the fresh client (cooldown-guarded so a rebuild that keeps failing can't
 * hot-loop).
 *
 * The fakes hand out clients in order from a `clientFactory`; each client's
 * `exec` behaviour is keyed so we can assert WHICH transport carried the
 * retried command and how many transports were created.
 */

interface ExecOutcome {
  /** When true the exec channel-open callback rejects with a channel-open error. */
  channelOpenFailure?: boolean;
  /** stdout chunks emitted before close (ignored when channelOpenFailure). */
  stdoutChunks?: Buffer[];
  exitCode?: number;
}

interface FakeClient {
  tag: string;
  client: unknown;
  wasEnded: () => boolean;
}

function makeClient(tag: string, exec: () => ExecOutcome): FakeClient {
  let ended = false;
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  const client = {
    tag,
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers[event] = cb;
      return client;
    },
    connect() {
      queueMicrotask(() => handlers['ready']?.());
      return client;
    },
    exec(_cmd: string, cb: (err: Error | undefined, stream: unknown) => void) {
      const outcome = exec();
      if (outcome.channelOpenFailure) {
        queueMicrotask(() => cb(new Error('(SSH) Channel open failure: open failed'), undefined));
        return;
      }
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy() {},
      });
      queueMicrotask(() => {
        cb(undefined, stream);
        for (const chunk of outcome.stdoutChunks ?? []) stream.emit('data', chunk);
        stream.emit('close', outcome.exitCode ?? 0);
      });
    },
    sftp() {},
    end() {
      ended = true;
    },
  };
  return { tag, client, wasEnded: () => ended };
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

describe('SSHConnectionManagerImpl channel self-heal', () => {
  it('连续 3 次通道打开失败后重建传输，并在新客户端上重试成功', async () => {
    const clients: FakeClient[] = [];
    const factory = (): Promise<unknown> => {
      // 1st transport always refuses new channels; the rebuilt one is healthy.
      const behavior =
        clients.length === 0 ? () => ({ channelOpenFailure: true }) : () => ({ exitCode: 0 });
      const fake = makeClient(`c${clients.length + 1}`, behavior);
      clients.push(fake);
      return Promise.resolve(fake.client);
    };
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    // Two failures stay below the threshold and surface the original error.
    await expect(mgr.execCommand('c1', 'probe', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'probe', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );

    // The third consecutive failure crosses the threshold → transport rebuilt.
    const result = await mgr.execCommand('c1', 'probe', { timeoutMs: 5000 });
    expect(result.exitCode).toBe(0);

    // The dead first transport was torn down and a second one established.
    expect(clients).toHaveLength(2);
    expect(clients[0]?.wasEnded()).toBe(true);
    expect(mgr.getStatus('c1')).toBe('connected');
  });

  it('低于阈值后恢复（两次失败即成功）不触发重建', async () => {
    let execCalls = 0;
    const clients: FakeClient[] = [];
    const factory = (): Promise<unknown> => {
      const fake = makeClient(`c${clients.length + 1}`, () => {
        execCalls += 1;
        // Fail the first two opens, succeed from the third — never 3-in-a-row.
        return execCalls <= 2 ? { channelOpenFailure: true } : { exitCode: 0 };
      });
      clients.push(fake);
      return Promise.resolve(fake.client);
    };
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    await expect(mgr.execCommand('c1', 'a', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'b', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    const ok = await mgr.execCommand('c1', 'c', { timeoutMs: 5000 });
    expect(ok.exitCode).toBe(0);

    // No rebuild: only the original client was ever created.
    expect(clients).toHaveLength(1);
  });

  it('冷却期内的后续通道失败直接透传，不重复重建', async () => {
    const clients: FakeClient[] = [];
    let created = 0;
    const factory = (): Promise<unknown> => {
      created += 1;
      // Every transport keeps refusing new channels, so the rebuild reconnects
      // but the retried exec still hits a channel-open failure.
      const fake = makeClient(`c${created}`, () => ({ channelOpenFailure: true }));
      clients.push(fake);
      return Promise.resolve(fake.client);
    };
    const mgr = new SSHConnectionManagerImpl({
      clientFactory: factory as never,
      selfHealCooldownMs: 60_000,
    });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    // Three consecutive failures → exactly one rebuild (2nd client created).
    await expect(mgr.execCommand('c1', 'a', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'b', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'c', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    expect(created).toBe(2);

    // Within the cooldown, more failures must NOT spawn a third client.
    await expect(mgr.execCommand('c1', 'd', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'e', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    await expect(mgr.execCommand('c1', 'f', { timeoutMs: 5000 })).rejects.toThrow(
      /Channel open failure/,
    );
    expect(created).toBe(2);
  });
});
