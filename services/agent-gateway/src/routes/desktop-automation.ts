import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { desktopAutomationManager } from '../tools/desktop-automation.js';

function classifyDesktopAutomationError(error: unknown, actionLabel: string): {
  code: string;
  error: string;
  statusCode: number;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (message === 'desktop-only automation is disabled in this runtime') {
    return {
      code: 'desktop_automation_disabled',
      error: '当前运行环境未启用桌面自动化。',
      statusCode: 503,
    };
  }

  return {
    code: 'desktop_automation_failed',
    error: message.length > 0 ? message : `${actionLabel}失败。`,
    statusCode: 500,
  };
}

function failDesktopAutomationRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  step: ReturnType<typeof startRequestWorkflow>['step'],
  actionLabel: string,
  error: unknown,
): FastifyReply {
  const classified = classifyDesktopAutomationError(error, actionLabel);
  request.log.error({ err: error }, `desktop automation route failed: ${actionLabel}`);
  step.fail(classified.code);
  return reply.status(classified.statusCode).send({
    error: classified.error,
    code: classified.code,
  });
}

export async function desktopAutomationRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/desktop-automation/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.status');
      try {
        const status = await desktopAutomationManager.status();
        step.succeed(undefined, {
          enabled: status.enabled,
          started: status.started,
        });
        return reply.send(status);
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '读取桌面自动化状态', error);
      }
    },
  );

  app.post(
    '/desktop-automation/start',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.start');
      const body = parseBody(z.object({ url: z.string().url().optional() }), request.body);
      try {
        await desktopAutomationManager.start(body.url);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '启动桌面自动化', error);
      }
    },
  );

  app.post(
    '/desktop-automation/goto',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.goto');
      const body = parseBody(z.object({ url: z.string().url() }), request.body);
      try {
        await desktopAutomationManager.goto(body.url);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '导航桌面自动化页面', error);
      }
    },
  );

  app.post(
    '/desktop-automation/click',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.click');
      const body = parseBody(z.object({ selector: z.string().min(1) }), request.body);
      try {
        await desktopAutomationManager.click(body.selector);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '执行桌面自动化点击', error);
      }
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
      try {
        await desktopAutomationManager.type(body.selector, body.text);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '执行桌面自动化输入', error);
      }
    },
  );

  app.post(
    '/desktop-automation/screenshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.screenshot');
      try {
        const screenshotBase64 = await desktopAutomationManager.screenshot();
        step.succeed(undefined, { bytes: screenshotBase64.length });
        return reply.send({ screenshotBase64 });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '获取桌面自动化截图', error);
      }
    },
  );
}
