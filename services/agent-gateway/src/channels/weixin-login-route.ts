import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { startWeixinLoginWithQr, waitForWeixinLogin } from './weixin-login.js';

const weixinLoginStartSchema = z.object({
  accountId: z.string().min(1).optional(),
  baseUrl: z.string().min(1).optional(),
  routeTag: z.string().min(1).optional(),
  botType: z.string().min(1).optional(),
  force: z.boolean().optional(),
});

const weixinLoginWaitSchema = z.object({
  sessionKey: z.string().min(1),
  baseUrl: z.string().min(1).optional(),
  routeTag: z.string().min(1).optional(),
  botType: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(1_000).max(480_000).optional(),
});

export async function registerWeixinLoginRoutes(app: FastifyInstance): Promise<void> {
  app.post('/channels/weixin/login/start', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'channel.weixin-login-start');
    const parsedBody = weixinLoginStartSchema.safeParse(request.body);
    if (!parsedBody.success) {
      step.fail('invalid input');
      return reply.status(400).send({ error: 'Invalid input', issues: parsedBody.error.issues });
    }

    const result = await startWeixinLoginWithQr(parsedBody.data);
    step.succeed(undefined, { sessionKey: result.sessionKey });
    return reply.send(result);
  });

  app.post('/channels/weixin/login/wait', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'channel.weixin-login-wait');
    const parsedBody = weixinLoginWaitSchema.safeParse(request.body);
    if (!parsedBody.success) {
      step.fail('invalid input');
      return reply.status(400).send({ error: 'Invalid input', issues: parsedBody.error.issues });
    }

    const result = await waitForWeixinLogin(parsedBody.data);
    step.succeed(undefined, { connected: result.connected });
    return reply.send(result);
  });
}
