import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { SSHConnection, SSHConnectionManager, SSHFileBytes } from '@openAwork/agent-core';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SshServiceModule from '../../ssh/ssh-service.js';
import type * as SshStoreModule from '../../ssh/ssh-store.js';
import type * as WorkspaceRoutesModule from '../../routes/workspace.js';
import type * as UserWorkspaceAllowlistModule from '../../workspace/user-workspace-allowlist.js';

type ReadFileBytesImpl = (
  id: string,
  remotePath: string,
  options?: { maxBytes?: number },
) => Promise<SSHFileBytes>;

type ReadFileBytesMock = Mock<ReadFileBytesImpl>;

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-ssh-preview-routes-'));
const projectRoot = join(workspaceRoot, 'demo-project');
const MAX_FILE_BYTES = 100 * 1024;

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'ssh-preview-route-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let resetUserWorkspaceAllowlistCache: typeof UserWorkspaceAllowlistModule.__resetUserWorkspaceAllowlistCacheForTest;
let workspaceRoutes: typeof WorkspaceRoutesModule.workspaceRoutes;
let setSshService: typeof SshServiceModule.setSshService;
let resetSshServiceForTests: typeof SshServiceModule.__resetSshServiceForTests;
let SshServiceCtor: typeof SshServiceModule.SshService;
let createSshConnection: typeof SshStoreModule.createSshConnection;
let updateSshConnectionStatus: typeof SshStoreModule.updateSshConnectionStatus;
let migrateSshTables: typeof SshStoreModule.migrateSshTables;

