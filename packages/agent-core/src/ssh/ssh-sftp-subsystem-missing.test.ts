import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  SSHConnectionManagerImpl,
  SshSftpUnavailableError,
  type SSHConnection,
} from './ssh-connection-manager.js';

/**
 * 回归（2026-10-12 线上排障）：远端 sshd 未启用 sftp 子系统时，ssh2 的
 * `client.sftp()` 只回一句裸英文 `Unable to start subsystem: sftp`（没有
 * `code`、没有路径），网关的 SSH 路由把它当成未知故障映射成 `500`，排障包里
 * 既看不出这是远端环境问题还是网关缺陷。
 *
 * 这里断言 manager 已把它归一成 `SshSftpUnavailableError`，并确认它**不会**
 * 误触发通道耗尽自愈：重建传输对「服务端根本没有 sftp」毫无帮助，只会平白
 * 拆掉一条仍可用的 exec 通道。
 */

function makeClient(
  tag: string,
  sftpError: () => Error | undefined,
): { tag: string; client: unknown } {
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
      const stream = Object.assign(new EventEmitter(), {
        stderr: new EventEmitter(),
        destroy() {},
      });
      queueMicrotask(() => {
        cb(undefined, stream);
        stream.emit('close', 0);
      });
    },
    sftp(cb: (err: Error | undefined, sftp: unknown) => void) {
      const err = sftpError();
      queueMicrotask(() => {
        if (err) {
          cb(err, undefined);
          return;
        }
        cb(undefined, {
          readdir: (_p: string, done: (e: Error | undefined, list: unknown[]) => void) =>
            done(undefined, []),
          on: () => undefined,
          end: () => undefined,
        });
      });
    },
    end() {},
  };
  return { tag, client };
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

describe('SSHConnectionManagerImpl SFTP 子系统缺失', () => {
  it('把裸英文 "Unable to start subsystem" 归一成 SshSftpUnavailableError', async () => {
    const clients: unknown[] = [];
    const factory = (): Promise<unknown> => {
      const fake = makeClient('c1', () => new Error('Unable to start subsystem: sftp'));
      clients.push(fake.client);
      return Promise.resolve(fake.client);
    };
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    const error = await mgr.listFiles('c1', '/tmp').then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(SshSftpUnavailableError);
    expect((error as SshSftpUnavailableError).name).toBe('SshSftpUnavailableError');
    expect((error as SshSftpUnavailableError).subsystem).toBe('sftp');
    // 归一后的错误不再携带 ssh2 的原生英文文案，避免又被当成未知故障。
    expect((error as Error).message).not.toContain('Unable to start subsystem');
  });

  it('该错误不触发通道耗尽自愈（重建传输救不了"服务端没有 sftp"）', async () => {
    let created = 0;
    const factory = (): Promise<unknown> => {
      created += 1;
      const fake = makeClient(`c${created}`, () => new Error('Unable to start subsystem: sftp'));
      return Promise.resolve(fake.client);
    };
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    // 连续 3 次（正是自愈阈值）失败，仍不应重建出第二条传输。
    for (let i = 0; i < 3; i += 1) {
      await expect(mgr.listFiles('c1', '/tmp')).rejects.toBeInstanceOf(SshSftpUnavailableError);
    }
    expect(created).toBe(1);
  });

  it('readFile / writeFile 走同一归一化路径', async () => {
    const factory = (): Promise<unknown> =>
      Promise.resolve(makeClient('c1', () => new Error('Unable to start subsystem: sftp')).client);
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    await expect(mgr.readFile('c1', '/tmp/a.txt')).rejects.toBeInstanceOf(SshSftpUnavailableError);
    await expect(mgr.writeFile('c1', '/tmp/a.txt', 'x')).rejects.toBeInstanceOf(
      SshSftpUnavailableError,
    );
  });

  it('无关的通道打开错误原样透传，不被误归一', async () => {
    const factory = (): Promise<unknown> =>
      Promise.resolve(makeClient('c1', () => new Error('some unrelated sftp failure')).client);
    const mgr = new SSHConnectionManagerImpl({ clientFactory: factory as never });
    mgr.addConnection(conn('c1'));
    await mgr.connect('c1');

    const error = await mgr.listFiles('c1', '/tmp').then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SshSftpUnavailableError);
    expect((error as Error).message).toBe('some unrelated sftp failure');
  });
});
