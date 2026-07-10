import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RunEvent } from '@openAwork/shared';
import type { WebSocket } from '@fastify/websocket';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { sqliteGet } from '../infra/db.js';
import { writeAuditLog } from '../infra/audit-log.js';
import {
  handleStreamRequest,
  loadSessionContext,
  stopStreamSchema,
  streamRequestSchema,
  createStreamErrorChunk,
} from './stream.js';
import { buildRunEventEnvelope, deriveRunEventBookend } from '../session/run-event-envelope.js';
import {
  getRunEventRunId,
  getLatestSessionRunEventSeqByRequest,
  listRecentSessionRunEventsWithMeta,
  listSessionRunEventsByRequest,
  listSessionRunEventsByRequestAfterSeq,
  subscribeSessionRunEvents,
  type PublishRunEventMeta,
} from '../session/session-run-events.js';
import { getFreshSessionRuntimeThread } from '../session/session-runtime-thread-store.js';
import { clearPendingTaskParentAutoResumesForSession } from '../task/task-parent-auto-resume.js';
import {
  stopAnyInFlightStreamRequestForSession,
  stopInFlightStreamRequest,
} from './stream-cancellation.js';
import { installWsHeartbeat } from './ws-heartbeat.js';

export const STREAM_PLUGIN_ERROR_MESSAGES = {
  invalidJson: '请求数据不是合法 JSON。',
  invalidRequest: '请求参数无效。',
  requestedStreamInactive: '请求的流已不再处于活动状态。',
  sseClientDisconnected: '客户端在流式传输过程中断开 SSE 连接。',
  wsStreamError: 'WebSocket 流式响应处理中断，请稍后重试。',
  sseStreamError: 'SSE 流式响应处理中断，请稍后重试。',
} as const;

const streamAttachQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  clientRequestId: z.string().trim().min(1),
  token: z.string().trim().min(1),
});

/**
 * Multi-attach schema: does NOT require clientRequestId.
 * Auto-discovers the session's active runtime thread and subscribes to ALL
 * run events for that session, regardless of which clientRequestId produced them.
 * Used by the team multi-session SSE manager to stream every running layer's
 * output in real time.
 */
const streamMultiAttachQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).default(0),
  token: z.string().trim().min(1),
});

function parseSseCursorFromLastEventId(
  lastEventId: string | undefined,
  clientRequestId: string,
): number | null {
  if (!lastEventId) {
    return null;
  }

  const separatorIndex = lastEventId.lastIndexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  const rawRequestId = lastEventId.slice(0, separatorIndex);
  const rawSeq = lastEventId.slice(separatorIndex + 1);
  if (rawRequestId !== clientRequestId) {
    return null;
  }

  const parsedSeq = Number.parseInt(rawSeq, 10);
  return Number.isFinite(parsedSeq) && parsedSeq >= 0 ? parsedSeq : null;
}

function writeSseRunEnvelope(
  reply: FastifyReply,
  envelope: ReturnType<typeof buildRunEventEnvelope>,
): boolean {
  const requestId = envelope.payload.cursor?.clientRequestId ?? envelope.payload.clientRequestId;
  const lastEventId = requestId ? `${requestId}:${envelope.seq}` : String(envelope.seq);
  return (
    safeWriteReplyRaw(reply, `id: ${lastEventId}\n`) &&
    safeWriteReplyRaw(reply, `data: ${JSON.stringify(envelope)}\n\n`)
  );
}

function buildAttachRunEnvelope(input: { clientRequestId: string; event: RunEvent; seq: number }) {
  return buildRunEventEnvelope({
    aggregateId: getRunEventRunId(input.event) ?? input.clientRequestId,
    aggregateType: 'run',
    clientRequestId: input.clientRequestId,
    cursor: {
      clientRequestId: input.clientRequestId,
      seq: input.seq,
    },
    event: input.event,
    outputOffset: input.seq,
    seq: input.seq,
    timestamp: input.event.occurredAt ?? Date.now(),
  });
}

