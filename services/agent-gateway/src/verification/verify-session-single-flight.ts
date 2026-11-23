import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { assert, waitFor, withMockFetch, withTempEnv } from './task-verification-helpers.js';
import { getAnyInFlightStreamRequestForSession } from '../routes/stream-cancellation.js';

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
        async (_url, init) => {
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
        },
        async () => {
          const [dbModule, { runSessionInBackground }, { stopAnyInFlightStreamRequestForSession }] =
            await Promise.all([
              import('../infra/db.js'),
              import('../routes/stream-runtime.js'),
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

          // 会话级单飞:第一轮仍在飞时,同一会话(不同 requestId)必须被判定为「正在运行」,
          // 这是 stream.ts 输出 409 SESSION_ALREADY_RUNNING 的同一真相源。此断言不改变
          // 下面「第二个请求被拒」的既有契约,只是把「为什么拒」在更靠前处钉死。
          assert(
            getAnyInFlightStreamRequestForSession({
              excludeClientRequestId: 'req-2',
              sessionId,
              userId,
            })?.clientRequestId === 'req-1',
            'first in-flight request should occupy the session single-flight slot',
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
            writeChunk: (chunk: { code?: string; type: string }) => {
              secondEvents.push(chunk);
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
