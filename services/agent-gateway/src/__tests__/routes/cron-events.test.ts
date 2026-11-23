/**
 * T-23 定时任务专用 SSE（`GET /cron/events`）回归。
 *
 * 覆盖四块不变量：
 *  1) 总线语义：订阅/退订、单个订阅者抛错被隔离、不重放；
 *  2) 端点鉴权：缺 token / 错 token → 401，正确 token → 200 + text/event-stream；
 *  3) **用户隔离**：A 订阅时触发 B 的任务变更收不到，触发 A 自己的能收到；
 *  4) 拆除：客户端断开后模块级订阅与心跳被清理（无进程级泄漏）；
 *  5) 发布点：CRUD / 启停 / run_started / run_finished 均真实触发。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { get, type IncomingMessage } from 'node:http';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as CronRouterModule from '../../cron/router.js';
import type * as CronBusModule from '../../cron/cron-events-bus.js';
import type * as CronSchedulerModule from '../../cron/scheduler.js';
import type { CronJobRecord } from '../../cron/types.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let cronRoutes: typeof CronRouterModule.cronRoutes;
let cronScheduler: typeof CronRouterModule.cronScheduler;
let schedulerModule: typeof CronSchedulerModule;
let cronEventsRoutes: (app: FastifyInstance) => Promise<void>;
let bus: typeof CronBusModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let seedUsers: () => void;

const USER_A = 'u-cron-sse-a';
const USER_B = 'u-cron-sse-b';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(cronRoutes);
  await app.register(cronEventsRoutes);
  await app.ready();
  return app;
}

function token(app: FastifyInstance, sub: string, email: string): string {
  return app.jwt.sign({ sub, email });
}

/** 清空调度器里的任务（stopAll 只停定时器，任务定义仍需逐个删除）。 */
function resetScheduler(): void {
  cronScheduler.stopAll();
  for (const job of cronScheduler.listJobs()) {
    cronScheduler.removeJob(job.id);
  }
}

/**
 * 建立一个真实 SSE 连接并返回响应体与「读到的文本」聚合器。
 *
 * 用真实 HTTP（而非 `app.inject`）——EventSource 语义依赖长连接，`inject` 会
 * 等到响应结束才返回，无法观测增量推送。写法对齐 `attach-event-stream-http.test.ts`。
 */
async function openSse(
  base: string,
  path: string,
): Promise<{
  readonly response: IncomingMessage;
  readonly request: ReturnType<typeof get>;
  read: () => string;
  waitFor: (predicate: (text: string) => boolean, timeoutMs?: number) => Promise<string>;
  close: () => void;
}> {
  const request = get(`${base}${path}`);
  request.on('error', () => undefined);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    request.once('response', resolve);
    request.once('error', reject);
  });
  let text = '';
  response.setEncoding('utf8');
  response.on('data', (chunk: string) => {
    text += chunk;
  });

  const waitFor = async (
    predicate: (text: string) => boolean,
    timeoutMs = 2000,
  ): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate(text)) return text;
      await new Promise((r) => setTimeout(r, 10));
    }
    return text;
  };

  return {
    response,
    request,
    read: () => text,
    waitFor,
    close: () => {
      response.destroy();
      request.destroy();
    },
  };
}

beforeAll(async () => {
  authPlugin = (await import('../../infra/auth.js')).default;
  const cronModule = await import('../../cron/router.js');
  cronRoutes = cronModule.cronRoutes;
  cronScheduler = cronModule.cronScheduler;
  bus = await import('../../cron/cron-events-bus.js');
  schedulerModule = await import('../../cron/scheduler.js');
  cronEventsRoutes = (await import('../../routes/cron-events.js')).cronEventsRoutes;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  const db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  seedUsers = () => {
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      USER_A,
      'a@cron-sse.test',
    ]);
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      USER_B,
      'b@cron-sse.test',
    ]);
  };
});

beforeEach(() => {
  seedUsers();
  resetScheduler();
  bus.__resetCronJobsChangedSubscribersForTest();
});

afterEach(() => {
  resetScheduler();
  bus.__resetCronJobsChangedSubscribersForTest();
});

