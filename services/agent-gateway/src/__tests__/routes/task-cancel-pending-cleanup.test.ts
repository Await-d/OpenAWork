import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as QuestionsRoutesModule from '../../routes/questions.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as TaskGraphRootModule from '../../task/task-graph-root.js';

const TEST_ROOT = join(tmpdir(), `openawork-task-cancel-cleanup-${process.pid}`);

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'task-cancel-cleanup-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ROOT'] = TEST_ROOT;
process.env['OPENAWORK_DATA_DIR'] = join(TEST_ROOT, 'data');

let agentCore: typeof AgentCoreModule;
let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let questionsRoutes: typeof QuestionsRoutesModule.questionsRoutes;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;
let taskGraphRoot: typeof TaskGraphRootModule;

const USER_ID = 'u-task-cancel-cleanup';
const PARENT_ID = 'sess-task-cancel-parent';
const PAUSED_CHILD_ID = 'sess-task-cancel-paused-child';

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

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

function seedSession(input: { id: string; parentSessionId?: string; stateStatus: string }): void {
  const metadata = input.parentSessionId ? { parentSessionId: input.parentSessionId } : {};
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'task cancel cleanup', ?, ?)`,
    [input.id, USER_ID, JSON.stringify(metadata), input.stateStatus],
  );
}

function seedPermissionRequest(input: { requestId: string; sessionId: string }): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
      (id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, expires_at, always_json, status)
     VALUES (?, ?, 'bash', 'ls -la', 'inspect workspace', 'medium', 'ls -la', ?, NULL, NULL, 'pending')`,
    [
      input.requestId,
      input.sessionId,
      JSON.stringify({ clientRequestId: `client-${input.requestId}` }),
    ],
  );
}

function seedQuestionRequest(input: { requestId: string; sessionId: string }): void {
  dbModule.sqliteRun(
    `INSERT INTO question_requests
      (id, session_id, user_id, tool_name, title, questions_json, answer_json, request_payload_json, expires_at, status)
     VALUES (?, ?, ?, 'AskUserQuestion', '请选择目录', '[]', NULL, ?, NULL, 'pending')`,
    [
      input.requestId,
      input.sessionId,
      USER_ID,
      JSON.stringify({ clientRequestId: `client-${input.requestId}` }),
    ],
  );
}

