import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { JwtPayload } from '../auth.js';
import { requireAuth } from '../auth.js';
import { sqliteGet } from '../db.js';
import {
  handleStreamRequest,
  loadSessionContext,
  stopStreamSchema,
  streamRequestSchema,
  createStreamErrorChunk,
} from './stream.js';
import { clearPendingTaskParentAutoResumesForSession } from '../task-parent-auto-resume.js';
import { stopInFlightStreamRequest } from './stream-cancellation.js';

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions/:id/stream/stop',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const body = stopStreamSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: 'Invalid input', issues: body.error.issues });
      }

      const sessionId = (request.params as { id: string }).id;
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        return reply.status(404).send({ error: 'Session not found' });
      }

      const stopped = await stopInFlightStreamRequest({
        clientRequestId: body.data.clientRequestId,
        sessionId,
        userId: user.sub,
      });
      if (stopped) {
        clearPendingTaskParentAutoResumesForSession({ sessionId, userId: user.sub });
      }
      return reply.status(200).send({ stopped });
    },
  );

  app.get(
    '/sessions/:id/stream',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const connectionLogger = new WorkflowLogger();
      const connectionContext = createRequestContext(
        'WS',
        `/sessions/${(request.params as { id: string }).id}/stream`,
        request.headers as Record<string, string | string[] | undefined>,
        request.ip,
      );
      const connectionStep = connectionLogger.start('stream.socket.connect');
      const authStep = connectionLogger.startChild(connectionStep, 'stream.socket.auth');
      const queryToken = (request.query as Record<string, string>)['token'];
      let user: JwtPayload | null = null;
      if (queryToken) {
        try {
          user = request.server.jwt.verify<JwtPayload>(queryToken);
        } catch {
          connectionLogger.fail(authStep, 'unauthorized');
          connectionLogger.fail(connectionStep, 'unauthorized');
          connectionLogger.flush(connectionContext, 401);
          socket.send(
            JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' }),
          );
          socket.close(1008);
          return;
        }
      } else {
        connectionLogger.fail(authStep, 'unauthorized');
        connectionLogger.fail(connectionStep, 'unauthorized');
        connectionLogger.flush(connectionContext, 401);
        socket.send(
          JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Unauthorized' }),
        );
        socket.close(1008);
        return;
      }
      connectionLogger.succeed(authStep);
      const { id: sessionId } = request.params as { id: string };

      const sessionStep = connectionLogger.startChild(
        connectionStep,
        'stream.socket.session-check',
        undefined,
        { sessionId },
      );
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        connectionLogger.fail(sessionStep, 'session not found');
        connectionLogger.fail(connectionStep, 'session not found');
        connectionLogger.flush(connectionContext, 404);
        socket.send(
          JSON.stringify({
            type: 'error',
            code: 'SESSION_NOT_FOUND',
            message: 'Session not found',
          }),
        );
        socket.close(1008);
        return;
      }
      connectionLogger.succeed(sessionStep);
      connectionLogger.succeed(connectionStep, undefined, { sessionId });
      connectionLogger.flush(connectionContext, 101);

      socket.on('message', (raw: Buffer | string) => {
        void (async () => {
          const requestRunId = randomUUID();
          const wl = new WorkflowLogger();
          const ctx = createRequestContext(
            'WS',
            `/sessions/${sessionId}/stream`,
            request.headers as Record<string, string | string[] | undefined>,
            request.ip,
          );

          const text = raw.toString();
          let parsed: unknown;
          const stepRoute = wl.start('stream.message.handle', undefined, { sessionId });
          const stepParse = wl.startChild(stepRoute, 'stream.parse');
          try {
            parsed = JSON.parse(text);
          } catch {
            wl.fail(stepParse, 'invalid JSON');
            wl.fail(stepRoute, 'invalid JSON');
            wl.flush(ctx, 400);
            socket.send(
              JSON.stringify(createStreamErrorChunk('INVALID_JSON', 'Invalid JSON', requestRunId)),
            );
            return;
          }

          const body = streamRequestSchema.safeParse(parsed);
          if (!body.success) {
            wl.fail(stepParse, 'invalid request schema');
            wl.fail(stepRoute, 'invalid request schema');
            wl.flush(ctx, 400);
            socket.send(
              JSON.stringify({
                ...createStreamErrorChunk('INVALID_REQUEST', 'Invalid request', requestRunId),
                issues: body.error.issues,
              }),
            );
            return;
          }
          wl.succeed(stepParse);

          const stepSession = wl.startChild(stepRoute, 'stream.session-check', undefined, {
            sessionId,
          });

          const sessionContext = loadSessionContext(sessionId, user.sub);
          if (!sessionContext) {
            wl.fail(stepSession, 'session not found');
            wl.fail(stepRoute, 'session not found');
            wl.flush(ctx, 404);
            socket.send(
              JSON.stringify({
                type: 'error',
                code: 'SESSION_NOT_FOUND',
                message: 'Session not found',
              }),
            );
            return;
          }
          wl.succeed(stepSession);

          try {
            const streamResult = await handleStreamRequest({
              method: 'WS',
              path: `/sessions/${sessionId}/stream`,
              headers: request.headers as Record<string, string | string[] | undefined>,
              ip: request.ip,
              requestData: body.data,
              sessionContext,
              sessionId,
              transport: 'WS',
              user,
              writeChunk: (chunk) => {
                socket.send(JSON.stringify(chunk));
              },
            });
            if (streamResult.statusCode >= 400) {
              wl.fail(stepRoute, 'stream request completed with error status', {
                sessionId,
                clientRequestId: body.data.clientRequestId,
                statusCode: streamResult.statusCode,
              });
              wl.flush(ctx, streamResult.statusCode);
            } else {
              wl.succeed(stepRoute, undefined, {
                sessionId,
                clientRequestId: body.data.clientRequestId,
              });
              wl.flush(ctx, streamResult.statusCode);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            wl.fail(stepRoute, message, {
              sessionId,
              clientRequestId: body.data.clientRequestId,
            });
            wl.flush(ctx, 500);
          }
        })();
      });
    },
  );

  app.get('/sessions/:id/stream/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    const wl = new WorkflowLogger();
    const ctx = createRequestContext(
      request.method,
      request.url,
      request.headers as Record<string, string | string[] | undefined>,
      request.ip,
    );
    const routeStep = wl.start('stream.sse.connect');
    const authStep = wl.startChild(routeStep, 'stream.sse.auth');
    const rawQuery = request.query as Record<string, string>;
    const sseToken = rawQuery['token'];
    let user: JwtPayload;
    try {
      user = request.server.jwt.verify<JwtPayload>(sseToken ?? '');
    } catch {
      wl.fail(authStep, 'unauthorized');
      wl.fail(routeStep, 'unauthorized');
      wl.flush(ctx, 401);
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    wl.succeed(authStep);
    const { id: sessionId } = request.params as { id: string };
    const parseStep = wl.startChild(routeStep, 'stream.sse.parse-query', undefined, { sessionId });
    const query = streamRequestSchema.safeParse(request.query);

    if (!query.success) {
      wl.fail(parseStep, 'invalid query');
      wl.fail(routeStep, 'invalid query');
      wl.flush(ctx, 400);
      return reply.status(400).send({ error: 'Invalid query', issues: query.error.issues });
    }
    wl.succeed(parseStep);

    const stepSession = wl.startChild(routeStep, 'stream.sse.session-check', undefined, {
      sessionId,
    });
    const sessionContext = loadSessionContext(sessionId, user.sub);
    if (!sessionContext) {
      wl.fail(stepSession, 'session not found');
      wl.fail(routeStep, 'session not found');
      wl.flush(ctx, 404);
      return reply.status(404).send({ error: 'Session not found' });
    }
    wl.succeed(stepSession);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    try {
      const streamResult = await handleStreamRequest({
        method: request.method,
        path: request.url,
        headers: request.headers as Record<string, string | string[] | undefined>,
        ip: request.ip,
        requestData: query.data,
        sessionContext,
        sessionId,
        transport: 'SSE',
        user,
        writeChunk: (chunk) => {
          reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
        },
      });
      if (streamResult.statusCode >= 400) {
        wl.fail(routeStep, 'stream request completed with error status', {
          sessionId,
          statusCode: streamResult.statusCode,
        });
        wl.flush(ctx, streamResult.statusCode);
      } else {
        wl.succeed(routeStep, undefined, { sessionId });
        wl.flush(ctx, streamResult.statusCode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      wl.fail(routeStep, message);
      wl.flush(ctx, 500);
      throw error;
    } finally {
      reply.raw.end();
    }
  });
}
