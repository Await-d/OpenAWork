import {
  SSH_SFTP_UNAVAILABLE_MESSAGE,
  SshRemotePathError,
  SshSftpUnavailableError,
} from '@openAwork/agent-core';
import { replaceSshHostKey, SshHostKeyError } from '../ssh/ssh-host-trust.js';
import { SshCredentialPolicyError } from '../ssh/ssh-credential-policy.js';
/**
 * SSH 路由：用户范围内的连接 CRUD、文件浏览、上传，以及面板恢复用的
 * 「SSH 对话」状态。所有持久化都委托给 `SshService`，进程重启时既能恢复
 * 列表，也能根据 auto-reconnect 标记自动重连最近活跃的连接。
 */

import { SshSessionOwnershipError } from '../ssh/ssh-session-ownership.js';

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
  authType: z.enum(['password', 'key', 'key-password', 'agent']),
  password: z.string().optional(),
  privateKeyPath: z.string().nullable().optional(),
  privateKey: z.string().nullable().optional(),
  passphrase: z.string().nullable().optional(),
  autoReconnect: z.boolean().optional(),
});

const connectionUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().positive().optional(),
  username: z.string().min(1).optional(),
  authType: z.enum(['password', 'key', 'key-password', 'agent']).optional(),
  password: z.string().nullable().optional(),
  privateKeyPath: z.string().nullable().optional(),
  privateKey: z.string().nullable().optional(),
  passphrase: z.string().nullable().optional(),
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

