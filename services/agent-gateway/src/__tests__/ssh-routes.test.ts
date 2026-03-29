import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listFilesMock,
  readFileMock,
  writeFileMock,
  connectMock,
  disconnectMock,
  listConnectionsMock,
  addConnectionMock,
  bindMock,
} = vi.hoisted(() => ({
  listFilesMock: vi.fn(async () => [
    { name: 'src', path: '/remote/src', kind: 'directory' },
    { name: 'index.ts', path: '/remote/index.ts', kind: 'file' },
  ]),
  readFileMock: vi.fn(async () => ({
    path: '/remote/index.ts',
    content: 'console.log(1)',
    encoding: 'utf8',
    truncated: false,
  })),
  writeFileMock: vi.fn(async () => undefined),
  connectMock: vi.fn(async () => undefined),
  disconnectMock: vi.fn(async () => undefined),
  listConnectionsMock: vi.fn(() => []),
  addConnectionMock: vi.fn(),
  bindMock: vi.fn(),
}));

vi.mock('../auth.js', () => ({ requireAuth: async () => undefined }));
vi.mock('../request-workflow.js', () => ({
  startRequestWorkflow: () => ({
    workflowLogger: { succeed: () => undefined, fail: () => undefined },
    step: { succeed: () => undefined, fail: () => undefined },
  }),
}));

vi.mock('@openAwork/agent-core', () => ({
  SSHConnectionManagerImpl: vi.fn(() => ({
    listConnections: listConnectionsMock,
    addConnection: addConnectionMock,
    connect: connectMock,
    disconnect: disconnectMock,
    listFiles: listFilesMock,
    readFile: readFileMock,
    writeFile: writeFileMock,
  })),
  SSHSessionBindingRegistry: class {
    bind = bindMock;
  },
  sshSessionBindings: { bind: bindMock },
  default: {
    SSHConnectionManagerImpl: vi.fn(() => ({
      listConnections: listConnectionsMock,
      addConnection: addConnectionMock,
      connect: connectMock,
      disconnect: disconnectMock,
      listFiles: listFilesMock,
      readFile: readFileMock,
      writeFile: writeFileMock,
    })),
    SSHSessionBindingRegistry: class {
      bind = bindMock;
    },
  },
}));

import { sshRoutes } from '../routes/ssh.js';

let app: ReturnType<typeof Fastify>;

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(sshRoutes);
  await app.ready();
});

describe('sshRoutes', () => {
  it('returns typed file entries from /ssh/files', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/files?connectionId=conn-1&path=%2Fremote',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      entries: [
        { name: 'src', path: '/remote/src', kind: 'directory' },
        { name: 'index.ts', path: '/remote/index.ts', kind: 'file' },
      ],
    });
  });

  it('returns preview payload from /ssh/file', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/file?connectionId=conn-1&path=%2Fremote%2Findex.ts',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      preview: {
        path: '/remote/index.ts',
        content: 'console.log(1)',
        encoding: 'utf8',
        truncated: false,
      },
    });
  });

  it('uploads base64 content through /ssh/upload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/upload',
      payload: {
        connectionId: 'conn-1',
        path: '/remote/file.bin',
        contentBase64: Buffer.from('abc').toString('base64'),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(writeFileMock).toHaveBeenCalledWith(
      'conn-1',
      '/remote/file.bin',
      new Uint8Array([97, 98, 99]),
    );
  });
});
