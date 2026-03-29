import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { assert, waitFor, withMockFetch, withTempEnv } from './task-verification-helpers.js';

function isTaskToolOutput(value: unknown): value is {
  sessionId: string;
  taskId: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate['sessionId'] === 'string' && typeof candidate['taskId'] === 'string';
}

async function main(): Promise<void> {
  const workspaceRoot = `/tmp/openawork-task-cancel-${randomUUID()}`;
  let aborted = false;
  let fetchStarted = false;

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
          fetchStarted = true;
          const signal = init?.signal;
          return new Response(
            new ReadableStream({
              start(controller) {
                if (signal?.aborted) {
                  aborted = true;
                  controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
                  return;
                }

                signal?.addEventListener(
                  'abort',
                  () => {
                    aborted = true;
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
          const [
            { default: Fastify },
            { default: authPlugin },
            { default: requestWorkflowPlugin },
            { sessionsRoutes },
            dbModule,
            { createDefaultSandbox },
            { listSessionMessages },
          ] = await Promise.all([
            import('fastify'),
            import('../auth.js'),
            import('../request-workflow.js'),
            import('../routes/sessions.js'),
            import('../db.js'),
            import('../tool-sandbox.js'),
            import('../session-message-store.js'),
          ]);

          await dbModule.connectDb();
          await dbModule.migrate();

          const userId = randomUUID();
          const parentSessionId = randomUUID();
          const email = `cancel-${userId}@openawork.local`;
          dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
            userId,
            email,
            'hash',
          ]);
          dbModule.sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
            [parentSessionId, userId],
          );
          dbModule.sqliteRun(
            `INSERT INTO permission_requests (
               id, session_id, tool_name, scope, reason, risk_level, preview_action, request_payload_json, status, decision
             ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'approved', 'session')`,
            [
              randomUUID(),
              parentSessionId,
              'task',
              'task:取消正在运行的子任务',
              '需要创建子任务和子会话',
              'high',
              '创建子任务 取消正在运行的子任务',
            ],
          );

          const app = Fastify();
          await app.register(requestWorkflowPlugin);
          await app.register(authPlugin);
          await app.register(sessionsRoutes);
          await app.ready();

          try {
            const accessToken = app.jwt.sign({ sub: userId, email });
            const sandbox = createDefaultSandbox();
            const taskResult = await sandbox.execute(
              {
                toolCallId: 'task-call-cancel',
                toolName: 'task',
                rawInput: {
                  description: '取消正在运行的子任务',
                  prompt: '持续检查大型仓库直到被取消',
                  subagent_type: 'explore',
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-req-cancel',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-req-cancel',
                  message: '请启动一个会持续运行的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(
              taskResult.isError === false,
              'task tool should start the background child task',
            );
            assert(
              isTaskToolOutput(taskResult.output),
              'task tool should return a child task handle',
            );

            const childSessionId = taskResult.output.sessionId;
            const childTaskId = taskResult.output.taskId;
            const taskManager = new AgentTaskManagerImpl();

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(
                dbModule.WORKSPACE_ROOT,
                parentSessionId,
              );
              return graph.tasks[childTaskId]?.status === 'running';
            }, 'child task should reach running state before cancellation');
            await waitFor(
              () => fetchStarted,
              'child task should start the upstream background request',
            );

            const cancelRes = await app.inject({
              method: 'POST',
              url: `/sessions/${childSessionId}/tasks/${childTaskId}/cancel`,
              headers: { authorization: `Bearer ${accessToken}` },
            });

            assert(
              cancelRes.statusCode === 200,
              `task cancel route should succeed (got ${cancelRes.statusCode}: ${cancelRes.body})`,
            );
            const cancelPayload = JSON.parse(cancelRes.body) as {
              cancelled?: boolean;
              stopped?: boolean;
            };
            assert(
              cancelPayload.cancelled === true,
              'task cancel route should mark the task as cancelled',
            );
            assert(
              cancelPayload.stopped === true,
              'task cancel route should abort the in-flight child session',
            );

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(
                dbModule.WORKSPACE_ROOT,
                parentSessionId,
              );
              return graph.tasks[childTaskId]?.status === 'cancelled';
            }, 'child task should persist cancelled status');

            await waitFor(
              () => aborted,
              'upstream child run should observe abort after cancellation',
            );

            const childSession = dbModule.sqliteGet<{ state_status: string }>(
              'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
              [childSessionId, userId],
            );
            assert(
              childSession?.state_status === 'idle',
              'child session should return to idle after cancellation',
            );

            await waitFor(() => {
              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              const taskToolMessage = parentMessages.find((message) => message.role === 'tool');
              const taskToolPart = Array.isArray(taskToolMessage?.content)
                ? taskToolMessage.content[0]
                : undefined;
              if (
                !taskToolPart ||
                taskToolPart.type !== 'tool_result' ||
                !taskToolPart.output ||
                typeof taskToolPart.output !== 'object'
              ) {
                return false;
              }

              const output = taskToolPart.output as Record<string, unknown>;
              return output?.['status'] === 'cancelled';
            }, 'parent task tool result should be replaced with cancelled status');

            console.log('verify-task-cancel-route: ok');
          } finally {
            await app.close();
            await dbModule.closeDb();
            rmSync(workspaceRoot, { recursive: true, force: true });
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-cancel-route: failed');
  console.error(error);
  process.exitCode = 1;
});
