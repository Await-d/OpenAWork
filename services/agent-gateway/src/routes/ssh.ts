/**
 * SSH 路由：用户范围内的连接 CRUD、文件浏览、上传，以及面板恢复用的
 * 「SSH 对话」状态。所有持久化都委托给 `SshService`，进程重启时既能恢复
 * 列表，也能根据 auto-reconnect 标记自动重连最近活跃的连接。
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody, parseQuery } from '../infra/parse-request.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { getSshService } from '../ssh/ssh-service.js';

const connectionCreateSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().positive().default(22),
  username: z.string().min(1),
  authType: z.enum(['password', 'key', 'agent']),
  password: z.string().optional(),
  privateKeyPath: z.string().optional(),
  autoReconnect: z.boolean().optional(),
});

const connectionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  username: z.string().min(1).optional(),
  authType: z.enum(['password', 'key', 'agent']).optional(),
  password: z.string().nullable().optional(),
  privateKeyPath: z.string().nullable().optional(),
  autoReconnect: z.boolean().optional(),
});

const bindSchema = z.object({ sessionId: z.string().min(1) });
const unbindSchema = z.object({ sessionId: z.string().min(1) });

const fileQuerySchema = z.object({
  connectionId: z.string().min(1),
  path: z.string().min(1),
});

const uploadSchema = z.object({
  connectionId: z.string().min(1),
  path: z.string().min(1),
  contentBase64: z.string().min(1),
});

const dialogTouchSchema = z.object({
  connectionId: z.string().min(1),
  title: z.string().nullable().optional(),
  cwd: z.string().optional(),
  lastFilePath: z.string().nullable().optional(),
  lastFileEncoding: z.enum(['utf8', 'base64']).nullable().optional(),
  pinned: z.boolean().optional(),
  touch: z.boolean().optional(),
});

interface ClassifiedSshError {
  error: string;
  statusCode: number;
}

function classifySshRouteError(error: unknown, actionLabel: string): ClassifiedSshError {
  const message = error instanceof Error ? error.message : String(error);
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;

  if (message.startsWith('SSH connection not found:')) {
    return { statusCode: 404, error: 'SSH 连接不存在。' };
  }
  if (message.startsWith('SSH client not connected:')) {
    return { statusCode: 409, error: 'SSH 连接尚未建立。' };
  }
  if (errno === 'ENOENT') {
    return { statusCode: 404, error: '远端文件不存在。' };
  }

  return {
    statusCode: 500,
    error: message.length > 0 ? message : `${actionLabel}失败。`,
  };
}

function failSshRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  step: ReturnType<typeof startRequestWorkflow>['step'],
  actionLabel: string,
  error: unknown,
): FastifyReply {
  const classified = classifySshRouteError(error, actionLabel);
  if (classified.statusCode >= 500) {
    request.log.error({ err: error }, `ssh route failed: ${actionLabel}`);
  }
  step.fail(classified.error);
  return reply.status(classified.statusCode).send({ error: classified.error });
}

function userId(request: FastifyRequest): string {
  return (request.user as JwtPayload).sub;
}

export async function sshRoutes(app: FastifyInstance): Promise<void> {
  const service = () => getSshService();

  app.get('/ssh/connections', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.list');
    const connections = service().listConnections(userId(request));
    step.succeed(undefined, { count: connections.length });
    return reply.send({ connections });
  });

  app.post('/ssh/connections', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.add');
    const parsed = parseBody(connectionCreateSchema, request.body);
    try {
      const connection = service().createConnection(userId(request), {
        name: parsed.name,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        authType: parsed.authType,
        privateKeyPath: parsed.privateKeyPath ?? null,
        password: parsed.password ?? null,
        autoReconnect: parsed.autoReconnect,
      });
      step.succeed(undefined, { connectionId: connection.id });
      return reply.send({ connection });
    } catch (error) {
      return failSshRoute(request, reply, step, '保存 SSH 连接', error);
    }
  });

  app.patch('/ssh/connections/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.update');
    const parsed = parseBody(connectionUpdateSchema, request.body);
    const id = (request.params as { id: string }).id;
    const updated = service().updateConnection(userId(request), id, {
      name: parsed.name,
      host: parsed.host,
      port: parsed.port,
      username: parsed.username,
      authType: parsed.authType,
      privateKeyPath: parsed.privateKeyPath ?? undefined,
      password: parsed.password ?? undefined,
      autoReconnect: parsed.autoReconnect,
    });
    if (!updated) {
      step.fail('SSH 连接不存在。');
      return reply.status(404).send({ error: 'SSH 连接不存在。' });
    }
    step.succeed(undefined, { connectionId: updated.id });
    return reply.send({ connection: updated });
  });

  app.delete('/ssh/connections/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.delete');
    const id = (request.params as { id: string }).id;
    try {
      const removed = await service().deleteConnection(userId(request), id);
      if (!removed) {
        step.fail('SSH 连接不存在。');
        return reply.status(404).send({ error: 'SSH 连接不存在。' });
      }
      step.succeed(undefined, { connectionId: id });
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '删除 SSH 连接', error);
    }
  });

  app.post('/ssh/connections/:id/connect', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.connect');
    try {
      const connection = await service().connect(
        userId(request),
        (request.params as { id: string }).id,
      );
      step.succeed(undefined, { connectionId: connection.id });
      return reply.send({ connection });
    } catch (error) {
      return failSshRoute(request, reply, step, '连接 SSH', error);
    }
  });

  app.post(
    '/ssh/connections/:id/disconnect',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { step } = startRequestWorkflow(request, 'ssh.connections.disconnect');
      try {
        const connection = await service().disconnect(
          userId(request),
          (request.params as { id: string }).id,
        );
        step.succeed(undefined, { connectionId: connection.id });
        return reply.send({ connection });
      } catch (error) {
        return failSshRoute(request, reply, step, '断开 SSH 连接', error);
      }
    },
  );

  app.post('/ssh/connections/:id/bind', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.bind');
    const parsed = parseBody(bindSchema, request.body);
    try {
      const binding = service().bindSession(
        userId(request),
        parsed.sessionId,
        (request.params as { id: string }).id,
      );
      step.succeed(undefined, { sessionId: parsed.sessionId });
      return reply.send({ binding });
    } catch (error) {
      return failSshRoute(request, reply, step, '绑定 SSH 连接', error);
    }
  });

  app.post('/ssh/bindings/unbind', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.connections.unbind');
    const parsed = parseBody(unbindSchema, request.body);
    service().unbindSession(userId(request), parsed.sessionId);
    step.succeed(undefined, { sessionId: parsed.sessionId });
    return reply.send({ ok: true });
  });

  app.get('/ssh/bindings', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.bindings.list');
    const bindings = service().listBindings(userId(request));
    step.succeed(undefined, { count: bindings.length });
    return reply.send({ bindings });
  });

  app.get('/ssh/files', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.files.list');
    const parsed = parseQuery(fileQuerySchema, request.query);
    try {
      const entries = await service().listFiles(
        userId(request),
        parsed.connectionId,
        parsed.path,
      );
      step.succeed(undefined, { count: entries.length });
      return reply.send({ entries });
    } catch (error) {
      return failSshRoute(request, reply, step, '读取 SSH 文件列表', error);
    }
  });

  app.get('/ssh/file', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.read');
    const parsed = parseQuery(fileQuerySchema, request.query);
    try {
      const preview = await service().readFile(
        userId(request),
        parsed.connectionId,
        parsed.path,
      );
      step.succeed(undefined, { path: parsed.path });
      return reply.send({ preview });
    } catch (error) {
      return failSshRoute(request, reply, step, '读取 SSH 文件预览', error);
    }
  });

  app.post('/ssh/upload', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.upload');
    const parsed = parseBody(uploadSchema, request.body);
    const bytes = Uint8Array.from(Buffer.from(parsed.contentBase64, 'base64'));
    try {
      await service().writeFile(
        userId(request),
        parsed.connectionId,
        parsed.path,
        bytes,
      );
      step.succeed(undefined, { bytes: bytes.length });
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '上传 SSH 文件', error);
    }
  });

  // ─── Dialogs（重启后用于恢复「上一次打开的 SSH 对话」） ──────────────────

  app.get('/ssh/dialogs', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.dialogs.list');
    const dialogs = service().listDialogs(userId(request));
    step.succeed(undefined, { count: dialogs.length });
    return reply.send({ dialogs });
  });

  app.get('/ssh/dialogs/last', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.dialogs.last');
    const dialog = service().getLastOpenedDialog(userId(request));
    step.succeed(undefined, { dialogId: dialog?.id ?? '' });
    return reply.send({ dialog });
  });

  app.post('/ssh/dialogs/touch', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.dialogs.touch');
    const parsed = parseBody(dialogTouchSchema, request.body);
    try {
      const dialog = service().upsertDialog({
        userId: userId(request),
        connectionId: parsed.connectionId,
        title: parsed.title ?? undefined,
        cwd: parsed.cwd,
        lastFilePath: parsed.lastFilePath ?? undefined,
        lastFileEncoding: parsed.lastFileEncoding ?? undefined,
        pinned: parsed.pinned,
        touch: parsed.touch,
      });
      step.succeed(undefined, { dialogId: dialog.id });
      return reply.send({ dialog });
    } catch (error) {
      return failSshRoute(request, reply, step, '更新 SSH 对话状态', error);
    }
  });

  app.delete('/ssh/dialogs/:id', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.dialogs.delete');
    const removed = service().deleteDialog(
      userId(request),
      (request.params as { id: string }).id,
    );
    if (!removed) {
      step.fail('SSH 对话不存在。');
      return reply.status(404).send({ error: 'SSH 对话不存在。' });
    }
    step.succeed();
    return reply.send({ ok: true });
  });
}

export const __testing = {
  /** Reset the active service (re-creates a fresh in-memory + DB-backed instance). */
  reset(): void {
    // Importing eagerly would create a cycle; resolve lazily here so the
    // helper can be used in setup hooks without risking a load order issue.
    import('../ssh/ssh-service.js').then((mod) => {
      mod.__resetSshServiceForTests(new mod.SshService());
    });
  },
};
