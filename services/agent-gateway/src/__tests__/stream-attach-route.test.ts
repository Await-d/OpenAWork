import type { FastifyInstance } from 'fastify';
import type { RunEvent } from '@openAwork/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import websocket from '@fastify/websocket';

let app: FastifyInstance | null = null;
let liveHandler:
  | ((event: RunEvent, meta?: { clientRequestId?: string; seq?: number }) => void)
  | null = null;

const getLatestSessionRunEventSeqByRequestMock = vi.fn();
const listSessionRunEventsByRequestMock = vi.fn();
const listSessionRunEventsByRequestAfterSeqMock = vi.fn();
const subscribeSessionRunEventsMock = vi.fn(
  (
    _sessionId: string,
    handler: (event: RunEvent, meta?: { clientRequestId?: string; seq?: number }) => void,
  ) => {
    liveHandler = handler;
    return () => {
      liveHandler = null;
    };
  },
);
const getFreshSessionRuntimeThreadMock = vi.fn();

describe('stream attach routes', () => {
  beforeEach(async () => {
    vi.resetModules();
    liveHandler = null;
    getLatestSessionRunEventSeqByRequestMock.mockReset();
    listSessionRunEventsByRequestMock.mockReset();
    listSessionRunEventsByRequestAfterSeqMock.mockReset();
    subscribeSessionRunEventsMock.mockClear();
    getFreshSessionRuntimeThreadMock.mockReset();

    vi.doMock('../auth.js', () => ({
      requireAuth: async (
        request: {
          headers: Record<string, string | undefined>;
          user?: { sub: string; email: string };
        },
        reply: { status: (code: number) => { send: (payload: unknown) => void } },
      ) => {
        if (request.headers['authorization'] !== 'Bearer token-123') {
          reply.status(401).send({ error: 'Unauthorized' });
          return;
        }
        request.user = { sub: 'user-1', email: 'user-1@example.com' };
      },
    }));

    vi.doMock('../db.js', () => ({
      WORKSPACE_ROOT: '/workspace',
      WORKSPACE_ROOTS: ['/workspace'],
      WORKSPACE_ACCESS_MODE: 'unrestricted',
      WORKSPACE_ACCESS_RESTRICTED: false,
      WORKSPACE_BROWSER_ROOT: '/',
      sqliteGet: (_query: string, params: unknown[]) => {
        const [sessionId, userId] = params as [string, string];
        if (sessionId === 'session-1' && userId === 'user-1') {
          return { id: sessionId };
        }
        return undefined;
      },
      sqliteRun: vi.fn(),
      sqliteAll: vi.fn(() => []),
      db: { exec: vi.fn() },
      redis: {
        setex: vi.fn(),
        del: vi.fn(),
        get: vi.fn(() => null),
      },
    }));

    vi.doMock('@openAwork/logger', () => ({
      WorkflowLogger: class {
        start() {
          return { status: 'pending' };
        }
        startChild() {
          return { status: 'pending' };
        }
        succeed() {
          return undefined;
        }
        fail() {
          return undefined;
        }
        flush() {
          return undefined;
        }
      },
      createRequestContext: vi.fn(() => ({ requestId: 'req-test' })),
    }));

    vi.doMock('../audit-log.js', () => ({ writeAuditLog: vi.fn() }));
    vi.doMock('../task-parent-auto-resume.js', () => ({
      clearPendingTaskParentAutoResumesForSession: vi.fn(),
    }));
    vi.doMock('./stream-cancellation.js', () => ({
      stopAnyInFlightStreamRequestForSession: vi.fn(async () => false),
      stopInFlightStreamRequest: vi.fn(async () => false),
    }));
    vi.doMock('./stream.js', () => ({
      createStreamErrorChunk: vi.fn(),
      handleStreamRequest: vi.fn(),
      loadSessionContext: vi.fn(() => ({ legacyMessagesJson: '[]', metadataJson: '{}' })),
      stopStreamSchema: { safeParse: vi.fn() },
      streamRequestSchema: { safeParse: vi.fn() },
    }));
    vi.doMock('../session-run-events.js', () => ({
      getLatestSessionRunEventSeqByRequest: getLatestSessionRunEventSeqByRequestMock,
      listSessionRunEventsByRequest: listSessionRunEventsByRequestMock,
      listSessionRunEventsByRequestAfterSeq: listSessionRunEventsByRequestAfterSeqMock,
      subscribeSessionRunEvents: subscribeSessionRunEventsMock,
    }));
    vi.doMock('../session-runtime-thread-store.js', () => ({
      getFreshSessionRuntimeThread: getFreshSessionRuntimeThreadMock,
    }));

    const [{ default: Fastify }, { streamRoutes }] = await Promise.all([
      import('fastify'),
      import('../routes/stream-routes-plugin.js'),
    ]);

    app = Fastify();
    app.decorate('jwt', {
      options: {
        decode: {},
        sign: {},
        verify: {},
      },
      verify: (token: string) => {
        if (token !== 'token-123') {
          throw new Error('Unauthorized');
        }
        return { sub: 'user-1', email: 'user-1@example.com' };
      },
      sign: () => 'signed-token',
      decode: () => null,
      lookupToken: () => '',
    });
    await app.register(websocket);
    await app.register(streamRoutes);
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = null;
    }
  });

  it('returns the active request snapshot with latest durable seq', async () => {
    getFreshSessionRuntimeThreadMock.mockReturnValue({
      clientRequestId: 'req-attach-1',
      heartbeatAtMs: 220,
      sessionId: 'session-1',
      startedAtMs: 100,
      userId: 'user-1',
    });
    getLatestSessionRunEventSeqByRequestMock.mockReturnValue(12);

    const response = await app!.inject({
      method: 'GET',
      url: '/sessions/session-1/stream/active',
      headers: { authorization: 'Bearer token-123' },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      active: {
        clientRequestId: 'req-attach-1',
        heartbeatAtMs: 220,
        lastSeq: 12,
        sessionId: 'session-1',
        startedAtMs: 100,
      },
    });
  });

  it('replays missed durable events and then streams live terminal events over attach SSE', async () => {
    getFreshSessionRuntimeThreadMock.mockReturnValue({
      clientRequestId: 'req-attach-1',
      heartbeatAtMs: 220,
      sessionId: 'session-1',
      startedAtMs: 100,
      userId: 'user-1',
    });
    listSessionRunEventsByRequestMock.mockReturnValue([
      {
        type: 'text_delta',
        delta: '已恢复',
        eventId: 'run-1:evt:4',
        runId: 'run-1',
        occurredAt: 104,
      },
    ]);
    listSessionRunEventsByRequestAfterSeqMock.mockReturnValue([
      {
        seq: 4,
        event: {
          type: 'text_delta',
          delta: '已恢复',
          eventId: 'run-1:evt:4',
          runId: 'run-1',
          occurredAt: 104,
        },
      },
    ]);

    const responsePromise = app!.inject({
      method: 'GET',
      url: '/sessions/session-1/stream/attach?token=token-123&clientRequestId=req-attach-1&afterSeq=3',
    });

    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    liveHandler?.(
      {
        type: 'done',
        stopReason: 'end_turn',
        eventId: 'run-1:evt:5',
        runId: 'run-1',
        occurredAt: 105,
      },
      { clientRequestId: 'req-attach-1', seq: 5 },
    );

    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('retry: 1000');
    expect(response.body).toContain('"delta":"已恢复"');
    expect(response.body).toContain('"stopReason":"end_turn"');
  });

  it('buffers live events that arrive during replay and flushes them in seq order', async () => {
    getFreshSessionRuntimeThreadMock.mockReturnValue({
      clientRequestId: 'req-attach-1',
      heartbeatAtMs: 220,
      sessionId: 'session-1',
      startedAtMs: 100,
      userId: 'user-1',
    });
    listSessionRunEventsByRequestMock.mockReturnValue([
      {
        type: 'text_delta',
        delta: '已恢复',
        eventId: 'run-1:evt:4',
        runId: 'run-1',
        occurredAt: 104,
      },
    ]);
    listSessionRunEventsByRequestAfterSeqMock.mockImplementation(() => {
      liveHandler?.(
        {
          type: 'text_delta',
          delta: '实时补发',
          eventId: 'run-1:evt:5',
          runId: 'run-1',
          occurredAt: 105,
        },
        { clientRequestId: 'req-attach-1', seq: 5 },
      );
      liveHandler?.(
        {
          type: 'done',
          stopReason: 'end_turn',
          eventId: 'run-1:evt:6',
          runId: 'run-1',
          occurredAt: 106,
        },
        { clientRequestId: 'req-attach-1', seq: 6 },
      );

      return [
        {
          seq: 4,
          event: {
            type: 'text_delta',
            delta: '已恢复',
            eventId: 'run-1:evt:4',
            runId: 'run-1',
            occurredAt: 104,
          },
        },
      ];
    });

    const response = await app!.inject({
      method: 'GET',
      url: '/sessions/session-1/stream/attach?token=token-123&clientRequestId=req-attach-1&afterSeq=3',
    });

    expect(response.statusCode).toBe(200);
    const replayIndex = response.body.indexOf('"delta":"已恢复"');
    const liveIndex = response.body.indexOf('"delta":"实时补发"');
    const doneIndex = response.body.indexOf('"stopReason":"end_turn"');
    expect(replayIndex).toBeGreaterThanOrEqual(0);
    expect(liveIndex).toBeGreaterThan(replayIndex);
    expect(doneIndex).toBeGreaterThan(liveIndex);
  });
});
