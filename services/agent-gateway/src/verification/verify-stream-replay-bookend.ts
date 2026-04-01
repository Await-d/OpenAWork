import { createHash, randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { persistSessionRunEventForRequest } from '../session-run-events.js';
import { assert, withMockFetch, withTempEnv } from './task-verification-helpers.js';

const OPENAI_PROVIDER_ID = 'openai';
const OPENAI_ALIAS_MODEL = 'team-model-alias';

async function main(): Promise<void> {
  let upstreamCallCount: number = 0;

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
    },
    async () => {
      await withMockFetch(
        (async () => {
          upstreamCallCount += 1;
          return createResponsesTextStream('bookend fallback reached upstream');
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          const app = Fastify();
          await app.register(websocket);
          await app.register(requestWorkflowPlugin);
          await app.register(authPlugin);
          await app.register(sessionsRoutes);
          await app.register(streamRoutes);
          await app.ready();

          try {
            const userId = randomUUID();
            const email = `bookend-${userId}@openawork.local`;
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              email,
              createHash('sha256').update('bookend123456').digest('hex'),
            ]);

            configureOpenAIProvider(userId);

            const accessToken = app.jwt.sign({ sub: userId, email });
            const sessionId = randomUUID();
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
               VALUES (?, ?, '[]', '{}', 'idle')`,
              [sessionId, userId],
            );

            persistSessionRunEventForRequest(
              sessionId,
              {
                type: 'permission_asked',
                requestId: 'perm-replay-1',
                toolName: 'bash',
                scope: 'workspace',
                reason: '需要运行命令',
                riskLevel: 'medium',
              },
              { clientRequestId: 'req-replay-permission' },
            );

            const replayResponse = await streamScenario({
              accessToken,
              app,
              clientRequestId: 'req-replay-permission',
              message: '重连应直接回放等待中的权限请求',
              sessionId,
            });
            assert(replayResponse.statusCode === 200, 'permission replay request should succeed');
            const replayEvents = parseSseChunks(replayResponse.body);
            assert(
              replayEvents.some(
                (event) =>
                  event['type'] === 'permission_asked' && event['requestId'] === 'perm-replay-1',
              ),
              'permission replay should emit the persisted permission_asked event',
            );
            assert(
              upstreamCallCount === 0,
              'permission replay should not call upstream when interaction_wait bookend is replayable',
            );

            persistSessionRunEventForRequest(
              sessionId,
              {
                type: 'done',
                stopReason: 'tool_use',
                eventId: 'evt-tool-handoff',
                runId: 'run-tool-handoff',
                occurredAt: Date.now(),
              },
              { clientRequestId: 'req-tool-handoff' },
            );

            const handoffResponse = await streamScenario({
              accessToken,
              app,
              clientRequestId: 'req-tool-handoff',
              message: 'tool handoff 不应直接 replay 完整结果',
              sessionId,
            });
            assert(handoffResponse.statusCode === 200, 'tool handoff request should succeed');
            const handoffEvents = parseSseChunks(handoffResponse.body);
            assert(
              handoffEvents.some(
                (event) => event['type'] === 'done' && event['stopReason'] === 'end_turn',
              ),
              'tool_handoff should continue upstream to a fresh end_turn instead of replaying stale tool_use',
            );
            assert(
              !handoffEvents.some(
                (event) => event['type'] === 'done' && event['stopReason'] === 'tool_use',
              ),
              'tool_handoff replay should not echo the persisted non-replayable tool_use done event',
            );
            assert(
              Number(upstreamCallCount) === 1,
              'tool_handoff should require a fresh upstream call because its bookend is not replayable',
            );

            console.log('verify-stream-replay-bookend: ok');
          } finally {
            await app.close();
            await closeDb();
          }
        },
      );
    },
  );
}

function createResponsesTextStream(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              'event: response.output_text.delta',
              `data: ${JSON.stringify({ output_index: 0, content_index: 0, item_id: 'msg_replay', delta: text })}`,
              '',
              'event: response.completed',
              `data: ${JSON.stringify({ response: { output: [{ id: 'msg_replay', type: 'message' }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}`,
              '',
            ].join('\n'),
          ),
        );
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
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

async function streamScenario(input: {
  accessToken: string;
  app: FastifyInstance;
  clientRequestId: string;
  message: string;
  sessionId: string;
}): Promise<{ body: string; statusCode: number }> {
  return input.app.inject({
    method: 'GET',
    url:
      `/sessions/${input.sessionId}/stream/sse?message=${encodeURIComponent(input.message)}` +
      `&clientRequestId=${encodeURIComponent(input.clientRequestId)}` +
      `&providerId=${encodeURIComponent(OPENAI_PROVIDER_ID)}` +
      `&model=${encodeURIComponent(OPENAI_ALIAS_MODEL)}` +
      `&token=${encodeURIComponent(input.accessToken)}`,
  });
}

function parseSseChunks(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line !== '[DONE]' && line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

void main().catch((error) => {
  console.error('verify-stream-replay-bookend: failed');
  console.error(error);
  process.exitCode = 1;
});