function seedPermissionNotification(input: { requestId: string; sessionId: string }): string {
  const notificationId = `notification-${input.requestId}`;
  dbModule.sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, title, body, status)
     VALUES (?, ?, ?, 'permission_asked', '权限申请', ?, 'unread')`,
    [notificationId, USER_ID, input.sessionId, `requestId=${input.requestId}\n请审批`],
  );
  return notificationId;
}

async function seedChildTask(): Promise<string> {
  const taskManager = new agentCore.AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(
    taskGraphRoot.resolveTaskGraphProjectRoot(PARENT_ID),
    PARENT_ID,
  );
  const task = taskManager.addTask(graph, {
    title: '子任务 暂停等待审批',
    status: 'running',
    blockedBy: [],
    priority: 'medium',
    sessionId: PAUSED_CHILD_ID,
    tags: [],
  });
  await taskManager.save(graph);
  return task.id;
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
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  rmSync(join(TEST_ROOT, '.agentdocs'), { recursive: true, force: true });
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(TEST_ROOT, { recursive: true, force: true });
}, 30_000);

describe('POST /sessions/:sessionId/tasks/:taskId/cancel 的 pending 清理', () => {
  it('取消子任务会连带作废暂停子会话的待审批/待提问，且状态不再回弹 paused', async () => {
    dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      USER_ID,
      `${USER_ID}@example.com`,
    ]);
    seedSession({ id: PARENT_ID, stateStatus: 'running' });
    seedSession({ id: PAUSED_CHILD_ID, parentSessionId: PARENT_ID, stateStatus: 'paused' });
    seedPermissionRequest({ requestId: 'perm-cancel-pending', sessionId: PAUSED_CHILD_ID });
    seedQuestionRequest({ requestId: 'q-cancel-pending', sessionId: PAUSED_CHILD_ID });
    const notificationId = seedPermissionNotification({
      requestId: 'perm-cancel-pending',
      sessionId: PAUSED_CHILD_ID,
    });
    const taskId = await seedChildTask();

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/tasks/${taskId}/cancel`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const result = response.json() as {
        cancelled: boolean;
        cancelledPermissions: number;
        cancelledQuestions: number;
        stopped: boolean;
      };
      expect(result.cancelled).toBe(true);
      expect(result.stopped).toBe(false);
      expect(result.cancelledPermissions).toBe(1);
      expect(result.cancelledQuestions).toBe(1);

      const permissionRow = dbModule.sqliteGet<{ status: string; decision: string | null }>(
        'SELECT status, decision FROM permission_requests WHERE id = ?',
        ['perm-cancel-pending'],
      );
      expect(permissionRow).toEqual({ status: 'rejected', decision: 'reject' });

      const questionRow = dbModule.sqliteGet<{ status: string }>(
        'SELECT status FROM question_requests WHERE id = ?',
        ['q-cancel-pending'],
      );
      expect(questionRow?.status).toBe('dismissed');

      const notificationRow = dbModule.sqliteGet<{ status: string }>(
        'SELECT status FROM notifications WHERE id = ?',
        [notificationId],
      );
      expect(notificationRow?.status).toBe('read');

      const childSession = dbModule.sqliteGet<{
        metadata_json: string;
        state_status: string;
      }>('SELECT metadata_json, state_status FROM sessions WHERE id = ?', [PAUSED_CHILD_ID]);
      expect(childSession?.state_status).toBe('idle');
      expect(JSON.parse(childSession?.metadata_json ?? '{}').terminalReason).toBe('cancelled');

      // 关键回归：没有任何 pending 交互后，reconcile 不能把已终止的子会话掰回 paused。
      const { reconcileSessionRuntime } =
        await import('../../session/session-runtime-reconciler.js');
      const reconciliation = await reconcileSessionRuntime({
        sessionId: PAUSED_CHILD_ID,
        userId: USER_ID,
      });
      expect(reconciliation.wasReset).toBe(false);
      expect(reconciliation.status).toBe('idle');
      expect(
        dbModule.sqliteGet<{ state_status: string }>(
          'SELECT state_status FROM sessions WHERE id = ?',
          [PAUSED_CHILD_ID],
        )?.state_status,
      ).toBe('idle');
    } finally {
      await app.close();
    }
  });

  it('已终态的子任务不可取消，且不会误伤 pending 交互', async () => {
    dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      USER_ID,
      `${USER_ID}@example.com`,
    ]);
    seedSession({ id: PARENT_ID, stateStatus: 'running' });
    seedSession({ id: PAUSED_CHILD_ID, parentSessionId: PARENT_ID, stateStatus: 'paused' });
    seedPermissionRequest({ requestId: 'perm-keep-pending', sessionId: PAUSED_CHILD_ID });
    const taskId = await seedChildTask();

    const taskManager = new agentCore.AgentTaskManagerImpl();
    const graph = await taskManager.loadOrCreate(
      taskGraphRoot.resolveTaskGraphProjectRoot(PARENT_ID),
      PARENT_ID,
    );
    const seededTask = graph.tasks[taskId];
    if (!seededTask) {
      throw new Error('seeded task missing');
    }
    graph.tasks[taskId] = { ...seededTask, status: 'completed' };
    await taskManager.save(graph);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: `/sessions/${PARENT_ID}/tasks/${taskId}/cancel`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(409);
      expect(
        dbModule.sqliteGet<{ status: string }>(
          'SELECT status FROM permission_requests WHERE id = ?',
          ['perm-keep-pending'],
        )?.status,
      ).toBe('pending');
    } finally {
      await app.close();
    }
  });
});
