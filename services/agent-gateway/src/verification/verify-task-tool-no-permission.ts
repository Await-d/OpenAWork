import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { permissionsRoutes } from '../routes/permissions.js';
import { subscribeSessionRunEvents } from '../session-run-events.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

async function main(): Promise<void> {
  let app: FastifyInstance | null = null;

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
    },
    async () => {
      await withMockFetch(
        (async () => createChatCompletionsStream('子代理已经执行完成。')) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const email = `task-no-permission-${userId}@openawork.local`;
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              email,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
              [parentSessionId, userId],
            );

            app = Fastify();
            await app.register(requestWorkflowPlugin);
            await app.register(authPlugin);
            await app.register(permissionsRoutes);
            await app.ready();

            const accessToken = app.jwt.sign({ sub: userId, email });
            const events: Array<{ type: string }> = [];
            const unsubscribe = subscribeSessionRunEvents(parentSessionId, (event) => {
              events.push(event as { type: string });
            });

            try {
              const sandbox = createDefaultSandbox();
              const result = await sandbox.execute(
                {
                  toolCallId: 'task-call-1',
                  toolName: 'task',
                  rawInput: {
                    description: '让子代理写出结论',
                    prompt: '请给出最终结论',
                    subagent_type: 'explore',
                    load_skills: [],
                    run_in_background: true,
                  },
                },
                new AbortController().signal,
                parentSessionId,
                {
                  clientRequestId: 'req-task-no-permission',
                  nextRound: 2,
                  requestData: {
                    clientRequestId: 'req-task-no-permission',
                    message: '请委派一个子代理',
                    model: 'gpt-4o',
                    maxTokens: 512,
                    temperature: 1,
                    webSearchEnabled: false,
                  },
                },
              );

              assert(result.isError === false, 'task tool should execute without approval');
              assert(
                result.pendingPermissionRequestId === undefined,
                'task tool should not emit pendingPermissionRequestId by default',
              );

              const permissionCount =
                sqliteGet<{ count: number }>(
                  `SELECT COUNT(1) AS count
                   FROM permission_requests
                   WHERE session_id = ? AND tool_name = 'task'`,
                  [parentSessionId],
                )?.count ?? 0;
              assert(
                permissionCount === 0,
                'task tool should not create permission_requests by default',
              );

              const pendingResponse = await app.inject({
                method: 'GET',
                url: `/sessions/${parentSessionId}/permissions/pending`,
                headers: { authorization: `Bearer ${accessToken}` },
              });
              assert(
                pendingResponse.statusCode === 200,
                'pending permissions route should succeed',
              );
              const pendingBody = pendingResponse.json();
              assert(
                Array.isArray(pendingBody.requests) && pendingBody.requests.length === 0,
                'pending permissions route should stay empty for task tool',
              );

              await waitFor(async () => {
                const graph = await new AgentTaskManagerImpl().loadOrCreate(
                  WORKSPACE_ROOT,
                  parentSessionId,
                );
                return Object.values(graph.tasks).some((task) => task.status === 'completed');
              }, 'delegated child task should still complete automatically without approval');

              assert(
                events.every((event) => event.type !== 'permission_asked'),
                'task tool should not publish permission_asked events by default',
              );

              console.log('verify-task-tool-no-permission: ok');
            } finally {
              unsubscribe();
            }
          } finally {
            if (app) {
              await app.close();
            }
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-no-permission: failed');
  console.error(error);
  process.exitCode = 1;
});
