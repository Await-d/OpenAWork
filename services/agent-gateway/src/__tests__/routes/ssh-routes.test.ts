import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SshRoutesModule from '../../routes/ssh.ts';
import type * as SshServiceModule from '../../ssh/ssh-service.ts';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sshRoutes: typeof SshRoutesModule.sshRoutes;
let sshServiceModule: typeof SshServiceModule;

interface FakeServiceState {
  connections: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    authType: 'password' | 'key' | 'agent';
    privateKeyPath: string | null;
    hasPassword: boolean;
    autoReconnect: boolean;
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    lastError: string | null;
    lastConnectedAt: number | null;
    createdAt: number;
    updatedAt: number;
  }>;
  failConnect?: (id: string) => Error;
  failListFiles?: (id: string) => Error;
  failReadFile?: (id: string, path: string) => Error;
  failUpload?: (id: string, path: string) => Error;
}

function buildFakeService(state: FakeServiceState): SshServiceModule.SshService {
  const fake = {
    listConnections: () => state.connections,
    getConnection: (_userId: string, id: string) =>
      state.connections.find((c) => c.id === id) ?? null,
    createConnection: () => state.connections[0]!,
    updateConnection: () => state.connections[0] ?? null,
    deleteConnection: async () => true,
    connect: async (_userId: string, id: string) => {
      if (state.failConnect) throw state.failConnect(id);
      return state.connections[0]!;
    },
    disconnect: async () => state.connections[0]!,
    listFiles: async (_userId: string, id: string, _path: string) => {
      if (state.failListFiles) throw state.failListFiles(id);
      return [];
    },
    readFile: async (_userId: string, id: string, path: string) => {
      if (state.failReadFile) throw state.failReadFile(id, path);
      return { path, content: 'demo', encoding: 'utf8' as const, truncated: false };
    },
    writeFile: async (_userId: string, id: string, path: string) => {
      if (state.failUpload) throw state.failUpload(id, path);
    },
    bindSession: () => ({ sessionId: 's', connectionId: 'c', updatedAt: 0 }),
    unbindSession: () => undefined,
    listBindings: () => [],
    listDialogs: () => [],
    upsertDialog: () => ({
      id: 'd',
      connectionId: 'c',
      title: null,
      cwd: '/',
      lastFilePath: null,
      lastFileEncoding: null,
      pinned: false,
      lastOpenedAt: 0,
    }),
    deleteDialog: () => true,
    getLastOpenedDialog: () => null,
  } as unknown as SshServiceModule.SshService;
  return fake;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sshRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: 'u-ssh-route', email: 'ssh@example.com' })}`;
}

beforeAll(async () => {
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  const sshRouteMod = await import('../../routes/ssh.js');
  sshRoutes = sshRouteMod.sshRoutes;
  sshServiceModule = await import('../../ssh/ssh-service.js');
});

beforeEach(() => {
  sshServiceModule.__resetSshServiceForTests(null);
});

afterAll(() => {
  sshServiceModule.__resetSshServiceForTests(null);
});

describe('ssh routes error mapping', () => {
  it('POST /ssh/connections/:id/connect 在连接不存在时返回 404 + 结构化 error', async () => {
    sshServiceModule.__resetSshServiceForTests(
      buildFakeService({
        connections: [],
        failConnect: (id) => new Error(`SSH connection not found: ${id}`),
      }),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/connections/ssh-1/connect',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'SSH 连接不存在。' });
    await app.close();
  });

  it('GET /ssh/files 在连接未建立时返回 409', async () => {
    sshServiceModule.__resetSshServiceForTests(
      buildFakeService({
        connections: [],
        failListFiles: (id) => new Error(`SSH client not connected: ${id}`),
      }),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/files?connectionId=ssh-1&path=/tmp',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'SSH 连接尚未建立。' });
    await app.close();
  });

  it('GET /ssh/file 在远端文件不存在时返回 404', async () => {
    sshServiceModule.__resetSshServiceForTests(
      buildFakeService({
        connections: [],
        failReadFile: () => {
          const error = new Error('ENOENT') as NodeJS.ErrnoException;
          error.code = 'ENOENT';
          return error;
        },
      }),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/file?connectionId=ssh-1&path=/tmp/missing.txt',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: '远端文件不存在。' });
    await app.close();
  });

  it('POST /ssh/upload 在未知异常时返回 500 + 原始消息', async () => {
    sshServiceModule.__resetSshServiceForTests(
      buildFakeService({
        connections: [],
        failUpload: () => new Error('upload failed: disk quota exceeded'),
      }),
    );

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/upload',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        connectionId: 'ssh-1',
        path: '/tmp/demo.txt',
        contentBase64: 'aGVsbG8=',
      },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: 'upload failed: disk quota exceeded' });
    await app.close();
  });
});

describe('ssh dialog routes', () => {
  it('GET /ssh/dialogs/last 返回最近一次的 dialog（包含 cwd / lastFilePath）', async () => {
    const lastDialog = {
      id: 'd-1',
      connectionId: 'c-1',
      title: '生产堡垒机',
      cwd: '/var/log',
      lastFilePath: '/var/log/syslog',
      lastFileEncoding: 'utf8' as const,
      pinned: true,
      lastOpenedAt: 1700000000000,
    };
    const fake = buildFakeService({ connections: [] });
    (fake as unknown as { getLastOpenedDialog: () => typeof lastDialog }).getLastOpenedDialog =
      () => lastDialog;
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/dialogs/last',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dialog: lastDialog });
    await app.close();
  });

  it('GET /ssh/dialogs/last 没有历史时返回 dialog: null', async () => {
    const fake = buildFakeService({ connections: [] });
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/dialogs/last',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ dialog: null });
    await app.close();
  });

  it('POST /ssh/dialogs/touch 把面板状态写回 service', async () => {
    let captured: unknown = null;
    const fake = buildFakeService({ connections: [] });
    (
      fake as unknown as {
        upsertDialog: (input: unknown) => unknown;
      }
    ).upsertDialog = (input: unknown) => {
      captured = input;
      return {
        id: 'd-1',
        connectionId: 'c-1',
        title: null,
        cwd: '/srv',
        lastFilePath: '/srv/a.log',
        lastFileEncoding: 'utf8',
        pinned: false,
        lastOpenedAt: 1700000000000,
      };
    };
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/dialogs/touch',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        connectionId: 'c-1',
        cwd: '/srv',
        lastFilePath: '/srv/a.log',
        lastFileEncoding: 'utf8',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as { dialog: { connectionId: string } };
    expect(body.dialog.connectionId).toBe('c-1');
    expect(captured).toMatchObject({
      userId: 'u-ssh-route',
      connectionId: 'c-1',
      cwd: '/srv',
      lastFilePath: '/srv/a.log',
      lastFileEncoding: 'utf8',
    });
    await app.close();
  });

  it('DELETE /ssh/dialogs/:id 找不到对话时返回 404', async () => {
    const fake = buildFakeService({ connections: [] });
    (fake as unknown as { deleteDialog: () => boolean }).deleteDialog = () => false;
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: '/ssh/dialogs/missing',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'SSH 对话不存在。' });
    await app.close();
  });

  it('GET /ssh/bindings 返回当前用户的 binding 列表', async () => {
    const fake = buildFakeService({ connections: [] });
    (fake as unknown as { listBindings: () => unknown[] }).listBindings = () => [
      { sessionId: 's-1', connectionId: 'c-1', updatedAt: 1700000000000 },
    ];
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/ssh/bindings',
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      bindings: [{ sessionId: 's-1', connectionId: 'c-1', updatedAt: 1700000000000 }],
    });
    await app.close();
  });

  it('POST /ssh/bindings/unbind 调用 service.unbindSession 并返回 ok', async () => {
    let captured: { userId?: string; sessionId?: string } = {};
    const fake = buildFakeService({ connections: [] });
    (
      fake as unknown as {
        unbindSession: (userId: string, sessionId: string) => void;
      }
    ).unbindSession = (userId: string, sessionId: string) => {
      captured = { userId, sessionId };
    };
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/ssh/bindings/unbind',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { sessionId: 's-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(captured).toEqual({ userId: 'u-ssh-route', sessionId: 's-1' });
    await app.close();
  });

  it('PATCH /ssh/connections/:id 不存在时返回 404', async () => {
    const fake = buildFakeService({ connections: [] });
    (
      fake as unknown as {
        updateConnection: () => null;
      }
    ).updateConnection = () => null;
    sshServiceModule.__resetSshServiceForTests(fake);

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/ssh/connections/missing',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { name: '改名' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'SSH 连接不存在。' });
    await app.close();
  });
});
