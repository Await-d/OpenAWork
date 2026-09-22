import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTaskStatus } from '@openAwork/agent-core';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as QuestionsRoutesModule from '../../routes/questions.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as TaskGraphRootModule from '../../task/task-graph-root.js';
import type * as ToolSandboxModule from '../../tools/tool-sandbox.js';

const TEST_ROOT = join(tmpdir(), `openawork-stop-child-sessions-${process.pid}`);

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'stop-child-sessions-route-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ROOT'] = TEST_ROOT;
process.env['OPENAWORK_DATA_DIR'] = join(TEST_ROOT, 'data');

const mocks = vi.hoisted(() => ({
  failingChildSessionId: null as string | null,
}));

vi.mock('../../tools/tool-sandbox.js', async () => {
  const actual = await vi.importActual<typeof ToolSandboxModule>('../../tools/tool-sandbox.js');
  return {
    ...actual,
    terminateChildSession: async (input: Parameters<typeof actual.terminateChildSession>[0]) => {
      if (mocks.failingChildSessionId === input.childSessionId) {
        throw new Error('模拟终止失败');
      }
      return actual.terminateChildSession(input);
    },
  };
});

let agentCore: typeof AgentCoreModule;
let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let questionsRoutes: typeof QuestionsRoutesModule.questionsRoutes;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;
let taskGraphRoot: typeof TaskGraphRootModule;

const USER_ID = 'u-stop-children-route';
const OTHER_USER_ID = 'u-stop-children-route-other';
const PARENT_ID = 'sess-stop-children-parent';
const OTHER_PARENT_ID = 'sess-stop-children-other-parent';
const PAUSED_CHILD_ID = 'sess-stop-children-paused';
const RUNNING_CHILD_ID = 'sess-stop-children-running';
const TERMINAL_CHILD_ID = 'sess-stop-children-terminal';
const NO_TASK_CHILD_ID = 'sess-stop-children-no-task';
const FOREIGN_CHILD_ID = 'sess-stop-children-foreign';

interface SeedResult {
  pausedChildTaskId: string;
  runningChildTaskId: string;
  terminalChildTaskId: string;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { registerErrorHandler } = await import('../../infra/error-handler.js');
  const { default: requestWorkflowPlugin } = await import('../../runtime/request-workflow.js');
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.register(permissionsRoutes);
  await app.register(questionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(input: {
  id: string;
  parentSessionId?: string;
  stateStatus: string;
  userId?: string;
}): void {
  const metadata = input.parentSessionId ? { parentSessionId: input.parentSessionId } : {};
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'stop children session', ?, ?)`,
    [input.id, input.userId ?? USER_ID, JSON.stringify(metadata), input.stateStatus],
  );
}

function seedPermissionRequest(input: {
  requestId: string;
  sessionId: string;
  status?: 'pending' | 'deciding';
}): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
      (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, 'bash', 'ls -la', 'inspect workspace', 'medium', 'ls -la', ?, NULL, NULL, ?)`,
    [
      input.requestId,
      input.sessionId,
      JSON.stringify({ clientRequestId: `client-${input.requestId}` }),
      input.status ?? 'pending',
    ],
  );
}

function seedQuestionRequest(input: {
  requestId: string;
  sessionId: string;
  status?: 'pending' | 'deciding';
}): void {
  dbModule.sqliteRun(
    `INSERT INTO question_requests
      (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
     VALUES (?, ?, ?, 'AskUserQuestion', '请选择目录', '[]', NULL, ?, NULL, ?)`,
    [
      input.requestId,
      input.sessionId,
      USER_ID,
      JSON.stringify({ clientRequestId: `client-${input.requestId}` }),
      input.status ?? 'pending',
    ],
  );
}

