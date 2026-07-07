import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { desktopAutomationManager } from '../tools/desktop-automation.js';

function classifyDesktopAutomationError(
  error: unknown,
  actionLabel: string,
): {
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
    '/desktop-automation/back',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.back');
      try {
        await desktopAutomationManager.back();
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '返回上一页', error);
      }
    },
  );

  app.post(
    '/desktop-automation/forward',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.forward');
      try {
        await desktopAutomationManager.forward();
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '前进到下一页', error);
      }
    },
  );

  app.post(
    '/desktop-automation/reload',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.reload');
      try {
        await desktopAutomationManager.reload();
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '刷新桌面自动化页面', error);
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
    '/desktop-automation/press',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.press');
      const body = parseBody(
        z.object({ selector: z.string().min(1), key: z.string().min(1) }),
        request.body,
      );
      try {
        await desktopAutomationManager.press(body.selector, body.key);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '执行桌面自动化按键', error);
      }
    },
  );

  app.post(
    '/desktop-automation/scroll',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.scroll');
      const body = parseBody(
        z.object({
          direction: z.enum(['up', 'down']).default('down'),
          amount: z.number().int().min(1).max(10000).optional(),
        }),
        request.body,
      );
      try {
        await desktopAutomationManager.scroll(body.direction, body.amount);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '执行桌面自动化滚动', error);
      }
    },
  );

  app.post(
    '/desktop-automation/wait',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.wait');
      const body = parseBody(
        z.object({
          ms: z.number().int().min(0).max(60000).optional(),
          selector: z.string().min(1).optional(),
        }),
        request.body,
      );
      try {
        await desktopAutomationManager.wait(body);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '等待桌面自动化页面', error);
      }
    },
  );

  app.post(
    '/desktop-automation/content',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.content');
      try {
        const content = await desktopAutomationManager.content();
        step.succeed(undefined, { bytes: content.length });
        return reply.send({ content });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '读取桌面自动化页面内容', error);
      }
    },
  );

  app.post(
    '/desktop-automation/snapshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-automation.snapshot');
      try {
        const snapshot = await desktopAutomationManager.snapshot();
        step.succeed(undefined, { url: snapshot.url });
        return reply.send({ snapshot });
      } catch (error) {
        return failDesktopAutomationRoute(request, reply, step, '读取桌面自动化页面快照', error);
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
