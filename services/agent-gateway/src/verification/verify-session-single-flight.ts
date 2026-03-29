import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { assert, waitFor, withMockFetch, withTempEnv } from './task-verification-helpers.js';

async function main(): Promise<void> {
  const workspaceRoot = `/tmp/openawork-session-single-flight-${randomUUID()}`;
  let firstFetchStarted = false;

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      WORKSPACE_ROOT: workspaceRoot,
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          firstFetchStarted = true;
          const signal = init?.signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                if (signal?.aborted) {
                  controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                  return;
                }

                signal?.addEventListener(
                  'abort',
                  () => {
                    controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                  },
                  { once: true },
                );
              },
            }),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          );
        }) as typeof fetch,
        async () => {
          const [dbModule, { runSessionInBackground }, { stopAnyInFlightStreamRequestForSession }] =
            await Promise.all([
              import('../db.js'),
              import('../routes/stream.js'),
              import('../routes/stream-cancellation.js'),
            ]);

          await dbModule.connectDb();
          await dbModule.migrate();

          const userId = randomUUID();
          const sessionId = randomUUID();
          dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
            userId,
            `single-flight-${userId}@openawork.local`,
            'hash',
          ]);
          dbModule.sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'running')`,
            [sessionId, userId],
          );

          const firstRun = runSessionInBackground({
            requestData: {
              clientRequestId: 'req-1',
              message: '第一条请求',
              model: 'gpt-4o',
              maxTokens: 512,
              temperature: 1,
              webSearchEnabled: false,
            },
            sessionId,
            userId,
          });

          await waitFor(
            () => firstFetchStarted,
            'first session request should start upstream fetch',
          );

          const secondEvents: Array<{ code?: string; type: string }> = [];
          const secondRun = await runSessionInBackground({
            requestData: {
              clientRequestId: 'req-2',
              message: '第二条请求',
              model: 'gpt-4o',
              maxTokens: 512,
              temperature: 1,
              webSearchEnabled: false,
            },
            sessionId,
            userId,
            writeChunk: (chunk) => {
              secondEvents.push(chunk as { code?: string; type: string });
            },
          });

          assert(
            secondRun.statusCode === 409,
            'second in-flight request should be rejected with 409',
          );
          assert(
            secondEvents.some(
              (event) => event.type === 'error' && event.code === 'SESSION_ALREADY_RUNNING',
            ),
            'second in-flight request should surface SESSION_ALREADY_RUNNING',
          );

          const stopped = await stopAnyInFlightStreamRequestForSession({ sessionId, userId });
          assert(
            stopped === true,
            'first in-flight request should still be cancellable by session',
          );

          const firstResult = await firstRun;
          assert(
            firstResult.statusCode === 200,
            'first request should end cleanly after cancellation',
          );

          console.log('verify-session-single-flight: ok');

          await dbModule.closeDb();
          rmSync(workspaceRoot, { recursive: true, force: true });
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-session-single-flight: failed');
  console.error(error);
  process.exitCode = 1;
});
