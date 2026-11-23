import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  scheduledTaskCreateInputSchema,
  scheduledTaskUpdateInputSchema,
  scheduledTaskHistoryOptionsSchema,
} from '@openAwork/shared';
import { requireAuth } from '../infra/auth.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { runCronAgentJob } from './agent-handler.js';
import {
  deleteCronJob,
  listCronExecutionsForJob,
  listLatestCronExecutionsForJobs,
  recordCronExecution,
  upsertCronJob,
} from './cron-store.js';
import { CronScheduler, type CronSchedulerPersistence } from './scheduler.js';
import { publishCronJobsChanged } from './cron-events-bus.js';
import { isValidCronExpression } from './cron-expression.js';
import { collectScheduleIssues } from './schedule-validation.js';
import { attachExecutionPreviews } from './delivery.js';
import { toCronJobView, type CronJobView } from './schedule-display.js';
import type { CronExecutionRecord, CronJobRecord } from './types.js';

/**
 * 持久化钩子：任务定义与执行历史落 `cron_jobs` / `cron_job_executions`；
 * 启动时由 `restoreCronJobsFromStore` 重新装载（见 index.ts boot 步骤）。
 */
const cronPersistence: CronSchedulerPersistence = {
  upsertJob: (job) => upsertCronJob(job),
  deleteJob: (id) => deleteCronJob(id),
  recordExecution: (job, exec) => recordCronExecution(job.user_id, exec),
};

/** 定时任务全局并发上限默认值（单任务同时最多 1 次，跨任务最多 N 次）。 */
export const DEFAULT_CRON_MAX_CONCURRENT = 3;

/**
 * 解析 `OPENAWORK_CRON_MAX_CONCURRENT`。
 *
 * 上限 50 是保护性约束：并发的是完整 agent 会话（每条都占模型连接与 SQLite
 * 写锁），配错一个超大值等于把网关变成压测目标。非法值 / 缺省回落默认，
 * 不阻断启动。
 */
export function resolveCronMaxConcurrent(
  raw: string | undefined = process.env['OPENAWORK_CRON_MAX_CONCURRENT'],
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return DEFAULT_CRON_MAX_CONCURRENT;
  return Math.min(parsed, 50);
}

export const cronScheduler = new CronScheduler(
  runCronAgentJob,
  resolveCronMaxConcurrent(),
  undefined,
  undefined,
  cronPersistence,
);

/**
 * 建臂失败（表达式非法 / 搜索窗口内无解）上报为一条 failed 执行记录。
 *
 * 否则坏任务只会静默 return、既不触发也不报错，用户侧完全看不出「这个任务已经
 * 不会再跑了」；落一条历史后，界面与 `history` 动作都能看到原因。
 */
cronScheduler.setScheduleErrorListener((jobId, message) => {
  const job = cronScheduler.getJob(jobId);
  if (!job) return;
  const now = Date.now();
  recordCronExecution(job.user_id, {
    id: crypto.randomUUID(),
    job_id: jobId,
    started_at: now,
    finished_at: now,
    status: 'failed',
    error: `调度建臂失败：${message}`,
  });
});

/**
 * 持久化失败的观测出口。
 *
 * 调度器把 `upsertJob` / `recordExecution` 的异常吞掉（见 `persistSafely`），
 * 以免 SQLite 故障把 `inFlightJobs` / `runningCount` 泄漏成「任务永久停摆」。
 * 但吞掉必须留下痕迹——否则「执行历史突然不再更新」会变成无解的悬案。
 */
cronScheduler.setPersistenceErrorListener((label, error) => {
  logGatewayWarn(`[cron] 持久化失败（${label}），调度状态不受影响`, {
    label,
    error: error instanceof Error ? error.message : String(error),
  });
});

/** 表达式可执行性属于网关；wire 形状与默认值来自共享契约。 */
const scheduleExpressionCheck = {
  message: 'schedule_expr 必须是合法的 5 段 cron 表达式（分 时 日 月 周）。',
};
const validScheduleExpression = (input: { schedule_expr?: string | null }): boolean =>
  input.schedule_expr == null || isValidCronExpression(input.schedule_expr);