/**
 * Build an SSE envelope for multi-attach. Unlike buildAttachRunEnvelope, this
 * does not require a known clientRequestId — it uses whatever meta is available
 * from the event, or falls back to a synthetic id. The seq is the global
 * per-session row id (not per-clientRequestId), which is what the multi-attach
 * subscriber receives.
 */
function buildMultiAttachRunEnvelope(input: {
  event: RunEvent;
  seq: number;
  clientRequestId?: string;
}) {
  const clientRequestId = input.clientRequestId ?? getRunEventRunId(input.event) ?? 'multi-attach';
  return buildRunEventEnvelope({
    aggregateId: getRunEventRunId(input.event) ?? clientRequestId,
    aggregateType: 'run',
    clientRequestId,
    cursor: {
      clientRequestId,
      seq: input.seq,
    },
    event: input.event,
    outputOffset: input.seq,
    seq: input.seq,
    timestamp: input.event.occurredAt ?? Date.now(),
  });
}

export async function streamRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/sessions/:id/stream/stop',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const body = stopStreamSchema.safeParse(request.body);
      if (!body.success) {
        return reply.status(400).send({ error: '请求参数无效。', issues: body.error.issues });
      }

      const sessionId = (request.params as { id: string }).id;
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        return reply.status(404).send({ error: '目标会话不存在。' });
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
    '/sessions/:id/stream/active',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { id: string }).id;
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const activeThread = getFreshSessionRuntimeThread({ sessionId, userId: user.sub });
      if (!activeThread) {
        return reply.status(200).send({ active: null });
      }

      return reply.status(200).send({
        active: {
          clientRequestId: activeThread.clientRequestId,
          heartbeatAtMs: activeThread.heartbeatAtMs,
          lastSeq: getLatestSessionRunEventSeqByRequest({
            sessionId,
            clientRequestId: activeThread.clientRequestId,
          }),
          sessionId: activeThread.sessionId,
          startedAtMs: activeThread.startedAtMs,
        },
      });
    },
  );

  app.post(
    '/sessions/:id/stream/stop-active',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;
      const sessionId = (request.params as { id: string }).id;
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        return reply.status(404).send({ error: '目标会话不存在。' });
      }

      const stopped = await stopAnyInFlightStreamRequestForSession({
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
        request.headers,
        request.ip,
      );
      const connectionStep = connectionLogger.start('stream.socket.connect');
      const authStep = connectionLogger.startChild(connectionStep, 'stream.socket.auth');
      const queryToken = (request.query as Record<string, string>)['token'];
      const authHeader = request.headers['authorization'];
      const headerToken =
        typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
          ? authHeader.slice('Bearer '.length).trim()
          : undefined;
      const authToken = headerToken || queryToken;
      let user: JwtPayload | null = null;
      if (authToken) {
        try {
          user = request.server.jwt.verify<JwtPayload>(authToken);
        } catch {
          connectionLogger.fail(authStep, 'unauthorized');
          connectionLogger.fail(connectionStep, 'unauthorized');
          connectionLogger.flush(connectionContext, 401);
          safeSendWs(socket, {
            type: 'error',
            code: 'UNAUTHORIZED',
            message: '未授权或登录已失效。',
          });
          safeCloseWs(socket, 1008);
          return;
        }
      } else {
        connectionLogger.fail(authStep, 'unauthorized');
        connectionLogger.fail(connectionStep, 'unauthorized');
        connectionLogger.flush(connectionContext, 401);
        safeSendWs(socket, {
          type: 'error',
          code: 'UNAUTHORIZED',
          message: '未授权或登录已失效。',
        });
        safeCloseWs(socket, 1008);
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
        safeSendWs(socket, {
          type: 'error',
          code: 'SESSION_NOT_FOUND',
          message: '目标会话不存在。',
        });
        safeCloseWs(socket, 1008);
        return;
      }
      connectionLogger.succeed(sessionStep);
      connectionLogger.succeed(connectionStep, undefined, { sessionId });
      connectionLogger.flush(connectionContext, 101);

      // Track socket close state so safeWriteChunk stops writing to the
      // closed socket. We intentionally do NOT abort in-flight stream
      // executions — they continue running in the background so all events
      // are persisted. The client can reconnect via the attach endpoint.
      let socketClosed = false;
      // Liveness probe: a half-open WS (peer vanished without a FIN — sleep,
      // NAT timeout, network partition) never fires 'close', so without this
      // the socket + its run-event subscription would linger for the process
      // lifetime. The probe terminates a peer that stops answering pongs,
      // which then triggers the normal 'close' teardown below.
      const stopHeartbeat = installWsHeartbeat(socket);
      socket.on('close', () => {
        stopHeartbeat();
        if (socketClosed) return;
        socketClosed = true;
        console.log(
          '[WS_CLOSE] socket closed for session',
          sessionId,
          '— stream continues in background',
        );
      });

      socket.on('message', (raw: Buffer | string) => {
        void (async () => {
          const requestRunId = randomUUID();
          const wl = new WorkflowLogger();
          const ctx = createRequestContext(
            'WS',
            `/sessions/${sessionId}/stream`,
            request.headers,
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
            safeSendWs(
              socket,
              createStreamErrorChunk(
                'INVALID_JSON',
                STREAM_PLUGIN_ERROR_MESSAGES.invalidJson,
                requestRunId,
              ),
            );
            return;
          }

          // §0.153: application-level liveness ping. The client stream probe
          // sends `{type:'ping'}` on an interval to detect a half-open socket
          // (server vanished without a FIN — sleep / NAT / partition); answer
          // with `pong` so a healthy-but-quiet turn (a long tool run emitting
          // no chunks) keeps the client's watchdog primed and is NOT torn down.
          // Handled before `streamRequestSchema.safeParse` so a ping is never
          // misclassified as an INVALID_REQUEST. A stray `pong` is ignored.
          if (parsed && typeof parsed === 'object') {
            const ctrl = (parsed as { type?: unknown }).type;
            if (ctrl === 'ping') {
              wl.succeed(stepParse);
              wl.succeed(stepRoute, undefined, { control: 'ping' });
              safeSendWs(socket, { type: 'pong', timestamp: Date.now() });
              return;
            }
            if (ctrl === 'pong') {
              wl.succeed(stepParse);
              wl.succeed(stepRoute, undefined, { control: 'pong' });
              return;
            }
          }

          const body = streamRequestSchema.safeParse(parsed);
          if (!body.success) {
            wl.fail(stepParse, 'invalid request schema');
            wl.fail(stepRoute, 'invalid request schema');
            wl.flush(ctx, 400);
            safeSendWs(socket, {
              ...createStreamErrorChunk(
                'INVALID_REQUEST',
                STREAM_PLUGIN_ERROR_MESSAGES.invalidRequest,
                requestRunId,
              ),
              issues: body.error.issues,
            });
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
            safeSendWs(socket, {
              type: 'error',
              code: 'SESSION_NOT_FOUND',
              message: '目标会话不存在。',
            });
            return;
          }
          wl.succeed(stepSession);

          if (socketClosed) {
            return;
          }

          // ws library: readyState 1 === OPEN. Skip writes once the socket has
          // started closing so we don't throw and bring down the message handler.
          const safeWriteChunk = (chunk: RunEvent) => {
            if (socketClosed || socket.readyState !== 1) return;
            if (!safeSendWs(socket, chunk)) {
              // Mark socket as gone so subsequent writes are skipped.
              socketClosed = true;
            }
          };

          try {
            const streamResult = await handleStreamRequest({
              method: 'WS',
              path: `/sessions/${sessionId}/stream`,
              headers: request.headers,
              ip: request.ip,
              requestData: body.data,
              sessionContext,
              sessionId,
              transport: 'WS',
              user,
              writeChunk: safeWriteChunk,
            });
            if (streamResult.statusCode >= 400) {
              wl.fail(stepRoute, 'stream request completed with error status', {
                agentId: body.data.agentId ?? 'none',
                sessionId,
                clientRequestId: body.data.clientRequestId,
                statusCode: streamResult.statusCode,
              });
              wl.flush(ctx, streamResult.statusCode);
            } else {
              wl.succeed(stepRoute, undefined, {
                agentId: body.data.agentId ?? 'none',
                sessionId,
                clientRequestId: body.data.clientRequestId,
              });
              wl.flush(ctx, streamResult.statusCode);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            wl.fail(stepRoute, message, {
              agentId: body.data.agentId ?? 'none',
              sessionId,
              clientRequestId: body.data.clientRequestId,
            });
            writeAuditLog({
              sessionId,
              category: 'route',
              sourceName: 'WS_STREAM_ERROR',
              requestId: body.data.clientRequestId,
              output: {
                message: STREAM_PLUGIN_ERROR_MESSAGES.wsStreamError,
                code: 'WS_STREAM_ERROR',
                technicalDetail: message,
              },
            });
            safeWriteChunk(
              createStreamErrorChunk(
                'WS_STREAM_ERROR',
                STREAM_PLUGIN_ERROR_MESSAGES.wsStreamError,
                requestRunId,
              ),
            );
            wl.flush(ctx, 500);
          }
        })();
      });
    },
  );

  app.get('/sessions/:id/stream/sse', async (request: FastifyRequest, reply: FastifyReply) => {
    const wl = new WorkflowLogger();
    const ctx = createRequestContext(request.method, request.url, request.headers, request.ip);
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
      return reply.status(401).send({ error: '未授权或登录已失效。' });
    }
    wl.succeed(authStep);
    const { id: sessionId } = request.params as { id: string };
    const parseStep = wl.startChild(routeStep, 'stream.sse.parse-query', undefined, { sessionId });
    const query = streamRequestSchema.safeParse(request.query);

    if (!query.success) {
      wl.fail(parseStep, 'invalid query');
      wl.fail(routeStep, 'invalid query');
      wl.flush(ctx, 400);
      return reply.status(400).send({ error: '查询参数无效。', issues: query.error.issues });
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
      return reply.status(404).send({ error: '目标会话不存在。' });
    }
    wl.succeed(stepSession);

    // Track client disconnect so safeWriteChunk stops writing to the
    // closed socket. We intentionally do NOT abort the in-flight stream
    // execution — it continues running in the background so all events
    // are persisted. The client can reconnect via the attach endpoint
    // after a page refresh or session switch. Explicit stop requests
    // still work through stopInFlightStreamRequest.
    let clientClosed = false;
    let streamingStarted = false;
    const onClientClose = () => {
      if (clientClosed) return;
      clientClosed = true;
      if (streamingStarted) {
        writeAuditLog({
          sessionId,
          category: 'route',
          sourceName: 'SSE_CLIENT_DISCONNECTED',
          requestId: query.data.clientRequestId,
          output: {
            code: 'SSE_CLIENT_DISCONNECTED',
            message: STREAM_PLUGIN_ERROR_MESSAGES.sseClientDisconnected,
          },
        });
      }
    };
    request.raw.on('close', onClientClose);

    const requestOrigin = request.headers['origin'] ?? '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': requestOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    streamingStarted = true;

    // Heartbeat keeps proxies (nginx/Cloudflare/dev) from silently dropping the
    // connection during long thinking phases where no chunks are emitted.
    const heartbeat = setInterval(() => {
      if (clientClosed) return;
      if (!safeWriteReplyRaw(reply, ': keepalive\n\n')) {
        onClientClose();
      }
    }, 10_000);

    const safeWriteChunk = (chunk: RunEvent) => {
      if (clientClosed) return;
      if (!safeWriteReplyRaw(reply, `data: ${JSON.stringify(chunk)}\n\n`)) {
        // Mark client as gone so subsequent writes are skipped.
        onClientClose();
      }
    };

    try {
      const streamResult = await handleStreamRequest({
        method: request.method,
        path: request.url,
        headers: request.headers,
        ip: request.ip,
        requestData: query.data,
        sessionContext,
        sessionId,
        transport: 'SSE',
        user,
        writeChunk: safeWriteChunk,
      });
      if (streamResult.statusCode >= 400) {
        wl.fail(routeStep, 'stream request completed with error status', {
          agentId: query.data.agentId ?? 'none',
          clientRequestId: query.data.clientRequestId,
          sessionId,
          statusCode: streamResult.statusCode,
        });
        wl.flush(ctx, streamResult.statusCode);
      } else {
        wl.succeed(routeStep, undefined, {
          agentId: query.data.agentId ?? 'none',
          clientRequestId: query.data.clientRequestId,
          sessionId,
        });
        wl.flush(ctx, streamResult.statusCode);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      wl.fail(routeStep, message, {
        agentId: query.data.agentId ?? 'none',
        clientRequestId: query.data.clientRequestId,
        sessionId,
      });
      writeAuditLog({
        sessionId,
        category: 'route',
        sourceName: 'SSE_STREAM_ERROR',
        requestId: query.data.clientRequestId,
        output: {
          message: STREAM_PLUGIN_ERROR_MESSAGES.sseStreamError,
          code: 'SSE_STREAM_ERROR',
          technicalDetail: message,
        },
      });
      safeWriteChunk(
        createStreamErrorChunk(
          'SSE_STREAM_ERROR',
          STREAM_PLUGIN_ERROR_MESSAGES.sseStreamError,
          randomUUID(),
        ),
      );
      wl.flush(ctx, 500);
    } finally {
      clearInterval(heartbeat);
      request.raw.off('close', onClientClose);
      safeEndReplyRaw(reply);
    }
  });

  app.get('/sessions/:id/stream/attach', async (request: FastifyRequest, reply: FastifyReply) => {
    const wl = new WorkflowLogger();
    const ctx = createRequestContext(request.method, request.url, request.headers, request.ip);
    const routeStep = wl.start('stream.attach.connect');
    const authStep = wl.startChild(routeStep, 'stream.attach.auth');
    const rawQuery = request.query as Record<string, string>;
    const attachToken = rawQuery['token'];
    let user: JwtPayload;
    try {
      user = request.server.jwt.verify<JwtPayload>(attachToken ?? '');
    } catch {
      wl.fail(authStep, 'unauthorized');
      wl.fail(routeStep, 'unauthorized');
      wl.flush(ctx, 401);
      return reply.status(401).send({ error: '未授权或登录已失效。' });
    }
    wl.succeed(authStep);

    const { id: sessionId } = request.params as { id: string };
    const parseStep = wl.startChild(routeStep, 'stream.attach.parse-query', undefined, {
      sessionId,
    });
    const query = streamAttachQuerySchema.safeParse(request.query);
    if (!query.success) {
      wl.fail(parseStep, 'invalid query');
      wl.fail(routeStep, 'invalid query');
      wl.flush(ctx, 400);
      return reply.status(400).send({ error: '查询参数无效。', issues: query.error.issues });
    }
    wl.succeed(parseStep);

    const sessionStep = wl.startChild(routeStep, 'stream.attach.session-check', undefined, {
      sessionId,
    });
    const sessionRow = sqliteGet<{ id: string }>(
      'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
      [sessionId, user.sub],
    );
    if (!sessionRow) {
      wl.fail(sessionStep, 'session not found');
      wl.fail(routeStep, 'session not found');
      wl.flush(ctx, 404);
      return reply.status(404).send({ error: '目标会话不存在。' });
    }
    wl.succeed(sessionStep);

    const currentActiveThread = getFreshSessionRuntimeThread({ sessionId, userId: user.sub });
    const requestedEvents = listSessionRunEventsByRequest({
      sessionId,
      clientRequestId: query.data.clientRequestId,
    });
    const latestRequestedEvent = requestedEvents.at(-1);
    const latestRequestedBookend = latestRequestedEvent
      ? deriveRunEventBookend(latestRequestedEvent)
      : undefined;
    const isRequestedRequestActive =
      currentActiveThread?.clientRequestId === query.data.clientRequestId;
    const canReplayRequestedRequestToTerminal = latestRequestedBookend?.terminal === true;

    if (!isRequestedRequestActive && !canReplayRequestedRequestToTerminal) {
      wl.fail(routeStep, 'attach request mismatch', {
        activeClientRequestId: currentActiveThread?.clientRequestId ?? 'none',
        requestedClientRequestId: query.data.clientRequestId,
        sessionId,
      });
      wl.flush(ctx, 409);
      return reply.status(409).send({
        activeClientRequestId: currentActiveThread?.clientRequestId ?? null,
        error: STREAM_PLUGIN_ERROR_MESSAGES.requestedStreamInactive,
      });
    }

    const afterSeq =
      parseSseCursorFromLastEventId(
        request.headers['last-event-id'] as string | undefined,
        query.data.clientRequestId,
      ) ?? query.data.afterSeq;

    const attachOrigin = request.headers['origin'] ?? '*';
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': attachOrigin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    if (!safeWriteReplyRaw(reply, 'retry: 1000\n\n')) {
      safeEndReplyRaw(reply);
      return;
    }

    if (!isRequestedRequestActive) {
      const replayEvents = listSessionRunEventsByRequestAfterSeq({
        sessionId,
        clientRequestId: query.data.clientRequestId,
        afterSeq,
      });
      for (const replayEvent of replayEvents) {
        const delivered = writeSseRunEnvelope(
          reply,
          buildAttachRunEnvelope({
            clientRequestId: query.data.clientRequestId,
            event: replayEvent.event,
            seq: replayEvent.seq,
          }),
        );
        if (!delivered) {
          safeEndReplyRaw(reply);
          return;
        }
      }

      wl.succeed(routeStep, undefined, {
        attached: false,
        clientRequestId: query.data.clientRequestId,
        replayedCount: replayEvents.length,
        sessionId,
      });
      wl.flush(ctx, 200);
      safeEndReplyRaw(reply);
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let lastSeq = afterSeq;
      let replayCompleted = false;
      const pendingLiveEvents: Array<{ event: RunEvent; seq: number }> = [];
      let replayedCount = 0;
      const noopUnsubscribe: () => void = () => undefined;
      let unsubscribe: () => void = noopUnsubscribe;

      const deliverEvent = (event: RunEvent, seq: number) => {
        if (settled || seq <= lastSeq) {
          return;
        }
        const delivered = writeSseRunEnvelope(
          reply,
          buildAttachRunEnvelope({
            clientRequestId: query.data.clientRequestId,
            event,
            seq,
          }),
        );
        if (!delivered) {
          cleanup();
          return;
        }
        lastSeq = seq;
        if (deriveRunEventBookend(event)?.terminal === true) {
          cleanup();
        }
      };

      let heartbeat: NodeJS.Timeout | null = null;
      const cleanup = () => {
        if (settled) {
          return;
        }
        settled = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        unsubscribe();
        request.raw.off('close', cleanup);
        safeEndReplyRaw(reply);
        resolve();
      };
      heartbeat = setInterval(() => {
        if (!safeWriteReplyRaw(reply, ': keepalive\n\n')) {
          cleanup();
        }
      }, 10_000);
      unsubscribe = subscribeSessionRunEvents(sessionId, (event, meta?: PublishRunEventMeta) => {
        if (meta?.clientRequestId !== query.data.clientRequestId || typeof meta.seq !== 'number') {
          return;
        }
        if (meta.seq <= lastSeq) {
          return;
        }

        if (!replayCompleted) {
          pendingLiveEvents.push({ event, seq: meta.seq });
          return;
        }

        deliverEvent(event, meta.seq);
      });

      request.raw.on('close', cleanup);

      const replayEvents = listSessionRunEventsByRequestAfterSeq({
        sessionId,
        clientRequestId: query.data.clientRequestId,
        afterSeq,
      });
      replayedCount = replayEvents.length;
      for (const replayEvent of replayEvents) {
        deliverEvent(replayEvent.event, replayEvent.seq);
      }

      replayCompleted = true;
      pendingLiveEvents.sort((left, right) => left.seq - right.seq);
      for (const pendingEvent of pendingLiveEvents) {
        deliverEvent(pendingEvent.event, pendingEvent.seq);
      }

      if (!settled) {
        wl.succeed(routeStep, undefined, {
          attached: true,
          clientRequestId: query.data.clientRequestId,
          replayedCount,
          sessionId,
        });
        wl.flush(ctx, 200);
      }
    });
  });

  // ─── Multi-Attach SSE endpoint ─────────────────────────────────────
  // Like /sessions/:id/stream/attach, but does NOT require clientRequestId.
  // Auto-discovers the session's active runtime thread, replays recent events
  // (all clientRequestIds), then subscribes to ALL live run events for this
  // session. Used by the team multi-session SSE manager to stream every
  // running layer's output in real time without knowing each layer's
  // clientRequestId in advance.
  app.get(
    '/sessions/:id/stream/multi-attach',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const wl = new WorkflowLogger();
      const ctx = createRequestContext(request.method, request.url, request.headers, request.ip);
      const routeStep = wl.start('stream.multi-attach.connect');
      const authStep = wl.startChild(routeStep, 'stream.multi-attach.auth');
      const rawQuery = request.query as Record<string, string>;
      const multiAttachToken = rawQuery['token'];
      let user: JwtPayload;
      try {
        user = request.server.jwt.verify<JwtPayload>(multiAttachToken ?? '');
      } catch {
        wl.fail(authStep, 'unauthorized');
        wl.fail(routeStep, 'unauthorized');
        wl.flush(ctx, 401);
        return reply.status(401).send({ error: '未授权或登录已失效。' });
      }
      wl.succeed(authStep);

      const { id: sessionId } = request.params as { id: string };
      const parseStep = wl.startChild(routeStep, 'stream.multi-attach.parse-query', undefined, {
        sessionId,
      });
      const query = streamMultiAttachQuerySchema.safeParse(request.query);
      if (!query.success) {
        wl.fail(parseStep, 'invalid query');
        wl.fail(routeStep, 'invalid query');
        wl.flush(ctx, 400);
        return reply.status(400).send({ error: '查询参数无效。', issues: query.error.issues });
      }
      wl.succeed(parseStep);

      const sessionStep = wl.startChild(routeStep, 'stream.multi-attach.session-check', undefined, {
        sessionId,
      });
      const sessionRow = sqliteGet<{ id: string }>(
        'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
        [sessionId, user.sub],
      );
      if (!sessionRow) {
        wl.fail(sessionStep, 'session not found');
        wl.fail(routeStep, 'session not found');
        wl.flush(ctx, 404);
        return reply.status(404).send({ error: '目标会话不存在。' });
      }
      wl.succeed(sessionStep);

      // Check if there's an active runtime thread (stream is live right now).
      const currentActiveThread = getFreshSessionRuntimeThread({
        sessionId,
        userId: user.sub,
      });

      const attachOrigin = request.headers['origin'] ?? '*';
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': attachOrigin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      });
      if (!safeWriteReplyRaw(reply, 'retry: 1000\n\n')) {
        safeEndReplyRaw(reply);
        return;
      }

      // Write the active stream metadata as the first event so the client
      // knows whether the session is currently streaming.
      if (
        !safeWriteReplyRaw(
          reply,
          `data: ${JSON.stringify({
            type: 'multi-attach:status',
            sessionId,
            activeClientRequestId: currentActiveThread?.clientRequestId ?? null,
          })}\n\n`,
        )
      ) {
        safeEndReplyRaw(reply);
        return;
      }

      await new Promise<void>((resolve) => {
        let settled = false;
        let lastRowId = query.data.afterSeq;
        let replayCompleted = false;
        const pendingLiveEvents: Array<{
          event: RunEvent;
          rowId: number;
          clientRequestId?: string;
        }> = [];
        const noopUnsubscribe: () => void = () => undefined;
        let unsubscribe: () => void = noopUnsubscribe;

        const deliverEvent = (event: RunEvent, rowId: number, clientRequestId?: string) => {
          if (settled || rowId <= lastRowId) {
            return;
          }
          const delivered = safeWriteReplyRaw(
            reply,
            `id: ${rowId}\ndata: ${JSON.stringify(
              buildMultiAttachRunEnvelope({ event, seq: rowId, clientRequestId }),
            )}\n\n`,
          );
          if (!delivered) {
            cleanup();
            return;
          }
          lastRowId = rowId;
          // P1-1/P1-2 fix: Do NOT close on terminal events. The session may
          // start a new round (e.g. next handoff in a chain). Instead, keep
          // the connection open and let the client decide when to disconnect.
          // The client closes the EventSource when the session leaves 'running'.
        };

        let heartbeat: NodeJS.Timeout | null = null;
        const cleanup = () => {
          if (settled) {
            return;
          }
          settled = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          unsubscribe();
          request.raw.off('close', cleanup);
          safeEndReplyRaw(reply);
          resolve();
        };
        heartbeat = setInterval(() => {
          if (!safeWriteReplyRaw(reply, ': keepalive\n\n')) {
            cleanup();
          }
        }, 10_000);

        // Subscribe to ALL run events for this session (not filtered by
        // clientRequestId). The meta carries the DB row id (globally monotonic
        // per session) which we use as the SSE event id for deduplication.
        unsubscribe = subscribeSessionRunEvents(sessionId, (event, meta?: PublishRunEventMeta) => {
          const rowId = meta?.rowId;
          if (typeof rowId !== 'number') {
            return;
          }

          if (!replayCompleted) {
            pendingLiveEvents.push({
              event,
              rowId,
              clientRequestId: meta?.clientRequestId,
            });
            return;
          }

          deliverEvent(event, rowId, meta?.clientRequestId);
        });

        request.raw.on('close', cleanup);

        // Replay recent events (up to 500 rows) from the DB.
        // listRecentSessionRunEventsWithMeta returns rows ordered by id ASC,
        // with the DB row id as `seq`.
        const replayEvents = listRecentSessionRunEventsWithMeta({
          sessionId,
          afterRowId: query.data.afterSeq,
          limit: 500,
        });
        for (const replayEvent of replayEvents) {
          deliverEvent(
            replayEvent.event,
            replayEvent.seq,
            replayEvent.clientRequestId ?? undefined,
          );
        }

        replayCompleted = true;
        // Sort pending live events by rowId for correct ordering.
        pendingLiveEvents.sort((left, right) => left.rowId - right.rowId);
        for (const pendingEvent of pendingLiveEvents) {
          deliverEvent(pendingEvent.event, pendingEvent.rowId, pendingEvent.clientRequestId);
        }

        // If there's no active thread and no recent events, end the stream
        // gracefully so the client can fall back to polling.
        if (!settled && !currentActiveThread && replayEvents.length === 0) {
          safeWriteReplyRaw(
            reply,
            `data: ${JSON.stringify({ type: 'multi-attach:no-active-stream', sessionId })}\n\n`,
          );
          cleanup();
          return;
        }

        if (!settled) {
          wl.succeed(routeStep, undefined, {
            attached: true,
            sessionId,
            replayedCount: replayEvents.length,
            hasActiveThread: Boolean(currentActiveThread),
          });
          wl.flush(ctx, 200);
        }
      });
    },
  );
}

function safeSendWs(socket: WebSocket, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (_sendErr) {
    void _sendErr;
    return false;
  }
}

function safeCloseWs(socket: WebSocket, code: number, reason?: string): void {
  try {
    socket.close(code, reason);
  } catch (_closeErr) {
    void _closeErr;
  }
}

function safeWriteReplyRaw(reply: FastifyReply, payload: string): boolean {
  try {
    reply.raw.write(payload);
    return true;
  } catch (_writeErr) {
    void _writeErr;
    return false;
  }
}

function safeEndReplyRaw(reply: FastifyReply): void {
  try {
    reply.raw.end();
  } catch (_endErr) {
    void _endErr;
  }
}
