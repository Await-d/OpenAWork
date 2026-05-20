import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { desktopAutomationManager } from '../tools/desktop-automation.js';

export async function desktopAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/desktop-automation/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.status');
      const status = await desktopAutomationManager.status();
      step.succeed(undefined, {
        enabled: status.enabled,
        started: status.started,
      });
      return reply.send(status);
    },
  );

  app.post(
    '/desktop-automation/start',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.start');
      const body = parseBody(z.object({ url: z.string().url().optional() }), request.body);
      await desktopAutomationManager.start(body.url);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/goto',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.goto');
      const body = parseBody(z.object({ url: z.string().url() }), request.body);
      await desktopAutomationManager.goto(body.url);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/click',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.click');
      const body = parseBody(z.object({ selector: z.string().min(1) }), request.body);
      await desktopAutomationManager.click(body.selector);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/type',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.type');
      const body = parseBody(
        z.object({ selector: z.string().min(1), text: z.string() }),
        request.body,
      );
      await desktopAutomationManager.type(body.selector, body.text);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/screenshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.screenshot');
      const screenshotBase64 = await desktopAutomationManager.screenshot();
      step.succeed(undefined, { bytes: screenshotBase64.length });
      return reply.send({ screenshotBase64 });
    },
  );
}