const USER_ID = 'u-ssh-preview';
const SESSION_ID = 's-ssh-preview-local';
const SSH_SESSION_ID = 's-ssh-preview-remote';
const SSH_CONNECTION_ID = 'conn-ssh-preview';
const SSH_REMOTE_ROOT = '/home/dev/remote-project';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(workspaceRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'ssh-preview@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSshSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ssh', ?, 'idle')`,
    [
      sessionId,
      userId,
      JSON.stringify({ sshConnectionId: SSH_CONNECTION_ID, workingDirectory: SSH_REMOTE_ROOT }),
    ],
  );
}

/** 默认远端读取：原样返回文本内容（按 maxBytes 截断），不做真实连接。 */
const defaultReadFileBytes: ReadFileBytesImpl = async (_id, _remotePath, options) => {
  const content = Buffer.from('remote file contents', 'utf8');
  const maxBytes = options?.maxBytes ?? content.length;
  const data = content.subarray(0, Math.min(content.length, maxBytes));
  return {
    data,
    size: content.length,
    truncated: content.length > data.length,
    isDirectory: false,
  };
};

function createFakeSshManager(
  status: SSHConnection['status'],
  readFileBytesImpl: ReadFileBytesImpl = defaultReadFileBytes,
): { manager: SSHConnectionManager; readFileBytes: ReadFileBytesMock } {
  const readFileBytes = vi.fn<ReadFileBytesImpl>(readFileBytesImpl);
  const connection: SSHConnection = {
    id: SSH_CONNECTION_ID,
    name: 'test',
    host: 'example.com',
    port: 22,
    username: 'dev',
    authType: 'password',
    status,
    createdAt: Date.now(),
  };
  const manager: SSHConnectionManager = {
    addConnection: vi.fn(),
    getConnection: vi.fn(() => connection),
    listConnections: vi.fn(() => [connection]),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    execCommand: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    readFile: vi.fn(async () => ({
      path: '',
      content: '',
      encoding: 'utf8' as const,
      truncated: false,
    })),
    readFileBytes,
    writeFile: vi.fn(async () => undefined),
    listFiles: vi.fn(async () => []),
    getStatus: vi.fn(() => status),
  };
  return { manager, readFileBytes };
}

/** 注册假 SshService 并把指定会话绑定到 SSH_CONNECTION_ID。 */
function registerSshService(
  status: SSHConnection['status'],
  readFileBytesImpl: ReadFileBytesImpl = defaultReadFileBytes,
  sessionId: string = SSH_SESSION_ID,
): ReadFileBytesMock {
  const { manager, readFileBytes } = createFakeSshManager(status, readFileBytesImpl);
  const service = new SshServiceCtor({ manager });
  service.getBindings().bind(sessionId, SSH_CONNECTION_ID);
  setSshService(service);
  return readFileBytes;
}

function seedDraftConnection(status: 'connected' | 'disconnected'): string {
  const connectionId = createSshConnection({
    userId: USER_ID,
    name: 'draft',
    host: 'example.com',
    port: 22,
    username: 'dev',
    authType: 'agent',
  }).id;
  if (status === 'connected') updateSshConnectionStatus(connectionId, 'connected');
  return connectionId;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  workspaceRoutes = (await import('../../routes/workspace.js')).workspaceRoutes;
  resetUserWorkspaceAllowlistCache = (await import('../../workspace/user-workspace-allowlist.js'))
    .__resetUserWorkspaceAllowlistCacheForTest;
  const sshServiceModule = await import('../../ssh/ssh-service.js');
  setSshService = sshServiceModule.setSshService;
  resetSshServiceForTests = sshServiceModule.__resetSshServiceForTests;
  SshServiceCtor = sshServiceModule.SshService;
  const sshStoreModule = await import('../../ssh/ssh-store.js');
  createSshConnection = sshStoreModule.createSshConnection;
  updateSshConnectionStatus = sshStoreModule.updateSshConnectionStatus;
  migrateSshTables = sshStoreModule.migrateSshTables;
  migrateSshTables();
});

beforeEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(projectRoot, { recursive: true });
  dbModule.sqliteRun('DELETE FROM ssh_dialogs', []);
  dbModule.sqliteRun('DELETE FROM ssh_session_bindings', []);
  dbModule.sqliteRun('DELETE FROM ssh_connections', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  resetUserWorkspaceAllowlistCache();
  resetSshServiceForTests(null);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('GET /workspace/file — SSH 远程预览', () => {
  it('SSH 绑定会话读取远端文本，返回 {path, content, truncated} 且不触碰本地 fs', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    const readFileBytes = registerSshService('connected');

    const app = await buildApp();
    try {
      // path 是相对路径：本地分支会因校验失败返回 403，SSH 分支在本地校验前返回。
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src/app.ts')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}` +
          `&workspaceRoot=${encodeURIComponent('E:\\local\\ignored')}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        path: '/home/dev/remote-project/src/app.ts',
        content: 'remote file contents',
        truncated: false,
      });
      expect(readFileBytes).toHaveBeenCalledTimes(1);
      expect(readFileBytes.mock.calls[0]?.[1]).toBe('/home/dev/remote-project/src/app.ts');
      expect(readFileBytes.mock.calls[0]?.[2]).toEqual({ maxBytes: MAX_FILE_BYTES });
    } finally {
      await app.close();
    }
  });

  it('远端文本超过 100KB 时截断并标记 truncated', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    const size = MAX_FILE_BYTES * 2;
    const readFileBytes = registerSshService('connected', async (_id, _remotePath, options) => {
      const limit = options?.maxBytes ?? size;
      const data = Buffer.alloc(Math.min(size, limit), 97);
      return { data, size, truncated: size > data.length, isDirectory: false };
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('big.txt')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { content: string; truncated: boolean };
      expect(body.truncated).toBe(true);
      expect(body.content.length).toBe(MAX_FILE_BYTES);
      expect(readFileBytes).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('目标是目录时返回中文 400', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    registerSshService('connected', async () => ({
      data: Buffer.alloc(0),
      size: 0,
      truncated: false,
      isDirectory: true,
    }));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: '目标路径不是文件。' });
    } finally {
      await app.close();
    }
  });

  it('远端文件不存在时返回中文 404', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    registerSshService('connected', async () => {
      throw Object.assign(new Error('no such file'), { code: 'ENOENT' });
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('missing.ts')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: '目标文件不存在。' });
    } finally {
      await app.close();
    }
  });

  it('远端路径超出会话根目录时返回中文 403，且不发起读取', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    const readFileBytes = registerSshService('connected');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('/etc/passwd')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: '目标路径超出当前工作区范围。' });
      expect(readFileBytes).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('借用他人 SSH 绑定会话返回 404，且绝不触发远端读取', async () => {
    const otherUserId = 'u-ssh-preview-other';
    const otherSessionId = 's-ssh-preview-other';
    seedUser(otherUserId);
    seedSshSession(otherSessionId, otherUserId);
    const readFileBytes = registerSshService('connected', defaultReadFileBytes, otherSessionId);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src/app.ts')}` +
          `&sessionId=${encodeURIComponent(otherSessionId)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: '会话不存在或无权访问。' });
      expect(readFileBytes).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('借用他人「非 SSH 绑定」会话不再 404，而是回退本地读取', async () => {
    const otherUserId = 'u-ssh-preview-other-local';
    const otherSessionId = 's-ssh-preview-other-local';
    seedUser(otherUserId);
    // 他人会话：纯本地工作区，未绑定任何 SSH 连接。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'local', ?, 'idle')`,
      [otherSessionId, otherUserId, JSON.stringify({ workingDirectory: projectRoot })],
    );
    // 当前用户需要一个本地会话才能通过受限模式下的工作区白名单校验。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'local', ?, 'idle')`,
      [SESSION_ID, USER_ID, JSON.stringify({ workingDirectory: projectRoot })],
    );
    registerSshService('connected');
    const filePath = join(projectRoot, 'other-user-local.txt');
    writeFileSync(filePath, 'local contents', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent(filePath)}` +
          `&sessionId=${encodeURIComponent(otherSessionId)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        path: filePath,
        content: 'local contents',
        truncated: false,
      });
    } finally {
      await app.close();
    }
  });

  it('绑定会话的 SSH 连接不可用时返回中文 409', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    registerSshService('error');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src/app.ts')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as { error: string };
      expect(body.error).toContain('dev@example.com:22');
      expect(body.error).toContain('连接失败');
    } finally {
      await app.close();
    }
  });

  it('草稿会话的 SSH 连接未连接时返回 409', async () => {
    registerSshService('connected');
    const connectionId = seedDraftConnection('disconnected');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src/app.ts')}` +
          `&sshConnectionId=${encodeURIComponent(connectionId)}` +
          `&workspaceRoot=${encodeURIComponent(SSH_REMOTE_ROOT)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(409);
      const body = response.json() as { error: string };
      expect(body.error).toContain('example.com:22');
      expect(body.error).toContain('未连接');
    } finally {
      await app.close();
    }
  });

  it('草稿会话的远端根不是绝对 POSIX 路径时返回中文 400', async () => {
    registerSshService('connected');
    const connectionId = seedDraftConnection('connected');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent('src/app.ts')}` +
          `&sshConnectionId=${encodeURIComponent(connectionId)}` +
          `&workspaceRoot=${encodeURIComponent('relative/project')}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'SSH 远程工作区路径必须是绝对 POSIX 路径。',
      });
    } finally {
      await app.close();
    }
  });

  it('未提供 SSH 标识时保持既有本地行为', async () => {
    registerSshService('connected');
    const filePath = join(projectRoot, 'local.txt');
    writeFileSync(filePath, 'local contents', 'utf8');
    // 受限访问模式下本地读取要求路径落在用户工作区白名单内，而白名单由该用户
    // 会话的 `workingDirectory` 推导；先种一个本地会话，具备合法工作区。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'local', ?, 'idle')`,
      [SESSION_ID, USER_ID, JSON.stringify({ workingDirectory: projectRoot })],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/workspace/file?path=${encodeURIComponent(filePath)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        path: filePath,
        content: 'local contents',
        truncated: false,
      });
    } finally {
      await app.close();
    }
  });
});

describe('GET /workspace/file/binary — SSH 远程预览', () => {
  it('远程二进制返回正确 Content-Type 与原始字节', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    const payload = Buffer.from('%PDF-1.4 remote', 'utf8');
    registerSshService('connected', async () => ({
      data: payload,
      size: payload.length,
      truncated: false,
      isDirectory: false,
    }));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file/binary?path=${encodeURIComponent('report.pdf')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-length']).toBe(String(payload.length));
      expect(response.rawPayload.equals(payload)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('远程二进制超过 100KB 时返回中文 413', async () => {
    seedSshSession(SSH_SESSION_ID, USER_ID);
    registerSshService('connected', async () => ({
      data: Buffer.alloc(0),
      size: MAX_FILE_BYTES * 2,
      truncated: true,
      isDirectory: false,
    }));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file/binary?path=${encodeURIComponent('big.pdf')}` +
          `&sessionId=${encodeURIComponent(SSH_SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({ error: '文件体积超过预览限制，暂不支持预览。' });
    } finally {
      await app.close();
    }
  });
});
