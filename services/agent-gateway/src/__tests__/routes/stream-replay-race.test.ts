import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import authPlugin from '../../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../../infra/db.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';
import { createToolResultRequestId } from '../../routes/stream.js';
import { streamRoutes } from '../../routes/stream-routes-plugin.js';
import {
  listSessionRunEventsByRequest,
  persistSessionRunEventForRequest,
} from '../../session/session-run-events.js';
import { appendSessionEvent, listSessionEvents } from '../../session/session-entry-store.js';
import { makeSessionEventId } from '../../session/session-event.js';
import {
  clearInFlightStreamRequest,
  registerInFlightStreamRequest,
} from '../../routes/stream-cancellation.js';
import { buildToolResultContent } from '../../tools/tool-result-contract.js';
import { withMockFetch } from '../../verification/task-verification-helpers.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'stream-replay-race-test-secret-1234567890';
process.env['AI_API_KEY'] = 'test-key';
process.env['AI_API_BASE_URL'] = 'https://unit-test.invalid/v1';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_ALIAS_MODEL = 'team-model-alias';
const USER_ID = 'u-stream-replay-race';
const SESSION_ID = 'sess-stream-replay-race';
const CLIENT_REQUEST_ID = 'req-stream-replay-race';
const STALE_TOOL_CALL_ID = 'call-stale-tool-use';
const STALE_SESSION_ENTRY_DELTA = 'stale session entry delta';
let onTrackedStreamRequestSeen: (() => void) | null = null;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    if (
      request.method === 'GET' &&
      request.url.includes(`/sessions/${SESSION_ID}/stream/sse`) &&
      request.url.includes(`clientRequestId=${encodeURIComponent(CLIENT_REQUEST_ID)}`)
    ) {
      onTrackedStreamRequestSeen?.();
      onTrackedStreamRequestSeen = null;
    }
  });
  await app.register(websocket);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(streamRoutes);
  await app.ready();
  return app;
}

