import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { runCronAgentJob } from './agent-handler.js';
import { CronScheduler } from './scheduler.js';
import type { CronJobRecord } from './types.js';

export const cronScheduler = new CronScheduler(runCronAgentJob);

const jobSchema = z.object({
  name: z.string().min(1),
  schedule_kind: z.enum(['at', 'every', 'cron']),
  schedule_at: z.number().optional().nullable().default(null),
  schedule_every: z.number().optional().nullable().default(null),
  schedule_expr: z.string().optional().nullable().default(null),
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

export async function cronRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/cron/jobs',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'cron.job.list');
      const readStep = child('read');
      const user = parseAuthUser(request);
      const jobs = cronScheduler.listJobs().filter((job) => job.user_id === user.sub);
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

      return reply.status(201).send({ job });
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

      return reply.send({ job: updatedJob });
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
      const historyStep = child('read', undefined, { jobId: id });
      const history = cronScheduler.getExecutionHistory(id);
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
      return reply.send({ ok: true });
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
      return reply.send({ ok: true });
    },
  );
}
