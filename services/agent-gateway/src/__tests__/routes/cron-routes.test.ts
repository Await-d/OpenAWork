import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as CronRouterModule from '../../cron/router.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let cronRoutes: typeof CronRouterModule.cronRoutes;
let cronScheduler: typeof CronRouterModule.cronScheduler;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let seedCronUser: () => void;

const CRON_USER_ID = 'u-cron-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(cronRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: CRON_USER_ID, email: 'cron@example.com' })}`;
}

beforeAll(async () => {
  authPlugin = (await import('../../infra/auth.js')).default;
  const cronModule = await import('../../cron/router.js');
  cronRoutes = cronModule.cronRoutes;
  cronScheduler = cronModule.cronScheduler;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  // requireAuth 现在校验 token.sub 是否存在于 users 表（孤儿令牌 → 401）。
  // 先确保 DB 连接，并暴露一个种用户的闭包供 beforeEach 复用。
  const db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  seedCronUser = () =>
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      CRON_USER_ID,
      'cron@example.com',
    ]);
});

beforeEach(() => {
  // requireAuth 现在校验 token.sub 存在性；兄弟测试文件的 beforeEach 可能
  // DELETE FROM users（共享内存 DB 无隔离），故每例前重新种入测试用户。
  seedCronUser();
  cronScheduler.stopAll();
  for (const job of cronScheduler.listJobs()) {
    cronScheduler.removeJob(job.id);
  }
});

afterEach(() => {
  cronScheduler.stopAll();
  for (const job of cronScheduler.listJobs()) {
    cronScheduler.removeJob(job.id);
  }
});

describe('cron routes', () => {
  it('POST /cron/jobs 在非法 payload 时返回结构化 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        name: '',
        schedule_kind: 'every',
        prompt: '',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: '定时任务配置无效。',
      code: 'invalid_cron_job',
    });
    await app.close();
  });

  it('PATCH /cron/jobs/:id 在不存在时返回结构化 404', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'PATCH',
      url: '/cron/jobs/missing-job',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: '目标定时任务不存在。',
      code: 'cron_job_not_found',
    });
    await app.close();
  });

  it('DELETE /cron/jobs/:id 在不存在时返回结构化 404', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'DELETE',
      url: '/cron/jobs/missing-job',
      headers: { authorization: bearer(app) },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: '目标定时任务不存在。',
      code: 'cron_job_not_found',
    });
    await app.close();
  });

  it('POST /cron/jobs 拒绝非法 cron 表达式', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        name: '坏表达式',
        schedule_kind: 'cron',
        schedule_expr: '99 99 * * *',
        prompt: 'p',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_cron_job' });
    await app.close();
  });

  it('列表返回派生字段：scheduleDisplay / status / fireCount / nextFireAt / scheduleKind', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        name: '每日同步',
        schedule_kind: 'cron',
        schedule_expr: '0 9 * * *',
        schedule_tz: 'UTC',
        prompt: 'p',
      },
    });
    expect(created.statusCode).toBe(201);
    const createdJob = created.json().job as Record<string, unknown>;
    expect(createdJob).toMatchObject({
      scheduleKind: 'cron',
      status: 'enabled',
      fireCount: 0,
    });
    expect(typeof createdJob['scheduleDisplay']).toBe('string');
    expect(typeof createdJob['nextFireAt']).toBe('number');

    const listed = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    expect(listed.statusCode).toBe(200);
    const job = (listed.json().jobs as Record<string, unknown>[])[0]!;
    expect(job).toMatchObject({ scheduleKind: 'cron', status: 'enabled', fireCount: 0 });

    // 停用后 status 立刻反映（Web 端据此渲染「启用」按钮）。
    const disabled = await app.inject({
      method: 'POST',
      url: `/cron/jobs/${String(job['id'])}/disable`,
      headers: { authorization: bearer(app) },
    });
    expect((disabled.json().job as Record<string, unknown>)['status']).toBe('disabled');
    await app.close();
  });

  it('列表下发独立的 running 字段（不污染 status）', async () => {
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        name: '长任务',
        schedule_kind: 'every',
        schedule_every: 3_600_000,
        prompt: 'p',
      },
    });

    const listed = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    const job = (listed.json().jobs as Record<string, unknown>[])[0]!;
    // 「运行中」必须走独立字段：`shared-ui` 在 status==='running' 时会隐藏
    // 停用按钮，把 running 写进 status 会让长任务停不掉（详见 schedule-display）。
    expect(job['status']).toBe('enabled');
    expect(job['running']).toBe(false);
    await app.close();
  });

  it('POST /cron/jobs/:id/run 在不存在时 404，存在时 202', async () => {
    const app = await buildApp();
    const missing = await app.inject({
      method: 'POST',
      url: '/cron/jobs/missing-job/run',
      headers: { authorization: bearer(app) },
    });
    expect(missing.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {
        name: '手动',
        schedule_kind: 'every',
        schedule_every: 3_600_000,
        prompt: 'p',
      },
    });
    const jobId = (created.json().job as { id: string }).id;
    const run = await app.inject({
      method: 'POST',
      url: `/cron/jobs/${jobId}/run`,
      headers: { authorization: bearer(app) },
    });
    expect(run.statusCode).toBe(202);
    await app.close();
  });
});

describe('GET /cron/jobs/:id/history 的摘要开关', () => {
  it('preview=0 必须真的关掉摘要（Boolean("0") 是 true，不能用 coerce.boolean）', async () => {
    const db = await import('../../infra/db.js');
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
      payload: {
        name: '摘要开关',
        prompt: 'p',
        schedule_kind: 'every',
        schedule_every: 60_000,
      },
    });
    const jobId = (created.json().job as { id: string }).id;

    // 造一条执行记录，指向一个不存在的执行会话（若服务端仍去读摘要，
    // 读不到内容也不会报错——所以这里只断言「有/没有 outputPreview 字段」）。
    db.sqliteRun(
      `INSERT INTO cron_job_executions (id, job_id, user_id, started_at, finished_at, status, session_id)
       VALUES ('e-hist', ?, ?, 1, 2, 'completed', 'missing-session')`,
      [jobId, CRON_USER_ID],
    );
    db.sqliteRun(
      "INSERT INTO sessions (id, user_id, title, messages_json, state_status) VALUES (?, ?, 'cron:x', '[]', 'idle')",
      ['hist-session', CRON_USER_ID],
    );

    const plain = await app.inject({
      method: 'GET',
      url: `/cron/jobs/${jobId}/history?preview=0`,
      headers: { authorization: bearer(app) },
    });
    expect(plain.statusCode).toBe(200);
    const plainHistory = plain.json().history as Array<Record<string, unknown>>;
    expect(plainHistory).toHaveLength(1);
    // 关键：preview=0 时服务端不应为它生成摘要字段。
    expect(plainHistory[0]).not.toHaveProperty('outputPreview');

    const limited = await app.inject({
      method: 'GET',
      url: `/cron/jobs/${jobId}/history?limit=1&preview=0`,
      headers: { authorization: bearer(app) },
    });
    expect(limited.statusCode).toBe(200);
    expect(limited.json().history).toHaveLength(1);

    await app.close();
  });
});
