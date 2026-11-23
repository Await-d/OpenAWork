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
  it('共享创建契约在真实路由拒绝非有限时间且保留历史响应字段', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload:
        '{"name":"无效时间","prompt":"p","schedule_kind":"every","schedule_every":1000,"schedule_at":1e309}',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'invalid_cron_job' });
    await app.close();
  });

  it('共享 PATCH 契约不补默认值并忽略不可写所有权字段', async () => {
    const { scheduledTaskCreateInputSchema, scheduledTaskUpdateInputSchema } =
      await import('@openAwork/shared');
    expect(scheduledTaskUpdateInputSchema.parse({ enabled: false, user_id: 'attacker' })).toEqual({
      enabled: false,
    });
    expect(
      scheduledTaskCreateInputSchema.parse({
        name: 'x',
        prompt: 'p',
        schedule_kind: 'every',
        schedule_every: 1000,
      }),
    ).toMatchObject({
      schedule_at: null,
      schedule_expr: null,
      schedule_tz: 'UTC',
      delivery_mode: 'none',
    });
  });

  it('真实路由保留所有权、响应外壳和渠道创建语义', async () => {
    const app = await buildApp();
    const unauthorized = await app.inject({ method: 'GET', url: '/cron/jobs' });
    expect(unauthorized.statusCode).toBe(401);
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
      payload: {
        name: '渠道任务',
        prompt: 'p',
        schedule_kind: 'every',
        schedule_every: 60000,
        delivery_mode: 'channel',
        plugin_id: 'plugin-1',
        plugin_chat_id: 'chat-1',
        enabled: false,
        user_id: 'attacker',
        id: 'injected',
        max_iterations: 999,
      },
    });
    expect(created.statusCode).toBe(201);
    const { job } = created.json();
    expect(job).toMatchObject({
      user_id: CRON_USER_ID,
      delivery_mode: 'channel',
      max_iterations: 10,
    });
    expect(job.id).not.toBe('injected');
    const updated = await app.inject({
      method: 'PATCH',
      url: `/cron/jobs/${job.id}`,
      headers: { authorization: bearer(app) },
      payload: { name: '改名', user_id: 'attacker' },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().job).toMatchObject({
      user_id: CRON_USER_ID,
      schedule_every: 60000,
      delivery_mode: 'channel',
      enabled: false,
    });
    const outsiderToken = app.jwt.sign({ sub: 'u-cron-outsider', email: 'outsider@example.com' });
    const db = await import('../../infra/db.js');
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      'u-cron-outsider',
      'outsider@example.com',
    ]);
    for (const suffix of ['', '/history']) {
      const denied = await app.inject({
        method: suffix ? 'GET' : 'PATCH',
        url: `/cron/jobs/${job.id}${suffix}`,
        headers: { authorization: `Bearer ${outsiderToken}` },
        ...(suffix ? {} : { payload: { enabled: true } }),
      });
      expect(denied.statusCode).toBe(404);
    }
    const list = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    expect(list.json()).toMatchObject({ jobs: [{ id: job.id }] });
    const history = await app.inject({
      method: 'GET',
      url: `/cron/jobs/${job.id}/history?preview=false&limit=1`,
      headers: { authorization: bearer(app) },
    });
    expect(history.json()).toEqual({ history: [] });
    await app.close();
  });

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

  it('POST /cron/jobs 拒绝「字段齐全但永不触发」的配置', async () => {
    const app = await buildApp();
    const post = async (payload: Record<string, unknown>) =>
      app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: bearer(app), 'content-type': 'application/json' },
        payload,
      });

    // cron 缺表达式：落库后 scheduleJob 会直接 return，任务永不再跑。
    const missingExpr = await post({ name: 'x', schedule_kind: 'cron', prompt: 'p' });
    expect(missingExpr.statusCode).toBe(400);
    expect(missingExpr.json().error).toContain('schedule_expr');

    // 时区拼错：解析器静默回落 UTC，任务按错误时间跑。
    const badTz = await post({
      name: 'x',
      schedule_kind: 'cron',
      schedule_expr: '0 9 * * *',
      schedule_tz: 'Asia/Shangai',
      prompt: 'p',
    });
    expect(badTz.statusCode).toBe(400);
    expect(badTz.json().error).toContain('IANA');

    // 投递到会话却没有目标。
    const noTarget = await post({
      name: 'x',
      schedule_kind: 'cron',
      schedule_expr: '0 9 * * *',
      prompt: 'p',
      delivery_mode: 'session',
    });
    expect(noTarget.statusCode).toBe(400);
    expect(noTarget.json().error).toContain('delivery_target');

    await app.close();
  });

  it('PATCH 只改投递方式 / 启停时不得清空调度字段', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        name: '每日同步',
        schedule_kind: 'cron',
        schedule_expr: '0 9 * * *',
        schedule_tz: 'Asia/Shanghai',
        prompt: 'p',
      },
    });
    const jobId = (created.json().job as { id: string }).id;

    // 回归：`jobSchema.partial()` 会把字段默认值一并注入，PATCH 只传
    // delivery_mode 时 schedule_expr 会被写成 null，任务从此永不触发。
    const delivery = await app.inject({
      method: 'PATCH',
      url: `/cron/jobs/${jobId}`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { delivery_mode: 'desktop' },
    });
    expect(delivery.statusCode).toBe(200);
    const afterDelivery = delivery.json().job as Record<string, unknown>;
    expect(afterDelivery).toMatchObject({
      schedule_kind: 'cron',
      schedule_expr: '0 9 * * *',
      schedule_tz: 'Asia/Shanghai',
      delivery_mode: 'desktop',
      enabled: true,
    });
    expect(typeof afterDelivery['nextFireAt']).toBe('number');

    const disabled = await app.inject({
      method: 'PATCH',
      url: `/cron/jobs/${jobId}`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { enabled: false },
    });
    const afterDisable = disabled.json().job as Record<string, unknown>;
    expect(afterDisable).toMatchObject({ enabled: false, schedule_expr: '0 9 * * *' });
    await app.close();
  });

  it('PATCH 把投递改成 session 但没给目标时拒绝，且不改动任务', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        name: '无目标',
        schedule_kind: 'cron',
        schedule_expr: '0 9 * * *',
        prompt: 'p',
      },
    });
    const jobId = (created.json().job as { id: string }).id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/cron/jobs/${jobId}`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { delivery_mode: 'session' },
    });
    expect(patched.statusCode).toBe(400);

    const listed = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    const job = (listed.json().jobs as Record<string, unknown>[])[0]!;
    expect(job['delivery_mode']).toBe('none');
    await app.close();
  });

  it('POST /cron/jobs 拒绝语法合法但永不触发的表达式', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        name: '永不触发',
        schedule_kind: 'cron',
        schedule_expr: '0 0 30 2 *',
        prompt: 'p',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('不会触发');
    await app.close();
  });

  it('PATCH 把任务改成已过去的一次性任务时拒绝，且原任务不变', async () => {
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        name: '保留原配置',
        schedule_kind: 'cron',
        schedule_expr: '0 9 * * *',
        prompt: 'p',
      },
    });
    const jobId = (created.json().job as { id: string }).id;

    const patched = await app.inject({
      method: 'PATCH',
      url: `/cron/jobs/${jobId}`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { schedule_kind: 'at', schedule_at: Date.now() - 1_000 },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json().error).toContain('未来时间');

    const listed = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    const job = (listed.json().jobs as Record<string, unknown>[])[0]!;
    expect(job).toMatchObject({ schedule_kind: 'cron', schedule_expr: '0 9 * * *' });
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

  it('列表带上 lastExecution：前端不再逐任务拉 history', async () => {
    const db = await import('../../infra/db.js');
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: '/cron/jobs',
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {
        name: '带最近一次执行',
        schedule_kind: 'cron',
        schedule_expr: '0 9 * * *',
        prompt: 'p',
      },
    });
    const jobId = (created.json().job as { id: string }).id;
    db.sqliteRun(
      `INSERT INTO cron_job_executions (id, job_id, user_id, started_at, finished_at, status, error)
       VALUES ('e-last', ?, ?, 1, 2, 'failed', 'boom')`,
      [jobId, CRON_USER_ID],
    );

    const listed = await app.inject({
      method: 'GET',
      url: '/cron/jobs',
      headers: { authorization: bearer(app) },
    });
    const job = (listed.json().jobs as Record<string, unknown>[])[0]!;
    expect(job['lastExecution']).toMatchObject({
      id: 'e-last',
      status: 'failed',
      error: 'boom',
    });
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

describe('cron 并发配置', () => {
  it('OPENAWORK_CRON_MAX_CONCURRENT：合法值生效，非法 / 越界回落', async () => {
    const { resolveCronMaxConcurrent, DEFAULT_CRON_MAX_CONCURRENT } =
      await import('../../cron/router.js');
    expect(resolveCronMaxConcurrent('5')).toBe(5);
    expect(resolveCronMaxConcurrent(undefined)).toBe(DEFAULT_CRON_MAX_CONCURRENT);
    expect(resolveCronMaxConcurrent('0')).toBe(DEFAULT_CRON_MAX_CONCURRENT);
    expect(resolveCronMaxConcurrent('-2')).toBe(DEFAULT_CRON_MAX_CONCURRENT);
    expect(resolveCronMaxConcurrent('abc')).toBe(DEFAULT_CRON_MAX_CONCURRENT);
    // 上限保护：配成 1000 也不会真的开 1000 条并发会话。
    expect(resolveCronMaxConcurrent('1000')).toBe(50);
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