describe('cron-events-bus', () => {
  it('订阅者收到事件；退订后不再收到', () => {
    const seen: string[] = [];
    const unsubscribe = bus.subscribeCronJobsChanged((e) => seen.push(e.reason));
    bus.publishCronJobsChanged({ userId: USER_A, reason: 'created', jobId: 'j1' });
    unsubscribe();
    bus.publishCronJobsChanged({ userId: USER_A, reason: 'deleted', jobId: 'j2' });
    expect(seen).toEqual(['created']);
  });

  it('单个订阅者抛错被隔离，不影响其它订阅者与调用方', () => {
    const good: string[] = [];
    bus.subscribeCronJobsChanged(() => {
      throw new Error('subscriber boom');
    });
    bus.subscribeCronJobsChanged((e) => good.push(e.reason));

    expect(() =>
      bus.publishCronJobsChanged({ userId: USER_A, reason: 'updated', jobId: 'j1' }),
    ).not.toThrow();
    expect(good).toEqual(['updated']);
  });

  it('退订是幂等的，订阅者计数归零', () => {
    const unsubscribe = bus.subscribeCronJobsChanged(() => undefined);
    expect(bus.getCronJobsChangedSubscriberCount()).toBe(1);
    unsubscribe();
    unsubscribe();
    expect(bus.getCronJobsChangedSubscriberCount()).toBe(0);
  });
});

describe('GET /cron/events 鉴权', () => {
  it('缺 token → 401 且 JSON error', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/cron/events' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: '未授权或登录已失效。' });
    await app.close();
  });

  it('错误 token → 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/cron/events?token=not-a-jwt' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: '未授权或登录已失效。' });
    await app.close();
  });
});

describe('GET /cron/events 推送与用户隔离', () => {
  it('正确 token → 200 + text/event-stream，收到自己的变更，收不到他人的', async () => {
    const app = await buildApp();
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const tokenA = token(app, USER_A, 'a@cron-sse.test');
    const sse = await openSse(base, `/cron/events?token=${encodeURIComponent(tokenA)}`);
    try {
      expect(sse.response.statusCode).toBe(200);
      expect(sse.response.headers['content-type']).toContain('text/event-stream');

      // 等到 `retry: 1000` 首帧出现，确认流已建立。
      await sse.waitFor((t) => t.includes('retry: 1000'));

      // 用户 B 的变更：A 不得收到。
      bus.publishCronJobsChanged({ userId: USER_B, reason: 'created', jobId: 'b-job' });
      // 给自己一点时间，确认确实没被推送。
      await new Promise((r) => setTimeout(r, 50));
      expect(sse.read()).not.toContain('b-job');

      // 用户 A 自己的变更：收到，且 reason / jobId 正确。
      bus.publishCronJobsChanged({ userId: USER_A, reason: 'enabled', jobId: 'a-job' });
      const text = await sse.waitFor((t) => t.includes('cron.jobs.changed'));
      expect(text).toContain('event: cron.jobs.changed');
      expect(text).toContain(JSON.stringify({ reason: 'enabled', jobId: 'a-job' }));
    } finally {
      sse.close();
      await app.close();
    }
  });

  it('jobId 为 null 时照常推送（客户端退化为整表重拉）', async () => {
    const app = await buildApp();
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const tokenA = token(app, USER_A, 'a@cron-sse.test');
    const sse = await openSse(base, `/cron/events?token=${encodeURIComponent(tokenA)}`);
    try {
      await sse.waitFor((t) => t.includes('retry: 1000'));
      bus.publishCronJobsChanged({ userId: USER_A, reason: 'updated', jobId: null });
      const text = await sse.waitFor((t) => t.includes('cron.jobs.changed'));
      expect(text).toContain(JSON.stringify({ reason: 'updated', jobId: null }));
    } finally {
      sse.close();
      await app.close();
    }
  });

  it('客户端断开后模块级订阅被清理（无进程级泄漏）', async () => {
    const app = await buildApp();
    const base = await app.listen({ host: '127.0.0.1', port: 0 });
    const tokenA = token(app, USER_A, 'a@cron-sse.test');
    const sse = await openSse(base, `/cron/events?token=${encodeURIComponent(tokenA)}`);
    try {
      await sse.waitFor((t) => t.includes('retry: 1000'));
      expect(bus.getCronJobsChangedSubscriberCount()).toBe(1);
    } finally {
      sse.close();
    }
    try {
      await vi.waitFor(() => expect(bus.getCronJobsChangedSubscriberCount()).toBe(0));
    } finally {
      await app.close();
    }
  });
});

