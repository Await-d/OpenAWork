import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as CronRouterModule from '../../cron/router.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

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
});
