import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { startRequestWorkflow } from '../request-workflow.js';
import { createDesktopAutomationManager } from '../desktop-automation.js';

const desktopAutomation = createDesktopAutomationManager({
  enabled: process.env['DESKTOP_AUTOMATION'] === '1',
});

export async function desktopAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/desktop-automation/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.status');
      const status = await desktopAutomation.status();
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
      const body = z.object({ url: z.string().url().optional() }).safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ ok: false });
      }
      await desktopAutomation.start(body.data.url);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/goto',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.goto');
      const body = z.object({ url: z.string().url() }).safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ ok: false });
      }
      await desktopAutomation.goto(body.data.url);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/click',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.click');
      const body = z.object({ selector: z.string().min(1) }).safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ ok: false });
      }
      await desktopAutomation.click(body.data.selector);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/type',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.type');
      const body = z
        .object({ selector: z.string().min(1), text: z.string() })
        .safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ ok: false });
      }
      await desktopAutomation.type(body.data.selector, body.data.text);
      step.succeed();
      return reply.send({ ok: true });
    },
  );

  app.post(
    '/desktop-automation/screenshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.screenshot');
      const screenshotBase64 = await desktopAutomation.screenshot();
      step.succeed(undefined, { bytes: screenshotBase64.length });
      return reply.send({ screenshotBase64 });
    },
  );
}
