import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { WorkflowLogger } from '@openAwork/logger';
import { LSPManager } from '@openAwork/lsp-client';
import { z } from 'zod';
import { requireAuth } from '../auth.js';
import { getRequestWorkflow, startRequestWorkflow } from '../request-workflow.js';

const lspManager = new LSPManager({ autoInstall: true });

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

      const unsub = lspManager.onDiagnosticsUpdate((path, diagnostics) => {
        socket.send(JSON.stringify({ type: 'diagnostics', path, diagnostics }));
      });
      workflowLogger.succeed(subscribeStep);

      let finalized = false;
      const finalize = (statusCode: number, message?: string): void => {
        if (finalized) {
          return;
        }

        finalized = true;
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