const jobSchema = scheduledTaskCreateInputSchema.refine(
  validScheduleExpression,
  scheduleExpressionCheck,
);
const jobPatchSchema = scheduledTaskUpdateInputSchema.refine(
  validScheduleExpression,
  scheduleExpressionCheck,
);
const authUserSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
});

type CronRouteErrorCode = 'cron_job_not_found' | 'invalid_cron_job' | 'cron_job_busy';

const CRON_ROUTE_ERROR_MESSAGES: Record<CronRouteErrorCode, string> = {
  cron_job_not_found: '目标定时任务不存在。',
  invalid_cron_job: '定时任务配置无效。',
  // 「立即运行」没跑起来：任务在途 / 并发已满。必须区别于 202 假成功。
  cron_job_busy: '定时任务当前无法执行。',
};

/** 「立即运行」被跳过时的用户可读原因。 */
function cronRunSkipMessage(reason: 'missing' | 'disabled' | 'in-flight' | 'busy'): string {
  switch (reason) {
    case 'in-flight':
      return '该任务上一次执行尚未结束，请稍后再试。';
    case 'busy':
      return '网关当前并发执行已满，请稍后再试。';
    case 'disabled':
      return '该任务已停用。';
    case 'missing':
      return '目标定时任务不存在。';
  }
}

function cronRouteErrorPayload(
  code: CronRouteErrorCode,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    code,
    error: CRON_ROUTE_ERROR_MESSAGES[code],
    ...(extra ?? {}),
  };
}

function getUserCronJob(id: string, userId: string): CronJobRecord | undefined {
  const job = cronScheduler.getJob(id);
  return job?.user_id === userId ? job : undefined;
}

function parseAuthUser(request: FastifyRequest): z.infer<typeof authUserSchema> {
  return authUserSchema.parse(request.user);
}

/** 原始记录 → 视图模型（补 `scheduleDisplay` / `status` / `fireCount` / `nextFireAt`）。 */
function toView(job: CronJobRecord, lastExecution: CronExecutionRecord | null = null): CronJobView {
  return toCronJobView(job, {
    nextFireAt: cronScheduler.getNextFireAt(job.id),
    running: cronScheduler.getExecutionHistory(job.id).some((exec) => exec.status === 'running'),
    lastExecution,
  });
}

/**
 * 写入前的一致性校验：kind 必填项、时区名、投递目标。
 *
 * 只做 Zod 的类型检查挡不住「字段齐全但组合起来永不触发」的配置——这类任务
 * 建完就静默停摆，所以必须在落库 / 改内存之前拒绝。
 */
function collectJobIssues(
  job: CronJobRecord,
  options: { readonly allowExpiredAt?: boolean } = {},
): string[] {
  return collectScheduleIssues({
    scheduleKind: job.schedule_kind,
    scheduleAt: job.schedule_at,
    scheduleEvery: job.schedule_every,
    scheduleExpr: job.schedule_expr,
    scheduleTimeZone: job.schedule_tz,
    deliveryMode: job.delivery_mode,
    deliveryTarget: job.delivery_target,
    sessionId: job.session_id,
    // 渠道任务不能投递到会话（结果由 PluginSendMessage 回发渠道），否则迟早
    // 变成「执行成功但记录失败」或「执行前就报会话不存在」。
    pluginId: job.plugin_id,
    pluginChatId: job.plugin_chat_id,
    ...(options.allowExpiredAt === true ? { allowExpiredAt: true } : {}),
  });
}

