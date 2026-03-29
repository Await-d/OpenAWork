import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { sqliteRun } from '../db.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { GitHubTriggerImpl } from './github-trigger.js';
import type { GitHubTriggerConfig } from './github-trigger.js';

const trigger = new GitHubTriggerImpl();

trigger.setRouteHandler(async (ctx) => {
  const sessionId = crypto.randomUUID();
  sqliteRun(
    'INSERT INTO sessions (id, title, messages_json, state_status, metadata_json) VALUES (?, ?, ?, ?, ?)',
    [
      sessionId,
      `GitHub: ${ctx.eventType} on ${ctx.repoFullName}`,
      JSON.stringify([{ role: 'user', content: ctx.prompt }]),
      'idle',
      '{}',
    ],
  );

  return { sessionId };
});

const triggerConfigSchema = z.object({
  appId: z.string().min(1),
  privateKeyPem: z.string().min(1),
  webhookSecretForHmacVerification: z.string().min(1),
  repoFullNameOwnerSlashRepo: z.string().min(1),
  events: z.array(z.string()).min(1),
  branchFilterUndefinedMeansAll: z.array(z.string()).optional(),
  pathFilterUndefinedMeansAll: z.array(z.string()).optional(),
  agentPromptTemplate: z.string().min(1),
  autoApproveWithoutUserConfirmation: z.boolean().default(false),
});

export async function githubRoutes(app: FastifyInstance): Promise<void> {
  app.post('/github/webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    const { step } = startRequestWorkflow(request, 'github.webhook');
    const rawBody = Buffer.from(JSON.stringify(request.body));
    const headers: Record<string, string | string[] | undefined> = {};
    for (const [key, value] of Object.entries(request.headers)) {
      headers[key] = value;
    }

    try {
      const result = await trigger.handleWebhook({ headers, rawBody });
      if (result.sessionId) {
        step.succeed(undefined, {
          handled: true,
          sessionId: result.sessionId,
          event: result.eventType ?? 'unknown',
        });
        return reply.status(202).send({ ok: true, handled: true, sessionId: result.sessionId });
      }

      step.succeed(undefined, {
        handled: result.handled,
        event: result.eventType ?? 'ignored',
      });
      return reply.status(200).send({ ok: true, handled: result.handled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      step.fail(message);
      return reply.status(400).send({ error: message });
    }
  });

  app.get(
    '/github/triggers',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ triggers: trigger.listTriggers() });
    },
  );

  app.post(
    '/github/triggers',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'github.trigger.register');
      const body = triggerConfigSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid trigger config');
        return reply.status(400).send({ error: body.error.issues });
      }

      trigger.register(body.data as GitHubTriggerConfig);
      step.succeed(undefined, {
        repo: body.data.repoFullNameOwnerSlashRepo,
        events: body.data.events.length,
      });
      return reply.status(201).send({ ok: true, repo: body.data.repoFullNameOwnerSlashRepo });
    },
  );
}