const mkdirSchema = z.object({
  connectionId: z.string().min(1),
  path: z.string().min(1),
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
  if (error instanceof SshHostKeyError) return { statusCode: 409, error: error.message };
  if (error instanceof SshCredentialPolicyError) return { statusCode: 403, error: error.message };
  if (error instanceof SshSessionOwnershipError) {
    return { statusCode: 404, error: '目标会话不存在。' };
  }
  const message = error instanceof Error ? error.message : String(error);
  const errno = (error as NodeJS.ErrnoException | undefined)?.code;

  // agent-core 归一出的远端路径语义错误：按 kind 映射成客户端可纠正的 4xx，
  // 而不是 500（旧链路表现为 `500 + "Failure"`，排障包里无从定位）。
  if (error instanceof SshRemotePathError) {
    if (error.kind === 'directory') {
      return { statusCode: 400, error: '远端路径是目录，无法作为文件预览。' };
    }
    if (error.kind === 'not-found') {
      return { statusCode: 404, error: '远端文件不存在。' };
    }
    return { statusCode: 403, error: '远端拒绝读取该路径（权限不足或目标不可读）。' };
  }
  // 远端 sshd 未启用 sftp 子系统（`Subsystem sftp ...` 缺失 / 被禁用）：
  // 属远端环境能力缺失，重试无法恢复，也不是网关故障，故回 501 而非 500，
  // 并给出可操作建议（2026-10-12 线上排障命中：/ssh/files 曾被映射成 500）。
  if (error instanceof SshSftpUnavailableError || /unable to start subsystem/i.test(message)) {
    return { statusCode: 501, error: SSH_SFTP_UNAVAILABLE_MESSAGE };
  }
  // 未经归一的原始 SFTP 错误（注入实现 / 旧链路）：按 isRemoteNotFoundError
  // 的既有约定补齐裸 message 的归宿，避免「No such file / Permission denied /
  // Failure」这类单词文案落进 500。
  if (/no such file/i.test(message)) {
    return { statusCode: 404, error: '远端文件不存在。' };
  }
  if (/permission denied/i.test(message)) {
    return { statusCode: 403, error: '远端拒绝读取该路径（权限不足或目标不可读）。' };
  }
  if (/^failure$/i.test(message.trim())) {
    return {
      statusCode: 400,
      error:
        '远端拒绝读取该路径（SFTP 返回通用失败）：通常是目标是目录、缺少读权限或符号链接失效，请确认路径指向可读文件。',
    };
  }
  if (message.startsWith('SSH connection not found:')) {
    return { statusCode: 404, error: 'SSH 连接不存在。' };
  }
  if (message.startsWith('SSH client not connected:')) {
    return { statusCode: 409, error: 'SSH 连接尚未建立。' };
  }
  if (message.startsWith('SSH mkdir requires an absolute remote path')) {
    return { statusCode: 400, error: '远端目录路径必须是绝对路径（以 / 开头）。' };
  }
  if (message.startsWith('SSH mkdir path must not contain line breaks')) {
    return { statusCode: 400, error: '远端目录路径不能包含换行。' };
  }
  if (errno === 'ENOENT') {
    return { statusCode: 404, error: '远端文件不存在。' };
  }
  // SFTP 预览的内存守卫(见 ssh-connection-manager 的 stat-first 上限):属客户端可纠正的
  // 请求问题,应回 413 而非 500,便于 UI/模型区分「文件太大」与「网关故障」。
  if (message.startsWith('SSH file too large to preview')) {
    return { statusCode: 413, error: '远端文件过大,无法预览。' };
  }
  // SFTP 操作墙钟超时:语义上等同于上游超时,回 504。
  if (message.startsWith('SSH SFTP') && message.includes('timed out')) {
    return { statusCode: 504, error: 'SSH 操作超时,请稍后重试。' };
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
  fields?: Record<string, string | number | boolean>,
): FastifyReply {
  const classified = classifySshRouteError(error, actionLabel);
  if (classified.statusCode >= 500) {
    request.log.error({ err: error }, `ssh route failed: ${actionLabel}`);
  }
  // 失败路径也要把定位参数带进 workflow 日志：排障包只有 message 时
  // （如 SFTP 的裸 "Failure"）完全无法定位是哪条连接的哪个路径。
  step.fail(classified.error, fields);
  return reply.status(classified.statusCode).send({ error: classified.error });
}

function userId(request: FastifyRequest): string {
  return (request.user as JwtPayload).sub;
}

export async function sshRoutes(app: FastifyInstance): Promise<void> {
  app.put('/ssh/connections/:id/host-key', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.host-key.replace');
    const fingerprint = z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/);
    const input = parseBody(
      z.object({ expectedFingerprint: fingerprint, fingerprint }),
      request.body,
    );
    const connectionId = (request.params as { id: string }).id;
    if (!service().getConnection(userId(request), connectionId))
      return reply.code(404).send({ error: 'SSH 连接不存在。' });
    try {
      replaceSshHostKey({ userId: userId(request), connectionId, ...input });
      await service().disconnect(userId(request), connectionId);
      step.succeed();
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '更新 SSH 主机指纹', error);
    }
  });
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
        privateKey: parsed.privateKey ?? null,
        passphrase: parsed.passphrase ?? null,
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
      privateKeyPath: parsed.privateKeyPath,
      privateKey: parsed.privateKey,
      passphrase: parsed.passphrase,
      password: parsed.password,
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
    try {
      service().unbindSession(userId(request), parsed.sessionId);
      step.succeed(undefined, { sessionId: parsed.sessionId });
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '解绑 SSH 连接', error);
    }
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
      const entries = await service().listFiles(userId(request), parsed.connectionId, parsed.path);
      step.succeed(undefined, { count: entries.length });
      return reply.send({ entries });
    } catch (error) {
      return failSshRoute(request, reply, step, '读取 SSH 文件列表', error, {
        connectionId: parsed.connectionId,
        path: parsed.path,
      });
    }
  });

  app.get('/ssh/file', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.read');
    const parsed = parseQuery(fileQuerySchema, request.query);
    try {
      const preview = await service().readFile(userId(request), parsed.connectionId, parsed.path);
      step.succeed(undefined, { path: parsed.path });
      return reply.send({ preview });
    } catch (error) {
      return failSshRoute(request, reply, step, '读取 SSH 文件预览', error, {
        connectionId: parsed.connectionId,
        path: parsed.path,
      });
    }
  });

  app.post('/ssh/upload', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.upload');
    const parsed = parseBody(uploadSchema, request.body);
    const bytes = Uint8Array.from(Buffer.from(parsed.contentBase64, 'base64'));
    try {
      await service().writeFile(userId(request), parsed.connectionId, parsed.path, bytes);
      step.succeed(undefined, { bytes: bytes.length });
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '上传 SSH 文件', error, {
        connectionId: parsed.connectionId,
        path: parsed.path,
      });
    }
  });

  app.post('/ssh/mkdir', { onRequest: [requireAuth] }, async (request, reply) => {
    const { step } = startRequestWorkflow(request, 'ssh.file.mkdir');
    const parsed = parseBody(mkdirSchema, request.body);
    try {
      await service().mkdir(userId(request), parsed.connectionId, parsed.path);
      step.succeed(undefined, { path: parsed.path });
      return reply.send({ ok: true });
    } catch (error) {
      return failSshRoute(request, reply, step, '创建远端目录', error, {
        connectionId: parsed.connectionId,
        path: parsed.path,
      });
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
    const removed = service().deleteDialog(userId(request), (request.params as { id: string }).id);
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
    void import('../ssh/ssh-service.js').then((mod) => {
      mod.__resetSshServiceForTests(new mod.SshService());
    });
  },
};
