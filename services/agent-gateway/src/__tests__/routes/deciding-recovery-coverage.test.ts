/**
 * 「用户必须能看到本该由他处理的待办」的功能不变量。
 *
 * 背景：僵尸 `deciding`（父代理 claim 后崩掉）的请求，`GET /permissions/pending` 与
 * `GET /questions/pending` 的 SQL 都只认 `status = 'pending'`，所以不回收它们，审批浮窗
 * 就一直空着、而会话被判 paused——用户既看不到待办也走不掉。
 *
 * 回收职责后来被从这两个接口移除（它们被 `use-sub-session-detail` 以 2.5s 轮询，在那里
 * 写库等于把写事务挂到高频轮询上）。所以本文件钉住**接替它们的低频覆盖路径**：
 *   - `GET /sessions/:sessionId` 内部的 reconcile（默认开启回收）
 *   - `GET /sessions` 列表 / `GET /sessions/:id/status` 入口的按用户批量释放
 *
 * 这些路径一旦被误改成「批量协调时不释放」，用户就会永久卡在无法处理待办的状态，
 * 而任何单元测试都不会报警——所以必须有路由级的端到端断言。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as PermissionsRoutesModule from '../../routes/permissions.js';
import type * as QuestionsRoutesModule from '../../routes/questions.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;
let permissionsRoutes: typeof PermissionsRoutesModule.permissionsRoutes;
let questionsRoutes: typeof QuestionsRoutesModule.questionsRoutes;

const USER_ID = 'u-deciding-coverage';
const SESSION_ID = 'sess-deciding-coverage';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { registerErrorHandler } = await import('../../infra/error-handler.js');
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

function seedSession(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'coverage', '{}', 'paused')`,
    [SESSION_ID, USER_ID],
  );
}

function seedZombiePermission(id: string): void {
  dbModule.sqliteRun(
    `INSERT INTO permission_requests
       (id, session_id, tool_name, scope, reason, risk_level, status, created_at, updated_at)
     VALUES (?, ?, 'bash', 'bash pwd', '读取目录', 'low', 'deciding',
             datetime('now', '-30 minutes'), datetime('now', '-30 minutes'))`,
    [id, SESSION_ID],
  );
}

function statusOf(
  id: string,
  table: 'permission_requests' | 'question_requests',
): string | undefined {
  return dbModule.sqliteGet<{ status: string }>(`SELECT status FROM ${table} WHERE id = ?`, [id])
    ?.status;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
  permissionsRoutes = (await import('../../routes/permissions.js')).permissionsRoutes;
  questionsRoutes = (await import('../../routes/questions.js')).questionsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@example.com`,
    'x',
  ]);
  seedSession();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('僵尸 deciding 的低频覆盖路径', () => {
  it('GET /sessions/:id 通过 reconcile 回收僵尸 deciding', async () => {
    const app = await buildApp();
    try {
      seedZombiePermission('perm-by-session-detail');

      const response = await app.inject({
        headers: { authorization: bearer(app) },
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
      });
      expect(response.statusCode).toBe(200);

      expect(statusOf('perm-by-session-detail', 'permission_requests')).toBe('pending');
    } finally {
      await app.close();
    }
  });

  it('GET /sessions 列表入口的按用户批量释放覆盖到僵尸 deciding', async () => {
    const app = await buildApp();
    try {
      seedZombiePermission('perm-by-list');

      const response = await app.inject({
        headers: { authorization: bearer(app) },
        method: 'GET',
        url: '/sessions',
      });
      expect(response.statusCode).toBe(200);

      expect(statusOf('perm-by-list', 'permission_requests')).toBe('pending');
    } finally {
      await app.close();
    }
  });

  it('GET /sessions/:id/status 入口的按用户批量释放覆盖到僵尸 deciding', async () => {
    const app = await buildApp();
    try {
      seedZombiePermission('perm-by-status');

      const response = await app.inject({
        headers: { authorization: bearer(app) },
        method: 'GET',
        url: `/sessions/${SESSION_ID}/status`,
      });
      expect(response.statusCode).toBe(200);

      expect(statusOf('perm-by-status', 'permission_requests')).toBe('pending');
    } finally {
      await app.close();
    }
  });

  /**
   * 反向防线：pending 列表接口是 2.5s 高频轮询的目标，**不得**在读路径写库。
   * 一旦有人为了「让用户看到僵尸待办」又把释放加回来，这条会立刻报警。
   */
  it('pending 列表接口不写库：被轮询时也不回收僵尸 deciding', async () => {
    const app = await buildApp();
    try {
      seedZombiePermission('perm-untouched');

      const response = await app.inject({
        headers: { authorization: bearer(app) },
        method: 'GET',
        url: `/sessions/${SESSION_ID}/permissions/pending`,
      });
      expect(response.statusCode).toBe(200);
      // 响应里确实看不到它（SQL 只认 pending）——所以才需要上面三条低频路径兜底。
      expect(response.json<{ requests: unknown[] }>().requests).toEqual([]);
      expect(statusOf('perm-untouched', 'permission_requests')).toBe('deciding');
    } finally {
      await app.close();
    }
  });
});