async function seedChildTask(input: {
  parentSessionId: string;
  childSessionId: string;
  status: AgentTaskStatus;
}): Promise<string> {
  const taskManager = new agentCore.AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(
    taskGraphRoot.resolveTaskGraphProjectRoot(input.parentSessionId),
    input.parentSessionId,
  );
  const task = taskManager.addTask(graph, {
    title: `子任务 ${input.childSessionId}`,
    status: input.status,
    blockedBy: [],
    priority: 'medium',
    sessionId: input.childSessionId,
    tags: [],
  });
  await taskManager.save(graph);
  return task.id;
}

async function seedFixtures(): Promise<SeedResult> {
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
  seedSession({ id: PARENT_ID, stateStatus: 'running' });
  seedSession({ id: OTHER_PARENT_ID, stateStatus: 'idle', userId: OTHER_USER_ID });
  seedSession({
    id: PAUSED_CHILD_ID,
    parentSessionId: PARENT_ID,
    stateStatus: 'paused',
  });
  seedSession({
    id: RUNNING_CHILD_ID,
    parentSessionId: PARENT_ID,
    stateStatus: 'running',
  });
  seedSession({
    id: TERMINAL_CHILD_ID,
    parentSessionId: PARENT_ID,
    stateStatus: 'idle',
  });
  seedSession({
    id: NO_TASK_CHILD_ID,
    parentSessionId: PARENT_ID,
    stateStatus: 'paused',
  });
  seedSession({
    id: FOREIGN_CHILD_ID,
    parentSessionId: OTHER_PARENT_ID,
    stateStatus: 'paused',
  });

  seedPermissionRequest({ requestId: 'perm-paused-pending', sessionId: PAUSED_CHILD_ID });
  seedPermissionRequest({
    requestId: 'perm-paused-deciding',
    sessionId: PAUSED_CHILD_ID,
    status: 'deciding',
  });
  seedPermissionRequest({ requestId: 'perm-running-pending', sessionId: RUNNING_CHILD_ID });
  seedQuestionRequest({ requestId: 'q-paused-pending', sessionId: PAUSED_CHILD_ID });
  seedQuestionRequest({
    requestId: 'q-running-deciding',
    sessionId: RUNNING_CHILD_ID,
    status: 'deciding',
  });

  return {
    pausedChildTaskId: await seedChildTask({
      parentSessionId: PARENT_ID,
      childSessionId: PAUSED_CHILD_ID,
      status: 'running',
    }),
    runningChildTaskId: await seedChildTask({
      parentSessionId: PARENT_ID,
      childSessionId: RUNNING_CHILD_ID,
      status: 'running',
    }),
    terminalChildTaskId: await seedChildTask({
      parentSessionId: PARENT_ID,
      childSessionId: TERMINAL_CHILD_ID,
      status: 'completed',
    }),
  };
}

function readSession(sessionId: string): { metadata_json: string; state_status: string } {
  const row = dbModule.sqliteGet<{ metadata_json: string; state_status: string }>(
    'SELECT metadata_json, state_status FROM sessions WHERE id = ? LIMIT 1',
    [sessionId],
  );
  if (!row) {
    throw new Error(`session ${sessionId} missing`);
  }
  return row;
}

async function readTaskStatus(parentSessionId: string, taskId: string): Promise<string | null> {
  const taskManager = new agentCore.AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(
    taskGraphRoot.resolveTaskGraphProjectRoot(parentSessionId),
    parentSessionId,
  );
  return graph.tasks[taskId]?.status ?? null;
}

