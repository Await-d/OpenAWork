/**
 * 会话任务图跨主机工作区的降级契约。
 *
 * 背景（SSH 开发场景）：会话绑定 SSH 远端 POSIX 工作区（`sshConnectionId` +
 * `workingDirectory`）时，metadata 读路径会跳过本地 workspace roots 校验（见
 * session-workspace-metadata.ts 的 SSH 分支），路径被原样保留。若网关此刻运行在
 * Windows / macOS 上，`resolveTaskGraphProjectRoot` 内部的
 * `assertWorkspacePathSupportedByCurrentHost` 就会为**每个** graph session 抛
 * 「当前网关运行在 X，无法访问 POSIX 路径：…」。
 *
 * 该错误原本在 `buildMergedSessionTaskProjection` 的 `Promise.all` 里整体冒泡，
 * 命中全局 error-handler 的兜底分支被替换成「服务器内部错误。」，导致
 * `GET /sessions/:id/recovery` / `status` / `tasks` 三处一起 500 —— 而任务列表
 * 只是 recovery read model 的**附属数据**，会话消息本体完全可以正常渲染。
 *
 * 这里直接 mock `resolveTaskGraphProjectRoot` 抛跨主机错误，使断言不依赖宿主
 * 操作系统（在 Linux CI 上复现 Windows 网关的行为，反之亦然）。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const CROSS_HOST_MESSAGE =
  '当前网关运行在 Windows，无法访问 POSIX 路径：/home/await/project/OpenAWork。' +
  '该路径位于其他设备的文件系统上。请将会话工作区切换到当前设备可访问的目录，' +
  '或用 SSH 远程连接绑定该主机后再访问。';

const mocks = vi.hoisted(() => ({
  resolveTaskGraphProjectRoot: vi.fn<(sessionId: string) => string>(),
  taskManagerLoadOrCreate: vi.fn<
    (
      projectRoot: string,
      sessionId: string,
    ) => Promise<{
      tasks: Record<string, unknown>;
      updatedAt: number;
    }>
  >(() => Promise.resolve({ tasks: {}, updatedAt: 0 })),
  taskStoreDeleteGraph: vi.fn<(projectRoot: string, sessionId: string) => Promise<void>>(() =>
    Promise.resolve(),
  ),
}));

vi.mock('../../task/task-graph-root.js', () => ({
  resolveTaskGraphProjectRoot: mocks.resolveTaskGraphProjectRoot,
}));

vi.mock('@openAwork/agent-core', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentCoreModule>();
  return {
    ...actual,
    AgentTaskManagerImpl: class {
      loadOrCreate = mocks.taskManagerLoadOrCreate;
    },
    AgentTaskStoreImpl: class {
      deleteGraph = mocks.taskStoreDeleteGraph;
    },
  };
});

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-cross-host-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-cross-host-data-'));
const SESSION_ID = 'sess-cross-host';
const USER_ID = 'u-cross-host';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'cross-host-workspace-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

type DbModuleRef = typeof DbModule;
type AuthPluginRef = typeof AuthModule.default;
type RequestWorkflowPluginRef = typeof RequestWorkflowModule.default;
type SessionsRoutesRef = typeof SessionsRoutesModule.sessionsRoutes;

let dbModule: DbModuleRef;
let authPlugin: AuthPluginRef;
let requestWorkflowPlugin: RequestWorkflowPluginRef;
let sessionsRoutes: SessionsRoutesRef;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { registerErrorHandler } = await import('../../infra/error-handler.js');
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'cross-host@example.com' })}`;
}

/** 跨主机失败：任务图根解析直接抛裸 Error（与 workspace-paths.ts 的真实行为一致）。 */
function stubCrossHostFailure(): void {
  mocks.resolveTaskGraphProjectRoot.mockImplementation(() => {
    throw new Error(CROSS_HOST_MESSAGE);
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.taskManagerLoadOrCreate.mockImplementation(() =>
    Promise.resolve({ tasks: {}, updatedAt: 0 }),
  );
  mocks.taskStoreDeleteGraph.mockImplementation(() => Promise.resolve());
  mocks.resolveTaskGraphProjectRoot.mockReturnValue(workspaceRoot);

  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  dbModule.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'cross-host@example.com', 'x')",
    [USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '跨主机会话', ?, 'idle')`,
    [SESSION_ID, USER_ID, JSON.stringify({ workingDirectory: '/home/await/project/OpenAWork' })],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe('任务图跨主机工作区降级', () => {
  it('GET /sessions/:sessionId/recovery 在任务图不可访问时仍返回 200 与会话本体', async () => {
    stubCrossHostFailure();

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      // 核心回归锁：此前整体 500 InternalError，连会话消息都渲染不出来。
      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBeUndefined();
      expect(response.json().recovery.session.id).toBe(SESSION_ID);
      // 任务列表是附属数据，降级为空而不是拖垮整个 read model。
      expect(response.json().recovery.tasks).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/status 在任务图不可访问时仍返回 200', async () => {
    stubCrossHostFailure();

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/status`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/tasks 在任务图不可访问时仍返回 200 且 tasks 为空', async () => {
    stubCrossHostFailure();

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/tasks`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().tasks).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('非跨主机错误照常抛出，不被降级逻辑吞掉', async () => {
    mocks.resolveTaskGraphProjectRoot.mockImplementation(() => {
      throw new Error('任务图存储损坏：unexpected end of json');
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(500);
      expect(response.json().name).toBe('InternalError');
    } finally {
      await app.close();
    }
  });

  it('DELETE /sessions/:sessionId 在任务图不可访问时仍能删除会话本体', async () => {
    stubCrossHostFailure();

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });

      // 会话删除是本地 SQLite 操作，与任务图所在设备无关，不能被跨主机错误阻塞。
      expect(response.statusCode).not.toBe(500);
      const remaining = dbModule.sqliteGet<{ id: string }>('SELECT id FROM sessions WHERE id = ?', [
        SESSION_ID,
      ]);
      expect(remaining).toBeUndefined();
      // 任务图根不可解析时不应调用清理，避免误删其它设备的 graph。
      expect(mocks.taskStoreDeleteGraph).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
