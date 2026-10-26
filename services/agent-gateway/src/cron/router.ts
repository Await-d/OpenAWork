import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';
import { parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { runCronAgentJob } from './agent-handler.js';
import {
  deleteCronJob,
  listCronExecutionsForJob,
  recordCronExecution,
  upsertCronJob,
} from './cron-store.js';
import { CronScheduler, type CronSchedulerPersistence } from './scheduler.js';
import { isValidCronExpression } from './cron-expression.js';
import { attachExecutionPreviews } from './delivery.js';
import { toCronJobView, type CronJobView } from './schedule-display.js';
import type { CronJobRecord } from './types.js';

/**
 * 持久化钩子：任务定义与执行历史落 `cron_jobs` / `cron_job_executions`；
 * 启动时由 `restoreCronJobsFromStore` 重新装载（见 index.ts boot 步骤）。
 */
const cronPersistence: CronSchedulerPersistence = {
  upsertJob: (job) => upsertCronJob(job),
  deleteJob: (id) => deleteCronJob(id),
  recordExecution: (job, exec) => recordCronExecution(job.user_id, exec),
};

export const cronScheduler = new CronScheduler(
  runCronAgentJob,
  3,
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

const jobSchema = z.object({
  name: z.string().min(1),
  schedule_kind: z.enum(['at', 'every', 'cron']),
  schedule_at: z.number().optional().nullable().default(null),
  schedule_every: z.number().int().positive().optional().nullable().default(null),
  schedule_expr: z
    .string()
    .optional()
    .nullable()
    .default(null)
    .refine((value) => value === null || value === undefined || isValidCronExpression(value), {
      message: 'schedule_expr 必须是合法的 5 段 cron 表达式（分 时 日 月 周）。',
    }),
  schedule_tz: z.string().default('UTC'),
  prompt: z.string().min(1),
  agent_id: z.string().optional().nullable().default(null),
  model: z.string().optional().nullable().default(null),
  working_folder: z.string().optional().nullable().default(null),
  session_id: z.string().optional().nullable().default(null),
  delivery_mode: z.enum(['desktop', 'session', 'none']).default('none'),
  delivery_target: z.string().optional().nullable().default(null),
  plugin_id: z.string().optional().nullable().default(null),
  plugin_chat_id: z.string().optional().nullable().default(null),
  enabled: z.boolean().default(true),
  delete_after_run: z.boolean().default(false),
  max_iterations: z.number().int().default(10),
});
const jobPatchSchema = jobSchema.partial();
const authUserSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
});

type CronRouteErrorCode = 'cron_job_not_found' | 'invalid_cron_job';

const CRON_ROUTE_ERROR_MESSAGES: Record<CronRouteErrorCode, string> = {
  cron_job_not_found: '目标定时任务不存在。',
  invalid_cron_job: '定时任务配置无效。',
};

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
function toView(job: CronJobRecord): CronJobView {
  return toCronJobView(job, {
    nextFireAt: cronScheduler.getNextFireAt(job.id),
    running: cronScheduler.getExecutionHistory(job.id).some((exec) => exec.status === 'running'),
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
      const jobs = cronScheduler
        .listJobs()
        .filter((job) => job.user_id === user.sub)
        .map(toView);
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
        last_fired_at: null,
        fire_count: 0,
        created_at: now,
        updated_at: now,
      };

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

      const applyStep = child('apply', undefined, { jobId: id });
      cronScheduler.updateJob(id, body.data);
      applyStep.succeed();

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
      // 触发后立即返回（handler 可能跑很久）；结果看 `/history`。
      void cronScheduler.runJobNow(id).catch(() => undefined);
      runStep.succeed();
      step.succeed(undefined, { jobId: id });
      return reply.status(202).send({ ok: true, jobId: id });
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
        z.object({
          limit: z.coerce.number().min(1).max(100).default(100),
          // 摘要要逐条读执行会话的消息（`listMessagesWithParts` 默认全量），
          // 成本远高于查执行表。列表页刷新会对每个任务调一次本接口、只取最新一条
          // 判「上次是否失败」，必须能显式关掉摘要，否则任务数 × 5 次全量会话读取。
          //
          // **不能用 `z.coerce.boolean()`**：它走 `Boolean(value)`，而 `Boolean('0')`
          // 与 `Boolean('false')` 都是 `true`——`?preview=0` 会静默失效、摘要照旧生成。
          // 这里显式解析字符串。
          preview: z
            .union([z.boolean(), z.string()])
            .optional()
            .transform((value) => {
              if (value === undefined) return true;
              if (typeof value === 'boolean') return value;
              return value !== '0' && value.toLowerCase() !== 'false';
            }),
        }),
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
      const disabledJob = cronScheduler.getJob(id);
      return reply.send({ ok: true, job: disabledJob ? toView(disabledJob) : null });
    },
  );
}
