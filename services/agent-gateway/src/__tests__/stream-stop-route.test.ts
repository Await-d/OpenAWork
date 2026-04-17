import type { FastifyInstance } from 'fastify';
import type * as StreamCancellation from '../routes/stream-cancellation.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import websocket from '@fastify/websocket';
import { z } from 'zod';

let app: FastifyInstance | null = null;
let registerInFlightStreamRequest: typeof StreamCancellation.registerInFlightStreamRequest;
let clearInFlightStreamRequest: typeof StreamCancellation.clearInFlightStreamRequest;

describe('stream stop route', () => {
  beforeEach(async () => {
    vi.resetModules();

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

    vi.doMock('../model-router.js', () => ({
      modelRequestSchema: z.object({
        model: z.string().default('default'),
        maxTokens: z.number().default(4096),
        temperature: z.number().default(0),
        thinkingEnabled: z.boolean().optional(),
        reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
      }),
      resolveModelRoute: vi.fn(),
      resolveModelRouteFromProvider: vi.fn(),
    }));

    vi.doMock('../provider-config.js', () => ({
      getProviderConfigForSelection: vi.fn(),
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

    vi.doMock('../message-v2-adapter.js', () => ({
      appendSessionMessageV2: vi.fn(),
      getSessionMessageByRequestId: vi.fn(() => null),
      listSessionMessagesByRequestScope: vi.fn(() => []),
      listSessionMessagesV2: vi.fn(() => []),
      truncateSessionMessagesAfterV2: vi.fn(),
    }));
    vi.doMock('../session-message-store.js', () => ({
      buildUpstreamConversation: vi.fn(() => []),
    }));
    vi.doMock('../stream-session-title.js', () => ({ persistStreamUserMessage: vi.fn() }));
    vi.doMock('../session-permission-events.js', () => ({
      listSessionPermissionRunEvents: vi.fn(() => []),
    }));
    vi.doMock('../session-run-events.js', () => ({
      publishSessionRunEvent: vi.fn(),
      subscribeSessionRunEvents: vi.fn(() => () => undefined),
    }));
    vi.doMock('../tool-sandbox.js', () => ({
      createDefaultSandbox: vi.fn(() => ({
        execute: vi.fn(),
      })),
    }));
    vi.doMock('./stream-protocol.js', () => ({
      buildGatewayToolDefinitions: vi.fn(() => []),
      createStreamParseState: vi.fn(() => ({
        nextEventSequence: 1,
        sawFinishReason: false,
        stopReason: 'end_turn',
      })),
      parseUpstreamFrame: vi.fn(() => []),
      ResponsesUpstreamEventError: class extends Error {
        code = 'MOCK';
      },
    }));
    vi.doMock('./stream-completion.js', () => ({
      resolveEofRoundDecision: vi.fn(() => ({
        shouldContinue: false,
        shouldStop: true,
        stopReason: 'end_turn',
        truncated: false,
      })),
    }));
    vi.doMock('./upstream-error.js', () => ({ readUpstreamError: vi.fn() }));
    vi.doMock('./upstream-request.js', () => ({ buildUpstreamRequestBody: vi.fn(() => ({})) }));
    vi.doMock('../session-workspace-metadata.js', () => ({
      sanitizeSessionMetadataJson: vi.fn((value: string) => value),
    }));
    vi.doMock('../workspace-paths.js', () => ({ validateWorkspacePath: vi.fn(() => null) }));

    const [{ default: Fastify }, { streamRoutes }, streamCancellationModule] = await Promise.all([
      import('fastify'),
      import('../routes/stream-routes-plugin.js'),
      import('../routes/stream-cancellation.js'),
    ]);

    registerInFlightStreamRequest = streamCancellationModule.registerInFlightStreamRequest;
    clearInFlightStreamRequest = streamCancellationModule.clearInFlightStreamRequest;

    app = Fastify();
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

  it('aborts the matching in-flight stream for the authenticated session owner', async () => {
    const abortController = new AbortController();
    const execution = new Promise<{ statusCode: number }>((resolve) => {
      abortController.signal.addEventListener(
        'abort',
        () => {
          resolve({ statusCode: 200 });
        },
        { once: true },
      );
    });

    registerInFlightStreamRequest({
      abortController,
      clientRequestId: 'req-stop-1',
      execution,
      sessionId: 'session-1',
      userId: 'user-1',
    });

    const stopRes = await app!.inject({
      method: 'POST',
      url: '/sessions/session-1/stream/stop',
      headers: { authorization: 'Bearer token-123' },
      payload: { clientRequestId: 'req-stop-1' },
    });

    expect(stopRes.statusCode).toBe(200);
    expect(JSON.parse(stopRes.body)).toEqual({ stopped: true });
    expect(abortController.signal.aborted).toBe(true);

    clearInFlightStreamRequest({
      clientRequestId: 'req-stop-1',
      execution,
      sessionId: 'session-1',
    });
  });

  it('returns stopped=false when no active request matches the session', async () => {
    const stopRes = await app!.inject({
      method: 'POST',
      url: '/sessions/session-1/stream/stop',
      headers: { authorization: 'Bearer token-123' },
      payload: { clientRequestId: 'missing-request' },
    });

    expect(stopRes.statusCode).toBe(200);
    expect(JSON.parse(stopRes.body)).toEqual({ stopped: false });
  });

  it('aborts any active in-flight stream for the authenticated session owner', async () => {
    const abortController = new AbortController();
    const execution = new Promise<{ statusCode: number }>((resolve) => {
      abortController.signal.addEventListener(
        'abort',
        () => {
          resolve({ statusCode: 200 });
        },
        { once: true },
      );
    });

    registerInFlightStreamRequest({
      abortController,
      clientRequestId: 'req-stop-active-1',
      execution,
      sessionId: 'session-1',
      userId: 'user-1',
    });

    const stopRes = await app!.inject({
      method: 'POST',
      url: '/sessions/session-1/stream/stop-active',
      headers: { authorization: 'Bearer token-123' },
    });

    expect(stopRes.statusCode).toBe(200);
    expect(JSON.parse(stopRes.body)).toEqual({ stopped: true });
    expect(abortController.signal.aborted).toBe(true);

    clearInFlightStreamRequest({
      clientRequestId: 'req-stop-active-1',
      execution,
      sessionId: 'session-1',
    });
  });

  it('returns stopped=false when stop-active finds no running request', async () => {
    const stopRes = await app!.inject({
      method: 'POST',
      url: '/sessions/session-1/stream/stop-active',
      headers: { authorization: 'Bearer token-123' },
    });

    expect(stopRes.statusCode).toBe(200);
    expect(JSON.parse(stopRes.body)).toEqual({ stopped: false });
  });

  it('rejects stop requests for sessions not owned by the current user', async () => {
    const stopRes = await app!.inject({
      method: 'POST',
      url: '/sessions/session-2/stream/stop',
      headers: { authorization: 'Bearer token-123' },
      payload: { clientRequestId: 'req-stop-1' },
    });

    expect(stopRes.statusCode).toBe(404);
    expect(JSON.parse(stopRes.body)).toEqual({ error: 'Session not found' });
  });
});