describe('发布点：CRUD 与启停（写库成功后才发）', () => {
  async function recordedReasons(fn: () => Promise<void>): Promise<string[]> {
    const reasons: string[] = [];
    const unsubscribe = bus.subscribeCronJobsChanged((e) => reasons.push(e.reason));
    try {
      await fn();
    } finally {
      unsubscribe();
    }
    return reasons;
  }

  it('create → created', async () => {
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: `Bearer ${token(app, USER_A, 'a@cron-sse.test')}` },
        payload: { name: 'a', prompt: 'p', schedule_kind: 'every', schedule_every: 60_000 },
      });
      expect(created.statusCode).toBe(201);
      // 重新发一次以捕获事件（上面那次在订阅之前）。
      const reasons = await recordedReasons(async () => {
        const again = await app.inject({
          method: 'POST',
          url: '/cron/jobs',
          headers: { authorization: `Bearer ${token(app, USER_A, 'a@cron-sse.test')}` },
          payload: { name: 'b', prompt: 'p', schedule_kind: 'every', schedule_every: 60_000 },
        });
        expect(again.statusCode).toBe(201);
      });
      expect(reasons).toEqual(['created']);
    } finally {
      await app.close();
    }
  });

  it('PATCH → updated', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: { name: 'a', prompt: 'p', schedule_kind: 'every', schedule_every: 60_000 },
      });
      const jobId = (created.json().job as { id: string }).id;
      const reasons = await recordedReasons(async () => {
        const patched = await app.inject({
          method: 'PATCH',
          url: `/cron/jobs/${jobId}`,
          headers: { authorization: auth },
          payload: { name: 'renamed' },
        });
        expect(patched.statusCode).toBe(200);
      });
      expect(reasons).toEqual(['updated']);
    } finally {
      await app.close();
    }
  });

  it('DELETE → deleted', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: { name: 'a', prompt: 'p', schedule_kind: 'every', schedule_every: 60_000 },
      });
      const jobId = (created.json().job as { id: string }).id;
      const reasons = await recordedReasons(async () => {
        const removed = await app.inject({
          method: 'DELETE',
          url: `/cron/jobs/${jobId}`,
          headers: { authorization: auth },
        });
        expect(removed.statusCode).toBe(204);
      });
      expect(reasons).toEqual(['deleted']);
    } finally {
      await app.close();
    }
  });

  it('enable / disable → enabled / disabled', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: {
          name: 'a',
          prompt: 'p',
          schedule_kind: 'every',
          schedule_every: 60_000,
          enabled: false,
        },
      });
      const jobId = (created.json().job as { id: string }).id;

      const disabled = await recordedReasons(async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/cron/jobs/${jobId}/disable`,
          headers: { authorization: auth },
        });
        expect(res.statusCode).toBe(200);
      });
      expect(disabled).toEqual(['disabled']);

      const enabled = await recordedReasons(async () => {
        const res = await app.inject({
          method: 'POST',
          url: `/cron/jobs/${jobId}/enable`,
          headers: { authorization: auth },
        });
        expect(res.statusCode).toBe(200);
      });
      expect(enabled).toEqual(['enabled']);
    } finally {
      await app.close();
    }
  });

  it('失败的写入不发布事件（写库成功后才发）', async () => {
    const app = await buildApp();
    try {
      const reasons = await recordedReasons(async () => {
        // 非法表达式 → 400，任务未创建。
        const res = await app.inject({
          method: 'POST',
          url: '/cron/jobs',
          headers: { authorization: `Bearer ${token(app, USER_A, 'a@cron-sse.test')}` },
          payload: {
            name: 'bad',
            prompt: 'p',
            schedule_kind: 'cron',
            schedule_expr: '99 99 * * *',
          },
        });
        expect(res.statusCode).toBe(400);
      });
      expect(reasons).toEqual([]);
    } finally {
      await app.close();
    }
  });
});

describe('发布点：执行生命周期（scheduler 侧）', () => {
  it('手动运行触发 run_started → run_finished', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: { name: 'a', prompt: 'p', schedule_kind: 'every', schedule_every: 3_600_000 },
      });
      const jobId = (created.json().job as { id: string }).id;

      const events: Array<{ reason: string; jobId: string | null }> = [];
      const unsubscribe = bus.subscribeCronJobsChanged((e) => {
        if (e.reason === 'run_started' || e.reason === 'run_finished') {
          events.push({ reason: e.reason, jobId: e.jobId });
        }
      });
      try {
        // `startJobNow` 起跑后异步结算；用 runJobNow 的等价物保证确定性。
        const result = await cronScheduler.runJobNow(jobId);
        expect(result.started).toBe(true);
      } finally {
        unsubscribe();
      }

      expect(events).toEqual([
        { reason: 'run_started', jobId },
        { reason: 'run_finished', jobId },
      ]);
    } finally {
      await app.close();
    }
  });

  it('一次性 delete_after_run 任务完成 → 依次收到 run_finished、deleted', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      // `at` 任务 + delete_after_run：跑到未来某个时刻（不真的等），用 runJobNow 立即触发。
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: {
          name: 'once',
          prompt: 'p',
          schedule_kind: 'at',
          schedule_at: Date.now() + 3_600_000,
          delete_after_run: true,
        },
      });
      const jobId = (created.json().job as { id: string }).id;

      const events: Array<{ reason: string; jobId: string | null }> = [];
      const unsubscribe = bus.subscribeCronJobsChanged((e) => {
        events.push({ reason: e.reason, jobId: e.jobId });
      });
      try {
        const result = await cronScheduler.runJobNow(jobId);
        expect(result.started).toBe(true);
      } finally {
        unsubscribe();
      }

      // 顺序关键：run_finished 在删除之前发，deleted 必须紧随其后（否则任务永久滞留）。
      expect(events).toEqual([
        { reason: 'run_started', jobId },
        { reason: 'run_finished', jobId },
        { reason: 'deleted', jobId },
      ]);
      expect(cronScheduler.getJob(jobId)).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('发布点：跳过执行与建臂失败（用户可见的执行记录）', () => {
  it('被跳过的触发 → 收到 run_skipped', async () => {
    // 用独立调度器 + 挂起的 handler 精确制造 in-flight 跳过。
    //
    // 注意 `recordSkippedFire` 只在**定时器路径**（`fireJob` 传 `recordSkip:true`）
    // 触发，`startJobNow`（手动「立即运行」）刻意不记录——手动触发由调用方拿 reason。
    // 因此这里用极小 `schedule_every` 让定时器自己跑：首次 tick 起跑（挂起），
    // 下一次 tick 命中 in-flight → `recordSkippedFire` → run_skipped。
    const { CronScheduler } = schedulerModule;
    let releaseHandler: () => void = () => undefined;
    const scheduler = new CronScheduler(
      () =>
        new Promise<void>((resolve) => {
          releaseHandler = resolve;
        }),
      3,
    );

    const reasons: string[] = [];
    const unsubscribe = bus.subscribeCronJobsChanged((e) => reasons.push(e.reason));
    try {
      const job: CronJobRecord = {
        id: 'skip-job',
        user_id: USER_A,
        name: 'skip',
        schedule_kind: 'every',
        schedule_at: null,
        schedule_every: 5,
        schedule_expr: null,
        schedule_tz: 'UTC',
        prompt: 'p',
        agent_id: null,
        model: null,
        working_folder: null,
        session_id: null,
        delivery_mode: 'none',
        delivery_target: null,
        plugin_id: null,
        plugin_chat_id: null,
        enabled: true,
        delete_after_run: false,
        max_iterations: 10,
        last_fired_at: null,
        fire_count: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      scheduler.addJob(job);

      await vi.waitFor(() => expect(reasons).toContain('run_skipped'), { timeout: 2000 });
      expect(scheduler.getExecutionHistory('skip-job').some((e) => e.status === 'skipped')).toBe(
        true,
      );

      releaseHandler();
      scheduler.stopAll();
    } finally {
      unsubscribe();
    }
  });

  it('建臂失败（表达式无解）→ 收到 schedule_error', async () => {
    const app = await buildApp();
    const auth = `Bearer ${token(app, USER_A, 'a@cron-sse.test')}`;
    try {
      // `reportScheduleError` 只在 scheduleJob 里触发；用 updateJob 把已存在的
      // 任务改成无解表达式可以绕过路由的「未来时间」校验，直达调度层建臂失败。
      const created = await app.inject({
        method: 'POST',
        url: '/cron/jobs',
        headers: { authorization: auth },
        payload: { name: 'a', prompt: 'p', schedule_kind: 'every', schedule_every: 60_000 },
      });
      const jobId = (created.json().job as { id: string }).id;

      const reasons: string[] = [];
      const unsubscribe = bus.subscribeCronJobsChanged((e) => {
        if (e.reason === 'schedule_error') reasons.push(e.reason);
      });
      try {
        // 直接调调度器，绕过路由的表达式校验：`cron` + 无解表达式 → reportScheduleError。
        cronScheduler.updateJob(jobId, { schedule_kind: 'cron', schedule_expr: '0 0 30 2 *' });
      } finally {
        unsubscribe();
      }
      expect(reasons).toEqual(['schedule_error']);
    } finally {
      await app.close();
    }
  });
});