/** 把问题列表转成 400 body；全部原因拼进 `error`，客户端 toast 可直接展示。 */
function invalidJobPayload(issues: readonly string[]): Record<string, unknown> {
  return cronRouteErrorPayload('invalid_cron_job', {
    error: issues.join('；'),
    issues: issues.map((message) => ({ message })),
  });
}

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/cron/jobs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'cron.job.list');
      const readStep = child('read');
      const user = parseAuthUser(request);
      const owned = cronScheduler.listJobs().filter((job) => job.user_id === user.sub);
      // 一次查出所有任务的最近一次执行：列表页要逐条标「上次是否失败」，
      // 逐任务调 `/history?limit=1` 会变成 N+1（任务数 × HTTP + SQL）。
      const latestExecutions = listLatestCronExecutionsForJobs(owned.map((job) => job.id));
      const jobs = owned.map((job) => toView(job, latestExecutions.get(job.id) ?? null));
      readStep.succeed(undefined, { count: jobs.length });
      step.succeed(undefined, { count: jobs.length });
      return reply.send({ jobs });
    },
  );

  app.post(
    '/cron/jobs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'cron.job.create');

      const parseStep = child('parse-body');
      const body = jobSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send(
          cronRouteErrorPayload('invalid_cron_job', {
            issues: body.error.issues,
          }),
        );
      }
      parseStep.succeed();

      const user = parseAuthUser(request);
      const now = Date.now();
      const job: CronJobRecord = {
        ...body.data,
        id: crypto.randomUUID(),
        user_id: user.sub,
        // 历史列保留（表结构不变），但已从 API / 工具入参移除：执行链路没有
        // 对应的迭代上限实现，继续暴露只会让用户以为设了有效。
        max_iterations: 10,
        last_fired_at: null,
        fire_count: 0,
        created_at: now,
        updated_at: now,
      };

      const validateStep = child('validate');
      const issues = collectJobIssues(job);
      if (issues.length > 0) {
        validateStep.fail('invalid config');
        step.fail('invalid config');
        return reply.status(400).send(invalidJobPayload(issues));
      }
      validateStep.succeed();

      const addStep = child('add', undefined, {
        enabled: job.enabled,
        jobId: job.id,
        scheduleKind: job.schedule_kind,
      });
      cronScheduler.addJob(job);
      addStep.succeed();
      step.succeed(undefined, {
        enabled: job.enabled,
        jobId: job.id,
        scheduleKind: job.schedule_kind,
      });

      // `addJob` 内部已同步完成落库（先落库后改内存，失败会抛错至此处之前），
      // 故发出事件时任务定义确已持久化。
      publishCronJobsChanged({ userId: user.sub, reason: 'created', jobId: job.id });

      return reply.status(201).send({ job: toView(job) });
    },
  );

  app.patch(
    '/cron/jobs/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.update', undefined, {
        jobId: id,
      });

      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();

      const parseStep = child('parse-body');
      const body = jobPatchSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send(
          cronRouteErrorPayload('invalid_cron_job', {
            issues: body.error.issues,
          }),
        );
      }
      parseStep.succeed();

      // 按「合并后的最终配置」校验：只改 kind / 只改投递方式，都可能把任务
      // 组合成永不触发或投递无门的状态（如 cron 任务被清空表达式）。
      const merged: CronJobRecord = { ...job, ...body.data, id: job.id, user_id: job.user_id };
      const validateStep = child('validate', undefined, { jobId: id });
      // 只改名 / 只停用不应该被「这个 at 任务早就过期了」挡住；只要请求改了
      // kind 或触发时间，就必须按「未来时间」严格校验。
      const issues = collectJobIssues(merged, {
        allowExpiredAt:
          body.data.schedule_kind === undefined &&
          body.data.schedule_at === undefined &&
          // `enabled: true` 表达「我要它跑」：过期的一次性任务必须直接拒绝，
          // 不能先放过再在调度层记一条建臂失败。
          body.data.enabled !== true,
      });
      if (issues.length > 0) {
        validateStep.fail('invalid config');
        step.fail('invalid config');
        return reply.status(400).send(invalidJobPayload(issues));
      }
      validateStep.succeed();

      const applyStep = child('apply', undefined, { jobId: id });
      cronScheduler.updateJob(id, body.data);
      applyStep.succeed();

      // `updateJob` 返回即表示落库成功（失败会冒泡）。PATCH 是通用更新入口，
      // 启停以外的字段变化统一归为 `updated`。
      publishCronJobsChanged({ userId: user.sub, reason: 'updated', jobId: id });

      const readbackStep = child('readback', undefined, { jobId: id });
      const updatedJob = cronScheduler.getJob(id);
      readbackStep.succeed(undefined, { found: updatedJob !== undefined });
      step.succeed(undefined, { jobId: id });

      return reply.send({ job: updatedJob ? toView(updatedJob) : null });
    },
  );

  // 「立即运行」：手动触发一次，与到点触发走同一条 handler / 并发 / 历史路径。
  // Web 端此前只能 logger.info 占位，用户点了没有任何反应。
  app.post(
    '/cron/jobs/:id/run',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.run', undefined, {
        jobId: id,
      });
      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();

      const runStep = child('run', undefined, { jobId: id });
      // 只「起跑」，不等 handler 结束（可能跑很久）；结果看 `/history`。
      // 但必须把「没跑起来」如实回给调用方：任务在途 / 并发已满时旧实现
      // 仍返回 202，界面于是提示「已触发」而实际什么都没发生。
      const started = cronScheduler.startJobNow(id);
      if (!started.started) {
        runStep.fail(started.reason);
        step.fail(started.reason);
        return reply.status(409).send(
          cronRouteErrorPayload('cron_job_busy', {
            error: cronRunSkipMessage(started.reason),
            reason: started.reason,
          }),
        );
      }
      runStep.succeed(undefined, { jobId: id, executionId: started.executionId });
      step.succeed(undefined, { jobId: id });
      return reply.status(202).send({ ok: true, jobId: id, executionId: started.executionId });
    },
  );

  app.delete(
    '/cron/jobs/:id',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.delete', undefined, {
        jobId: id,
      });
      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();
      const removeStep = child('remove', undefined, { jobId: id });
      cronScheduler.removeJob(id);
      removeStep.succeed();
      step.succeed(undefined, { jobId: id });

      // `removeJob` 先删库再清内存，返回即落库成功（失败会冒泡）。
      publishCronJobsChanged({ userId: user.sub, reason: 'deleted', jobId: id });

      return reply.status(204).send();
    },
  );

  app.get(
    '/cron/jobs/:id/history',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.history', undefined, {
        jobId: id,
      });
      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();
      const query = parseQuery(
        scheduledTaskHistoryOptionsSchema,
        (request as FastifyRequest & { query: unknown }).query,
      );

      const historyStep = child('read', undefined, { jobId: id });
      // 读持久化历史（重启后仍可查）；调度器内存 ring 仅作运行期内部状态。
      // 补齐产出摘要与执行会话 id：`delivery_mode: 'none'` 的任务不会主动投递，
      // 用户只能靠这两样东西找到「这次跑了什么」（摘要直读 / session_id 跳现场）。
      const executions = listCronExecutionsForJob(id, query.limit);
      const history = query.preview
        ? attachExecutionPreviews({ userId: user.sub, executions })
        : executions;
      historyStep.succeed(undefined, { entries: history.length, jobId: id });
      step.succeed(undefined, { entries: history.length, jobId: id });
      return reply.send({ history });
    },
  );

  app.post(
    '/cron/jobs/:id/enable',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.enable', undefined, {
        jobId: id,
      });
      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();
      const applyStep = child('apply', undefined, { jobId: id });
      cronScheduler.updateJob(id, { enabled: true });
      applyStep.succeed();
      step.succeed(undefined, { jobId: id });
      publishCronJobsChanged({ userId: user.sub, reason: 'enabled', jobId: id });
      const enabledJob = cronScheduler.getJob(id);
      return reply.send({ ok: true, job: enabledJob ? toView(enabledJob) : null });
    },
  );

  app.post(
    '/cron/jobs/:id/disable',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { step, child } = startRequestWorkflow(request, 'cron.job.disable', undefined, {
        jobId: id,
      });
      const lookupStep = child('lookup', undefined, { jobId: id });
      const user = parseAuthUser(request);
      const job = getUserCronJob(id, user.sub);
      if (!job) {
        lookupStep.fail('job not found');
        step.fail('job not found');
        return reply.status(404).send(cronRouteErrorPayload('cron_job_not_found'));
      }
      lookupStep.succeed();
      const applyStep = child('apply', undefined, { jobId: id });
      cronScheduler.updateJob(id, { enabled: false });
      applyStep.succeed();
      step.succeed(undefined, { jobId: id });
      publishCronJobsChanged({ userId: user.sub, reason: 'disabled', jobId: id });
      const disabledJob = cronScheduler.getJob(id);
      return reply.send({ ok: true, job: disabledJob ? toView(disabledJob) : null });
    },
  );
}