function createOpenAIChatCompletionStream(text: string): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              choices: [
                {
                  delta: { content: text },
                  finish_reason: 'stop',
                },
              ],
            })}\n\n`,
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function parseSseChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0 && line !== '[DONE]')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function configureOpenAIProvider(userId: string): void {
  const providerConfig = [
    {
      id: OPENAI_PROVIDER_ID,
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: 'https://unit-test.invalid/v1',
      apiKey: 'test-key',
      defaultModels: [{ id: OPENAI_ALIAS_MODEL, label: 'Team Alias', enabled: true }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  const activeSelection = {
    chat: { providerId: OPENAI_PROVIDER_ID, modelId: OPENAI_ALIAS_MODEL },
    fast: { providerId: OPENAI_PROVIDER_ID, modelId: OPENAI_ALIAS_MODEL },
  };

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(providerConfig)],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(activeSelection)],
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  await connectDb();
  await migrate();
  app = await buildApp();
});

beforeEach(() => {
  sqliteRun('DELETE FROM session_run_events', []);
  sqliteRun('DELETE FROM user_settings', []);
  sqliteRun('DELETE FROM sessions', []);
  sqliteRun('DELETE FROM users', []);
  sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
     VALUES (?, ?, '[]', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
  configureOpenAIProvider(USER_ID);
});

afterAll(async () => {
  await app.close();
  await closeDb();
});

describe('stream replay race', () => {
  it('同 clientRequestId 的等待方遇到不可 replay 终态时继续上游，而不是 REQUEST_REPLAY_FAILED', async () => {
    const executionDeferred = (() => {
      let resolve: (value: { statusCode: number } | PromiseLike<{ statusCode: number }>) => void = (
        _value,
      ) => {
        throw new Error('execution resolver 未初始化');
      };
      const promise = new Promise<{ statusCode: number }>((innerResolve) => {
        resolve = innerResolve;
      });
      return { promise, resolve };
    })();

    registerInFlightStreamRequest({
      abortController: new AbortController(),
      clientRequestId: CLIENT_REQUEST_ID,
      execution: executionDeferred.promise,
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    const accessToken = app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` });
    const requestSeen = new Promise<void>((resolve) => {
      onTrackedStreamRequestSeen = resolve;
    });

    const responsePromise = withMockFetch(
      async (_input, init) => {
        const body = await new Request(_input, init).text();
        if (body.includes('"stream":true')) {
          return createOpenAIChatCompletionStream('continued after in-flight');
        }

        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '"会话标题"',
                },
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
      async () =>
        app.inject({
          method: 'GET',
          url:
            `/sessions/${SESSION_ID}/stream/sse?message=${encodeURIComponent('继续执行')}` +
            `&clientRequestId=${encodeURIComponent(CLIENT_REQUEST_ID)}` +
            `&providerId=${encodeURIComponent(OPENAI_PROVIDER_ID)}` +
            `&model=${encodeURIComponent(OPENAI_ALIAS_MODEL)}` +
            `&token=${encodeURIComponent(accessToken)}`,
        }),
    );

    try {
      await requestSeen;
      persistSessionRunEventForRequest(
        SESSION_ID,
        {
          type: 'done',
          stopReason: 'tool_use',
          eventId: 'evt-race-tool-use',
          runId: randomUUID(),
          occurredAt: Date.now(),
        },
        { clientRequestId: CLIENT_REQUEST_ID, seq: 1 },
      );
      appendSessionMessageV2({
        sessionId: SESSION_ID,
        userId: USER_ID,
        role: 'tool',
        clientRequestId: createToolResultRequestId(CLIENT_REQUEST_ID, STALE_TOOL_CALL_ID),
        replaceExisting: true,
        content: [
          buildToolResultContent({
            toolCallId: STALE_TOOL_CALL_ID,
            toolName: 'write',
            clientRequestId: CLIENT_REQUEST_ID,
            output: 'stale tool result should be cleared',
            isError: false,
          }),
        ],
      });
      appendSessionEvent({
        sessionId: SESSION_ID,
        userId: USER_ID,
        clientRequestId: CLIENT_REQUEST_ID,
        event: {
          id: makeSessionEventId(),
          timestamp: Date.now(),
          type: 'text.delta',
          delta: STALE_SESSION_ENTRY_DELTA,
        },
      });
      executionDeferred.resolve({ statusCode: 200 });
      clearInFlightStreamRequest({
        clientRequestId: CLIENT_REQUEST_ID,
        execution: executionDeferred.promise,
        sessionId: SESSION_ID,
      });

      const response = await responsePromise;
      const events = parseSseChunks(response.body);

      expect(response.statusCode).toBe(200);
      expect(events.some((event) => event['type'] === 'error')).toBe(false);
      expect(
        events.some(
          (event) =>
            event['type'] === 'text_delta' && event['delta'] === 'continued after in-flight',
        ),
      ).toBe(true);
      expect(
        events.some((event) => event['type'] === 'done' && event['stopReason'] === 'end_turn'),
      ).toBe(true);
      const liveTextEvent = events.find(
        (event) => event['type'] === 'text_delta' && event['delta'] === 'continued after in-flight',
      );
      const liveCursor = liveTextEvent?.['cursor'] as Record<string, unknown> | undefined;
      expect(liveCursor).toEqual({
        clientRequestId: CLIENT_REQUEST_ID,
        seq: expect.any(Number),
      });

      const replayResponse = await app.inject({
        method: 'GET',
        url:
          `/sessions/${SESSION_ID}/stream/sse?message=${encodeURIComponent('继续执行')}` +
          `&clientRequestId=${encodeURIComponent(CLIENT_REQUEST_ID)}` +
          `&providerId=${encodeURIComponent(OPENAI_PROVIDER_ID)}` +
          `&model=${encodeURIComponent(OPENAI_ALIAS_MODEL)}` +
          `&token=${encodeURIComponent(accessToken)}`,
      });
      const replayEvents = parseSseChunks(replayResponse.body);
      const persistedEvents = listSessionRunEventsByRequest({
        clientRequestId: CLIENT_REQUEST_ID,
        sessionId: SESSION_ID,
      });
      const scopedSessionEvents = listSessionEvents({
        clientRequestId: CLIENT_REQUEST_ID,
        sessionId: SESSION_ID,
      });

      expect(replayResponse.statusCode).toBe(200);
      expect(
        persistedEvents.some((event) => event.type === 'done' && event.stopReason === 'tool_use'),
      ).toBe(false);
      expect(
        replayEvents.some(
          (event) => event['type'] === 'tool_result' && event['toolCallId'] === STALE_TOOL_CALL_ID,
        ),
      ).toBe(false);
      expect(
        replayEvents.some(
          (event) => event['type'] === 'done' && event['stopReason'] === 'tool_use',
        ),
      ).toBe(false);
      expect(
        replayEvents.some(
          (event) =>
            event['type'] === 'text_delta' && event['delta'] === 'continued after in-flight',
        ),
      ).toBe(true);
      expect(
        replayEvents.some(
          (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
        ),
      ).toBe(true);
      expect(
        scopedSessionEvents.some(
          (event) => event.type === 'text.delta' && event.delta === STALE_SESSION_ENTRY_DELTA,
        ),
      ).toBe(false);
    } finally {
      clearInFlightStreamRequest({
        clientRequestId: CLIENT_REQUEST_ID,
        execution: executionDeferred.promise,
        sessionId: SESSION_ID,
      });
    }
  });
});
