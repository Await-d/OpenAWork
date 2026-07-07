import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { desktopControlManager } from '../tools/desktop-control.js';

function classifyDesktopControlError(
  error: unknown,
  actionLabel: string,
): {
  readonly code: string;
  readonly error: string;
  readonly statusCode: number;
} {
  const message = error instanceof Error ? error.message : String(error);

  if (message === 'desktop control is disabled in this runtime') {
    return {
      code: 'desktop_control_disabled',
      error: '当前运行环境未启用系统桌面控制。',
      statusCode: 503,
    };
  }

  if (isDesktopControlUnavailableMessage(message)) {
    return {
      code: 'desktop_control_unavailable',
      error: message,
      statusCode: 503,
    };
  }

  return {
    code: 'desktop_control_failed',
    error: message.length > 0 ? message : `${actionLabel}失败。`,
    statusCode: 500,
  };
}

function isDesktopControlUnavailableMessage(message: string): boolean {
  return (
    message.includes('not found') ||
    message.includes('not implemented') ||
    message.includes('not supported') ||
    message.includes('requires')
  );
}

function failDesktopControlRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  step: ReturnType<typeof startRequestWorkflow>['step'],
  actionLabel: string,
  error: unknown,
): FastifyReply {
  const classified = classifyDesktopControlError(error, actionLabel);
  request.log.error({ err: error }, `desktop control route failed: ${actionLabel}`);
  step.fail(classified.code);
  return reply.status(classified.statusCode).send({
    error: classified.error,
    code: classified.code,
  });
}

const screenshotSchema = z.object({
  delayMs: z.number().int().min(0).max(5000).optional(),
});

const clickSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  button: z.enum(['left', 'right', 'middle']).default('left'),
  clickAction: z.enum(['click', 'double_click', 'down', 'up']).default('click'),
});

const typeSchema = z.object({
  text: z.string().min(1),
});

const keySchema = z.object({
  key: z.string().min(1),
});

const hotkeySchema = z.object({
  keys: z.array(z.string().min(1)).min(2).max(4),
});

const scrollSchema = z.object({
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  scrollX: z.number().finite().default(0),
  scrollY: z.number().finite().default(0),
});

const waitSchema = z.object({
  ms: z.number().int().min(0).max(10000).default(2000),
});

export async function desktopControlRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/desktop-control/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.status');
      try {
        const status = await desktopControlManager.status();
        step.succeed(undefined, { enabled: status.enabled });
        return reply.send(status);
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '读取系统桌面控制状态', error);
      }
    },
  );

  app.post(
    '/desktop-control/screenshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.screenshot');
      const body = parseBody(screenshotSchema, request.body);
      try {
        const result = await desktopControlManager.screenshot({ action: 'screenshot', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '获取系统桌面截图', error);
      }
    },
  );

  app.post(
    '/desktop-control/click',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.click');
      const body = parseBody(clickSchema, request.body);
      try {
        const result = await desktopControlManager.click({ action: 'click', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '执行系统桌面点击', error);
      }
    },
  );

  app.post(
    '/desktop-control/type',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.type');
      const body = parseBody(typeSchema, request.body);
      try {
        const result = await desktopControlManager.type({ action: 'type', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '执行系统桌面文本输入', error);
      }
    },
  );

  app.post(
    '/desktop-control/key',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.key');
      const body = parseBody(keySchema, request.body);
      try {
        const result = await desktopControlManager.key({ action: 'key', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '执行系统桌面按键', error);
      }
    },
  );

  app.post(
    '/desktop-control/hotkey',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.hotkey');
      const body = parseBody(hotkeySchema, request.body);
      try {
        const result = await desktopControlManager.hotkey({ action: 'hotkey', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '执行系统桌面组合键', error);
      }
    },
  );

  app.post(
    '/desktop-control/scroll',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.scroll');
      const body = parseBody(scrollSchema, request.body);
      try {
        const result = await desktopControlManager.scroll({ action: 'scroll', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '执行系统桌面滚动', error);
      }
    },
  );

  app.post(
    '/desktop-control/wait',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'desktop-control.wait');
      const body = parseBody(waitSchema, request.body);
      try {
        const result = await desktopControlManager.wait({ action: 'wait', ...body });
        step.succeed();
        return reply.send({ result });
      } catch (error) {
        return failDesktopControlRoute(request, reply, step, '等待系统桌面状态', error);
      }
    },
  );
}
