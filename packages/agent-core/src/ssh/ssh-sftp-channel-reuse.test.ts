import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

/**
 * Regression: `getSftp` called `client.sftp()` on EVERY file op and never
 * `sftp.end()`-ed the result, leaking one SFTP session channel per
 * `read`/`list`. sshd caps concurrent channels per connection (`MaxSessions`,
 * default 10), so once saturated every later channel open — including `exec` —
 * was refused with "(SSH) Channel open failure: open failed". The fix reuses a
 * single SFTP channel per connection and releases it on disconnect/reconnect.
 */

interface FakeSftpClientOptions {
  /** First N `sftp()` calls reject (simulates a refused channel open). */
  openFailures?: number;
}

function makeSftpClient(options: FakeSftpClientOptions = {}) {
  const handlers: Record<string, () => void> = {};
  let sftpOpenCount = 0;
  let sftpEndCount = 0;
  const sftp = {
    end() {
      sftpEndCount += 1;
    },
    readFile(_path: string, _opts: unknown, cb: (err: Error | undefined, data: string) => void) {
      queueMicrotask(() => cb(undefined, 'file-contents'));
    },
    writeFile() {},
    readdir(
      _path: string,
      cb: (err: Error | undefined, list: Array<{ filename: string; longname: string }>) => void,
    ) {
      queueMicrotask(() => cb(undefined, [{ filename: 'a.txt', longname: '-rw-r--r-- a.txt' }]));
    },
  };
  const client = {
    on(event: string, cb: () => void) {
      handlers[event] = cb;
      return client;
    },
    connect() {
      queueMicrotask(() => handlers['ready']?.());
      return client;
    },
    exec() {},
    sftp(cb: (err: Error | undefined, s?: typeof sftp) => void) {
      sftpOpenCount += 1;
      if (sftpOpenCount <= (options.openFailures ?? 0)) {
        cb(new Error('(SSH) Channel open failure: open failed'));
        return;
      }
      cb(undefined, sftp);
    },
    end() {},
  };
  return {
    client,
    sftpOpenCount: () => sftpOpenCount,
    sftpEndCount: () => sftpEndCount,
  };
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
    status: 'connected',
    createdAt: 0,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SSHConnectionManagerImpl SFTP channel lifecycle', () => {
  it('多次 readFile/listFiles 只打开一条 SFTP 通道', async () => {
    const fake = makeSftpClient();
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c1', fake.client as never]]),
    });
    mgr.addConnection(conn('c1'));

    await mgr.readFile('c1', '/etc/hosts');
    await mgr.readFile('c1', '/etc/passwd');
    await mgr.listFiles('c1', '/etc');

    expect(fake.sftpOpenCount()).toBe(1);
  });

  it('disconnect 时关闭并丢弃缓存的 SFTP 通道，重连后重新打开', async () => {
    const fake = makeSftpClient();
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c2', fake.client as never]]),
      clientFactory: () => Promise.resolve(fake.client as never),
    });
    mgr.addConnection(conn('c2'));

    await mgr.readFile('c2', '/etc/hosts');
    expect(fake.sftpEndCount()).toBe(0);

    await mgr.disconnect('c2');
    expect(fake.sftpEndCount()).toBe(1);

    await mgr.connect('c2');
    await mgr.readFile('c2', '/etc/hosts');
    expect(fake.sftpOpenCount()).toBe(2);
  });

  it('SFTP 通道打开失败时不缓存失败的 Promise，下一次调用会重试', async () => {
    const fake = makeSftpClient({ openFailures: 1 });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c3', fake.client as never]]),
    });
    mgr.addConnection(conn('c3'));

    await expect(mgr.readFile('c3', '/etc/hosts')).rejects.toThrow(/Channel open failure/);
    await expect(mgr.readFile('c3', '/etc/hosts')).resolves.toMatchObject({
      content: 'file-contents',
    });
    expect(fake.sftpOpenCount()).toBe(2);
  });
});

describe('SFTP 子通道恢复', () => {
  it.each(['close', 'error'])('%s 后重开通道且忽略旧通道的迟发事件', async (event) => {
    const channels: EventEmitter[] = [];
    const sftp = vi.fn((cb: (error: undefined, channel: EventEmitter) => void) => {
      const channel = Object.assign(new EventEmitter(), {
        readdir: (_path: string, done: (error: undefined, files: []) => void) =>
          done(undefined, []),
      });
      channels.push(channel);
      cb(undefined, channel);
    });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['recover', { sftp } as never]]),
    });
    mgr.addConnection(conn('recover'));
    await Promise.all([mgr.listFiles('recover', '/'), mgr.listFiles('recover', '/')]);
    expect(sftp).toHaveBeenCalledTimes(1);
    channels[0]?.emit(event);
    await mgr.listFiles('recover', '/');
    expect(sftp).toHaveBeenCalledTimes(2);
    channels[0]?.emit('close');
    channels[0]?.emit('error', new Error('late channel error'));
    await mgr.listFiles('recover', '/');
    expect(sftp).toHaveBeenCalledTimes(2);
    expect(mgr.getConnection('recover')?.status).toBe('connected');
  });
});
