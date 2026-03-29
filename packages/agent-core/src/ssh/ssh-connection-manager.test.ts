import { describe, expect, it } from 'vitest';
import { SSHConnectionManagerImpl } from './ssh-connection-manager.js';

type FakeDirent = {
  filename: string;
  longname?: string;
  attrs?: { isDirectory?: () => boolean };
};

type FakeSftp = {
  readFile: (
    path: string,
    opts: { encoding?: string },
    cb: (err: Error | undefined, data: string | Buffer) => void,
  ) => void;
  writeFile: (
    path: string,
    data: string | Uint8Array,
    opts: { encoding?: string },
    cb: (err: Error | undefined) => void,
  ) => void;
  readdir: (path: string, cb: (err: Error | undefined, list: FakeDirent[]) => void) => void;
};

type FakeSSHClient = {
  sftp: (cb: (err: Error | undefined, sftp: FakeSftp) => void) => void;
  exec: () => void;
  end: () => void;
  on: () => FakeSSHClient;
  connect: () => FakeSSHClient;
};

function createFakeClient(sftp: FakeSftp): FakeSSHClient {
  return {
    sftp: (cb) => cb(undefined, sftp),
    exec: () => undefined,
    end: () => undefined,
    on: () => createFakeClient(sftp),
    connect: () => createFakeClient(sftp),
  };
}

describe('SSHConnectionManagerImpl typed file UX', () => {
  it('lists typed file entries instead of plain strings', async () => {
    const fakeClient = createFakeClient({
      readFile: (_path, _opts, cb) => cb(undefined, ''),
      writeFile: (_path, _data, _opts, cb) => cb(undefined),
      readdir: (_path, handler) =>
        handler(undefined, [
          { filename: 'src', attrs: { isDirectory: () => true } },
          { filename: 'index.ts', attrs: { isDirectory: () => false } },
        ]),
    });
    const manager = new SSHConnectionManagerImpl({
      clients: new Map([['conn-1', fakeClient]]),
    });
    manager.addConnection({
      id: 'conn-1',
      name: 'Test',
      host: 'localhost',
      port: 22,
      username: 'root',
      authType: 'agent',
      status: 'connected',
      createdAt: Date.now(),
    });

    const list = await manager.listFiles('conn-1', '/remote');
    expect(list[0]).toMatchObject({
      name: expect.any(String),
      path: expect.any(String),
      kind: expect.stringMatching(/file|directory/),
    });
  });

  it('returns preview metadata when reading a file', async () => {
    const fakeClient = createFakeClient({
      readFile: (_path, _opts, handler) => handler(undefined, 'hello ssh'),
      writeFile: (_path, _data, _opts, cb) => cb(undefined),
      readdir: (_path, handler) => handler(undefined, []),
    });
    const manager = new SSHConnectionManagerImpl({
      clients: new Map([['conn-1', fakeClient]]),
    });
    manager.addConnection({
      id: 'conn-1',
      name: 'Test',
      host: 'localhost',
      port: 22,
      username: 'root',
      authType: 'agent',
      status: 'connected',
      createdAt: Date.now(),
    });

    const preview = await manager.readFile('conn-1', '/remote/file.txt');
    expect(preview).toMatchObject({
      path: '/remote/file.txt',
      encoding: 'utf8',
      truncated: expect.any(Boolean),
      content: expect.any(String),
    });
  });

  it('supports binary uploads via Uint8Array payloads', async () => {
    let received: Uint8Array | string | null = null;
    const fakeClient = createFakeClient({
      readFile: (_path, _opts, handler) => handler(undefined, ''),
      writeFile: (_path, data, _opts, handler) => {
        received = data;
        handler(undefined);
      },
      readdir: (_path, handler) => handler(undefined, []),
    });
    const manager = new SSHConnectionManagerImpl({
      clients: new Map([['conn-1', fakeClient]]),
    });
    manager.addConnection({
      id: 'conn-1',
      name: 'Test',
      host: 'localhost',
      port: 22,
      username: 'root',
      authType: 'agent',
      status: 'connected',
      createdAt: Date.now(),
    });

    await expect(
      manager.writeFile('conn-1', '/remote/image.png', new Uint8Array([1, 2, 3])),
    ).resolves.toBeUndefined();
    expect(received).toBeInstanceOf(Uint8Array);
  });
});
