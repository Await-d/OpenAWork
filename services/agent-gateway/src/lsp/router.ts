import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WorkflowLogger } from '@openAwork/logger';
import { LSPManager } from '@openAwork/lsp-client';
import { z } from 'zod';
import { requireAuth } from '../infra/auth.js';
import { getRequestWorkflow, startRequestWorkflow } from '../runtime/request-workflow.js';

const lspManager = new LSPManager({ autoInstall: true });

/**
 * /lsp/events 是唯一持有模块级订阅（lspManager.onDiagnosticsUpdate → diagnosticHandlers
 * 数组）却此前缺少保活与 idle 看门狗的 WS 端点。拆订阅只挂在 TCP 'close' / 'error' 或
 * 「恰好有诊断推送且 send 抛错」上——但半开 / broken-pipe 的 socket 完全可能既不触发
 * 'close'，安静工作区里又长时间没有诊断推送来触发 send 失败，于是订阅永久滞留在模块级
 * 数组、活到进程退出，此后每次诊断 dispatch 都会扇出到死订阅。这与 team-events.ts 已确立
 * 的「WS 必须 ping 保活 + idle 超时主动拆除」模式不一致。这里对齐该模式。
 */
const DEFAULT_LSP_EVENTS_HEARTBEAT_INTERVAL_MS = 10_000;
const DEFAULT_LSP_EVENTS_IDLE_TIMEOUT_MS = 45_000;

