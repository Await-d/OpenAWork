import { afterEach, describe, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl, type SSHConnection } from './ssh-connection-manager.js';

/**
 * Regression (§0.129, SSH readFile preview memory bound):
 * `readFile` previewed a remote file by calling `sftp.readFile`, which buffers
 * the WHOLE file into memory, then hardcoded `truncated: false` with no size
 * cap — even though the sibling `execCommand` already caps output at
 * SSH_EXEC_MAX_OUTPUT_BYTES and the `SSHFilePreview.truncated` field exists.
 * The remote path is user-supplied via `GET /ssh/file`, so previewing a
 * multi-GB remote file would OOM the gateway. The hardened version `stat`s the
 * file first and rejects before reading when it exceeds the cap; post-read
 * truncation cannot undo the buffering, so a stat-first guard is the only
 * faithful fix.
 *
 * We inject an env override for a tiny cap and a fake SFTP whose `stat` reports
 * an oversized file, asserting the read is refused before `readFile` is called.
 */

interface FakeBehavior {
  statSize: number;
}

function makeSftpClient(behavior: FakeBehavior) {
  let readFileCalled = false;
  const sftp = {
    stat(_path: string, cb: (err: Error | undefined, stats: { size?: number }) => void) {
      queueMicrotask(() => cb(undefined, { size: behavior.statSize }));
    },
    readFile(_path: string, _opts: unknown, cb: (err: Error | undefined, data: string) => void) {
      readFileCalled = true;
      queueMicrotask(() => cb(undefined, 'file-contents'));
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
  return { client, wasReadFileCalled: () => readFileCalled };
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

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('SSHConnectionManagerImpl readFile size guard', () => {
  it('远端文件大小超过上限时在读取前 reject，且不调用 sftp.readFile', async () => {
    process.env['OPENAWORK_SSH_READ_MAX_BYTES'] = '64';
    const fake = makeSftpClient({ statSize: 10_000 });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c1', fake.client as never]]),
    });
    mgr.addConnection(conn('c1'));

    await expect(mgr.readFile('c1', '/var/log/huge.log')).rejects.toThrow(
      /SSH file too large to preview/,
    );
    // The oversized file must be refused BEFORE buffering it into memory.
    expect(fake.wasReadFileCalled()).toBe(false);
  });

  it('远端文件在上限内时正常预览', async () => {
    process.env['OPENAWORK_SSH_READ_MAX_BYTES'] = '1048576';
    const fake = makeSftpClient({ statSize: 1234 });
    const mgr = new SSHConnectionManagerImpl({
      clients: new Map([['c2', fake.client as never]]),
    });
    mgr.addConnection(conn('c2'));

    const result = await mgr.readFile('c2', '/etc/hosts');
    expect(result.content).toBe('file-contents');
    expect(result.truncated).toBe(false);
    expect(fake.wasReadFileCalled()).toBe(true);
  });
});
