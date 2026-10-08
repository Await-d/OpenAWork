/**
 * 脏 todo 行不得拖垮会话列表与预览。
 *
 * `session_todos` 建表时 `status` / `priority` 只是裸 TEXT（无 CHECK 约束），
 * 枚举只存在于应用层 schema（todo-tools.ts 的 `todoStatusSchema` /
 * `todoPrioritySchema`）。历史版本、手改库、迁移或磁盘损坏都可能留下枚举外的
 * 取值。
 *
 * `listSessionTodos` 此前用 `.parse()`，一行脏数据就抛 ZodError；而
 * `GET /sessions/:id/recovery` 单次请求会调用它 3 次（`toPublicSessionResponse`
 * 一次 + `listSessionTodoLanes` 的 main/temp 各一次），`GET /sessions` 与
 * `GET /sessions/:id` 也各自依赖它 —— 结果是**一条坏 todo 让整个会话列表和
 * 预览一起 500 InternalError**，且错误文案被全局兜底替换成「服务器内部错误。」，
 * 完全无法定位。
 *
 * 这里锁定：脏行被跳过 + warn，合法行照常返回，受影响端点保持 200。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-dirty-todo-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-dirty-todo-data-'));
const SESSION_ID = 'sess-dirty-todo';
const USER_ID = 'u-dirty-todo';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'dirty-todo-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;

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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'dirty-todo@example.com' })}`;
}

/** 直接写库绕过应用层校验，模拟历史版本 / 手改库 / 磁盘损坏留下的脏行。 */
function seedTodo(
  lane: string,
  position: number,
  content: string,
  status: string,
  priority: string,
) {
  dbModule.sqliteRun(
    `INSERT INTO session_todos (session_id, lane, content, status, priority, position)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [SESSION_ID, lane, content, status, priority, position],
  );
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
  vi.restoreAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  dbModule.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'dirty-todo@example.com', 'x')",
    [USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '脏 todo 会话', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe('脏 todo 行容错', () => {
  it('GET /sessions/:sessionId/recovery 跳过脏 todo 行而不 500', async () => {
    seedTodo('main', 0, '合法任务', 'pending', 'high');
    seedTodo('main', 1, '状态越界的脏任务', 'done', 'medium');
    seedTodo('main', 2, '优先级越界的脏任务', 'pending', 'p1');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().recovery.session.id).toBe(SESSION_ID);
      // 合法行照常返回，脏行被跳过而不是整表丢弃。
      const todos = response.json().recovery.session.todos as Array<{ content: string }>;
      expect(todos.map((todo) => todo.content)).toEqual(['合法任务']);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/recovery 在 temp 道脏行时同样不 500', async () => {
    seedTodo('temp', 0, '合法临时任务', 'pending', 'low');
    seedTodo('temp', 1, '临时脏任务', 'archived', 'low');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      // 同时断言合法行仍在：只断言状态码无法区分「跳过脏行」与「整表丢弃」。
      const lanes = response.json().recovery.todoLanes as {
        temp: Array<{ content: string }>;
      };
      expect(lanes.temp.map((todo) => todo.content)).toEqual(['合法临时任务']);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/todos 在脏 todo 行时不再 500', async () => {
    // `GET /sessions`（列表）不受影响 —— 它不调用 listSessionTodos，直接返回
    // session row，因此这里只覆盖真正读取 todo 的端点。
    seedTodo('main', 0, '合法任务', 'pending', 'high');
    seedTodo('main', 1, '脏任务', 'done', 'p1');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/todos`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const todos = (response.json() as { todos: Array<{ content: string }> }).todos;
      expect(todos.map((todo) => todo.content)).toEqual(['合法任务']);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId/status 在脏 todo 行时不再 500', async () => {
    seedTodo('main', 0, '合法任务', 'in_progress', 'medium');
    seedTodo('main', 1, '脏任务', 'done', 'p1');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/status`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      // status 返回体是 `{ status: {...} }`，todoLanes 在内层。
      const lanes = (
        response.json() as { status: { todoLanes: { main: Array<{ content: string }> } } }
      ).status.todoLanes;
      expect(lanes.main.map((todo) => todo.content)).toEqual(['合法任务']);
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:sessionId 单会话详情在脏 todo 行时不再 500', async () => {
    seedTodo('main', 0, '合法任务', 'pending', 'medium');
    seedTodo('main', 1, '脏任务', 'done', 'p1');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const todos = (response.json().session as { todos: Array<{ content: string }> }).todos;
      expect(todos.map((todo) => todo.content)).toEqual(['合法任务']);
    } finally {
      await app.close();
    }
  });

  it('跳过脏行时打 warn，便于定位具体记录', async () => {
    seedTodo('main', 0, '合法任务', 'pending', 'high');
    seedTodo('main', 1, '脏任务', 'done', 'p1');

    const app = await buildApp();
    try {
      await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}/recovery`,
        headers: { authorization: bearer(app) },
      });

      const warned = (console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes('[todo-tools]'));
      expect(warned.length).toBeGreaterThan(0);
      expect(warned.join('\n')).toContain(SESSION_ID);
      // warn 只针对脏行，合法行不应产生噪音。
      expect(warned.join('\n')).not.toContain('合法任务');
    } finally {
      await app.close();
    }
  });
});