function resolvePositiveEnvMs(envKey: string, fallback: number): number {
  const raw = globalThis.process?.env[envKey];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function lspEventsHeartbeatIntervalMs(): number {
  return resolvePositiveEnvMs(
    'OPENAWORK_LSP_EVENTS_HEARTBEAT_INTERVAL_MS',
    DEFAULT_LSP_EVENTS_HEARTBEAT_INTERVAL_MS,
  );
}

function lspEventsIdleTimeoutMs(): number {
  return resolvePositiveEnvMs(
    'OPENAWORK_LSP_EVENTS_IDLE_TIMEOUT_MS',
    DEFAULT_LSP_EVENTS_IDLE_TIMEOUT_MS,
  );
}

const touchSchema = z.object({
  path: z.string().min(1),
  waitForDiagnostics: z.boolean().optional().default(false),
  projectRoot: z.string().optional(),
});

export async function lspRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/lsp/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'lsp.status');
      const fetchStep = child('fetch');
      const status = await lspManager.status();
      const missing = lspManager.missingServers();
      fetchStep.succeed(undefined, {
        servers: status.length,
        missing: missing.filter((s) => !s.installed).length,
      });
      step.succeed(undefined, {
        servers: status.length,
        missing: missing.filter((s) => !s.installed).length,
      });
      return reply.send({ servers: status, missing });
    },
  );

  app.get(
    '/lsp/diagnostics',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'lsp.diagnostics');
      const fetchStep = child('fetch');
      const diagnostics = await lspManager.diagnostics();
      fetchStep.succeed(undefined, { files: Array.isArray(diagnostics) ? diagnostics.length : 0 });
      step.succeed(undefined, { files: Array.isArray(diagnostics) ? diagnostics.length : 0 });
      return reply.send({ diagnostics });
    },
  );

  app.post(
    '/lsp/touch',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step, child } = startRequestWorkflow(request, 'lsp.touch');

      const parseStep = child('parse-body');
      const body = touchSchema.safeParse(request.body);
      if (!body.success) {
        parseStep.fail('invalid input');
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      parseStep.succeed();

      const invokeStep = child('invoke', undefined, {
        waitForDiagnostics: body.data.waitForDiagnostics,
      });
      await lspManager.touchFile(body.data.path, body.data.waitForDiagnostics);
      invokeStep.succeed();
      step.succeed(undefined, { waitForDiagnostics: body.data.waitForDiagnostics });
      return reply.send({ ok: true });
    },
  );

  app.get(
    '/lsp/servers',
    { onRequest: [requireAuth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const servers = lspManager.missingServers();
      return reply.send({ servers });
    },
  );

  const installSchema = z.object({
    serverId: z.string().min(1),
  });

  app.post(
    '/lsp/install',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'lsp.install');
      const body = installSchema.safeParse(request.body);
      if (!body.success) {
        step.fail('invalid input');
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }
      const { serverId } = body.data;
      const success = await lspManager.ensureInstalled(serverId);
      step.succeed(undefined, { serverId, success });
      return reply.send({ serverId, installed: success });
    },
  );

  app.post(
    '/lsp/install-all',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'lsp.install-all');
      const results = await lspManager.ensureAllInstalled();
      const installedCount = Object.values(results).filter(Boolean).length;
      step.succeed(undefined, { installedCount, totalCount: Object.keys(results).length });
      return reply.send({ results });
    },
  );

  app.get(
    '/lsp/events',
    { websocket: true, onRequest: [requireAuth] },
    (socket: WebSocket, request: FastifyRequest) => {
      const { workflowContext: requestContext } = getRequestWorkflow(request);
      const workflowLogger = new WorkflowLogger();
      const workflowContext = {
        requestId: requestContext.requestId,
        method: 'WS',
        path: requestContext.path,
        ip: requestContext.ip,
        userAgent: requestContext.userAgent,
        startTime: Date.now(),
      };
      const socketStep = workflowLogger.start('lsp.events.socket');
      const subscribeStep = workflowLogger.startChild(socketStep, 'lsp.events.subscribe');

      let finalized = false;
      let lastActivityAt = Date.now();
      let heartbeat: NodeJS.Timeout | null = null;

      const touchActivity = (): void => {
        lastActivityAt = Date.now();
      };

      const unsub = lspManager.onDiagnosticsUpdate((path, diagnostics) => {
        // Never let a half-closed client socket throw back into the
        // diagnostics dispatch loop — that would abort delivery to other
        // subscribers and bubble into the LSP client's notification thread.
        if (!safeSendLspEvent(socket, { type: 'diagnostics', path, diagnostics })) {
          finalize(500, 'lsp.events.send-failed');
          return;
        }
        touchActivity();
      });
      workflowLogger.succeed(subscribeStep);

      const finalize = (statusCode: number, message?: string): void => {
        if (finalized) {
          return;
        }

        finalized = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        const unsubscribeStep = workflowLogger.startChild(socketStep, 'lsp.events.unsubscribe');
        unsub();
        workflowLogger.succeed(unsubscribeStep);
        if (message) {
          workflowLogger.fail(socketStep, message);
        } else {
          workflowLogger.succeed(socketStep);
        }
        workflowLogger.flush(workflowContext, statusCode);
      };

      const idleTimeoutMs = lspEventsIdleTimeoutMs();
      const heartbeatIntervalMs = lspEventsHeartbeatIntervalMs();
      // ping 保活 + idle 看门狗：半开 socket 即便不触发 'close'，也会在 idle 超时后被
      // 主动拆除，确保模块级诊断订阅不会泄漏到进程退出。
      heartbeat = setInterval(() => {
        if (finalized) {
          return;
        }
        if (Date.now() - lastActivityAt > idleTimeoutMs) {
          finalize(408, 'lsp.events.idle-timeout');
          safeCloseLspSocket(socket, 1001, 'LSP_EVENTS_IDLE_TIMEOUT');
          return;
        }
        try {
          socket.ping();
        } catch {
          finalize(500, 'lsp.events.ping-failed');
          safeCloseLspSocket(socket, 1011, 'LSP_EVENTS_PING_FAILED');
        }
      }, heartbeatIntervalMs);

      socket.on('message', () => {
        touchActivity();
      });

      socket.on('pong', () => {
        touchActivity();
      });

      socket.on('close', () => {
        finalize(101);
      });

      socket.on('error', (error: Error) => {
        const message = error.message;
        finalize(500, message);
      });
    },
  );
}

export { lspManager };

/**
 * Serialize + send a payload over the diagnostics WS, swallowing the
 * write error that occurs when the client has already disconnected.
 * Returns `false` so the caller can tear the subscription down instead
 * of letting the throw propagate into the shared diagnostics dispatch.
 */
function safeSendLspEvent(socket: WebSocket, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (_sendErr) {
    void _sendErr;
    return false;
  }
}

/**
 * Close the diagnostics WS, swallowing any throw from an already-dead
 * socket. Used by the idle watchdog / ping-failure path to actively tear
 * a half-open connection down instead of waiting for a 'close' that may
 * never arrive.
 */
function safeCloseLspSocket(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch (_closeErr) {
    void _closeErr;
  }
}