function readPendingCount(table: 'permission_requests' | 'question_requests'): number {
  return (
    dbModule.sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count FROM ${table} WHERE status IN ('pending', 'deciding')`,
    )?.count ?? 0
  );
}

beforeAll(async () => {
  mkdirSync(TEST_ROOT, { recursive: true });
  writeFileSync(join(TEST_ROOT, 'pnpm-workspace.yaml'), 'packages: []\n');
  agentCore = await import('@openAwork/agent-core');
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  permissionsRoutes = (await import('../../routes/permissions.js')).permissionsRoutes;
  questionsRoutes = (await import('../../routes/questions.js')).questionsRoutes;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
  taskGraphRoot = await import('../../task/task-graph-root.js');
}, 120_000);

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  mocks.failingChildSessionId = null;
  rmSync(join(TEST_ROOT, '.agentdocs'), { recursive: true, force: true });
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(TEST_ROOT, { recursive: true, force: true });
}, 30_000);

describe('POST /sessions/:sessionId/children/stop', () => {
  it('Given 直系子代理混合状态 When all=true Then 停止非终态子代理并清空暂停子代理的待处理交互', async () => {
    const { pausedChildTaskId, runningChildTaskId, terminalChildTaskId } = await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { all: true },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        stopped: string[];
        skipped: Array<{ childSessionId: string; reason: string }>;
        failed: unknown[];
        interactions: { permissions: number; questions: number };
      };
      expect([...result.stopped].sort()).toEqual(
        [NO_TASK_CHILD_ID, PAUSED_CHILD_ID, RUNNING_CHILD_ID].sort(),
      );
      expect(result.skipped).toEqual([]);
      expect(result.failed).toEqual([]);
      expect(result.interactions).toEqual({ permissions: 3, questions: 2 });

      expect(await readTaskStatus(PARENT_ID, pausedChildTaskId)).toBe('cancelled');
      expect(await readTaskStatus(PARENT_ID, runningChildTaskId)).toBe('cancelled');
      const cancelledNotices = dbModule.sqliteAll<{ id: string; data: string }>(
        `SELECT id, data FROM message_v2 WHERE session_id = ?
         AND json_extract(data, '$.role') = 'synthetic'`,
        [PARENT_ID],
      );
      expect(cancelledNotices).toHaveLength(2);
      expect(
        cancelledNotices.every((notice) => JSON.parse(notice.data).metadata?.state === 'cancelled'),
      ).toBe(true);
      expect(
        dbModule.sqliteGet<{ count: number }>(
          'SELECT COUNT(*) AS count FROM task_jobs WHERE status = ?',
          ['cancelled'],
        )?.count,
      ).toBe(0);
      expect(await readTaskStatus(PARENT_ID, terminalChildTaskId)).toBe('completed');

      expect(readSession(PAUSED_CHILD_ID).state_status).toBe('idle');
      expect(readSession(RUNNING_CHILD_ID).state_status).toBe('idle');
      expect(readSession(NO_TASK_CHILD_ID).state_status).toBe('idle');
      expect(JSON.parse(readSession(PAUSED_CHILD_ID).metadata_json)['terminalReason']).toBe(
        'cancelled',
      );
      expect(JSON.parse(readSession(NO_TASK_CHILD_ID).metadata_json)['terminalReason']).toBe(
        'cancelled',
      );

      const permissions = await app.inject({
        method: 'GET',
        url: `/sessions/${PAUSED_CHILD_ID}/permissions/pending`,
        headers: { authorization: bearer(app) },
      });
      expect(permissions.statusCode).toBe(200);
      expect(permissions.json()).toEqual({ requests: [] });

      const questions = await app.inject({
        method: 'GET',
        url: `/sessions/${PAUSED_CHILD_ID}/questions/pending`,
        headers: { authorization: bearer(app) },
      });
      expect(questions.statusCode).toBe(200);
      expect(questions.json()).toEqual({ requests: [] });
    } finally {
      await app.close();
    }
  });

  it('Given 只指定一个直系子代理 When childSessionIds Then 只停止该子代理且不影响其它子代理交互', async () => {
    const { pausedChildTaskId, runningChildTaskId } = await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { childSessionIds: [PAUSED_CHILD_ID] },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        stopped: string[];
        skipped: unknown[];
        failed: unknown[];
        interactions: { permissions: number; questions: number };
      };
      expect(result.stopped).toEqual([PAUSED_CHILD_ID]);
      expect(result.skipped).toEqual([]);
      expect(result.interactions).toEqual({ permissions: 2, questions: 1 });

      expect(await readTaskStatus(PARENT_ID, pausedChildTaskId)).toBe('cancelled');
      expect(await readTaskStatus(PARENT_ID, runningChildTaskId)).toBe('running');
      expect(readSession(PAUSED_CHILD_ID).state_status).toBe('idle');
      expect(readSession(RUNNING_CHILD_ID).state_status).toBe('running');
      expect(readPendingCount('permission_requests')).toBe(1);
      expect(readPendingCount('question_requests')).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('Given 非直系子代理 When childSessionIds Then 以 not_direct_child 跳过', async () => {
    await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { childSessionIds: [FOREIGN_CHILD_ID] },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        stopped: string[];
        skipped: Array<{ childSessionId: string; reason: string }>;
      };
      expect(result.stopped).toEqual([]);
      expect(result.skipped).toEqual([
        { childSessionId: FOREIGN_CHILD_ID, reason: 'not_direct_child' },
      ]);
      expect(readSession(FOREIGN_CHILD_ID).state_status).toBe('paused');
    } finally {
      await app.close();
    }
  });

  it('Given 未知会话 id When childSessionIds Then 以 not_found 跳过', async () => {
    await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { childSessionIds: ['sess-stop-children-missing'] },
      });

      expect(response.statusCode).toBe(200);
      expect(
        (response.json() as { skipped: Array<{ childSessionId: string; reason: string }> }).skipped,
      ).toEqual([{ childSessionId: 'sess-stop-children-missing', reason: 'not_found' }]);
    } finally {
      await app.close();
    }
  });

  it('Given 任务已终态的子代理 When childSessionIds Then 以 already_terminal 跳过且任务状态不变', async () => {
    const { terminalChildTaskId } = await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { childSessionIds: [TERMINAL_CHILD_ID] },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        stopped: string[];
        skipped: Array<{ childSessionId: string; reason: string }>;
      };
      expect(result.stopped).toEqual([]);
      expect(result.skipped).toEqual([
        { childSessionId: TERMINAL_CHILD_ID, reason: 'already_terminal' },
      ]);
      expect(await readTaskStatus(PARENT_ID, terminalChildTaskId)).toBe('completed');
    } finally {
      await app.close();
    }
  });

  it('Given 单个子代理终止抛错 When childSessionIds Then 该子代理记入 failed 且其余子代理仍被停止', async () => {
    await seedFixtures();
    mocks.failingChildSessionId = RUNNING_CHILD_ID;
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { childSessionIds: [RUNNING_CHILD_ID, PAUSED_CHILD_ID] },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        stopped: string[];
        failed: Array<{ childSessionId: string; error: string }>;
        interactions: { permissions: number; questions: number };
      };
      expect(result.stopped).toEqual([PAUSED_CHILD_ID]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]?.childSessionId).toBe(RUNNING_CHILD_ID);
      expect(result.failed[0]?.error).toContain('模拟终止失败');
      expect(result.interactions).toEqual({ permissions: 2, questions: 1 });
      expect(readSession(PAUSED_CHILD_ID).state_status).toBe('idle');
      // 失败子代理不做部分突变：其待处理交互保持原状，调用方可重试。
      expect(readPendingCount('permission_requests')).toBe(1);
      expect(readPendingCount('question_requests')).toBe(1);
    } finally {
      await app.close();
    }
  });

  it('Given 父会话不属于当前用户 When 停止 Then 返回 404', async () => {
    await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${OTHER_PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { all: true },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: '目标会话不存在。' });
    } finally {
      await app.close();
    }
  });

  it('Given 既未传 childSessionIds 也未传 all When 停止 Then 返回 400 校验错误', async () => {
    await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const payload = response.json() as { name: string; data: { kind?: string; message: string } };
      expect(payload.name).toBe('BadRequest');
      expect(payload.data.kind).toBe('Body');
    } finally {
      await app.close();
    }
  });

  it('Given body 含未知键 When 停止 Then 返回 400（strict 校验拒绝）', async () => {
    await seedFixtures();
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/children/stop`,
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload: { all: true, unexpected: 1 },
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
