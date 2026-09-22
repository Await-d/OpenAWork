import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import {
  assert,
  extractStructuredToolResultOutput,
  extractToolResultPart,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

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

/**
 * 判断一次 fetch 是否为 MCP 传输请求（JSON-RPC 体或 `mcp.*` 主机）。
 * 仅用于本脚本的 fetch 桩：MCP 不在取消链路的验收范围内。
 */
function isMcpTransportRequest(url: string, body: string): boolean {
  if (body.includes('"jsonrpc"')) {
    return true;
  }
  try {
    return new URL(url).hostname.startsWith('mcp.');
  } catch {
    return false;
  }
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
        async (input, init) => {
          const requestUrl =
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const requestBody = typeof init?.body === 'string' ? init.body : '';
          if (isMcpTransportRequest(requestUrl, requestBody)) {
            // MCP 传输（如 https://mcp.grep.app 的 StreamableHTTP）：本脚本只关心
            // 上游模型请求的取消链路，MCP 不在验收范围内。快速失败可避免把 MCP
            // 客户端的 30s 请求超时算进「取消耗时」——此前取消要等满 30s，正是因为
            // 第一次被桩拦截的 fetch 是 MCP 连接（`StreamableHTTPClientTransport`），
            // 它既挂住了 MCP 初始化，也让「上游已开始」的断言落在错误的对象上。
            return new Response('not found', { status: 404 });
          }
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
        },
        async () => {
          const [
            { default: Fastify },
            { default: authPlugin },
            { default: requestWorkflowPlugin },
            { sessionsRoutes },
            dbModule,
            { createDefaultSandbox },
            { listSessionMessagesV2: listSessionMessages },
          ] = await Promise.all([
            import('fastify'),
            import('../infra/auth.js'),
            import('../runtime/request-workflow.js'),
            import('../routes/sessions.js'),
            import('../infra/db.js'),
            import('../tools/tool-sandbox.js'),
            import('../message/message-v2-adapter.js'),
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
          // 父会话必须绑定到本脚本的临时 workspaceRoot：未绑定会话会被
          // `resolveTaskGraphProjectRoot` 回退到系统文档目录，导致任务图写到
          // ~/Documents/OpenAWork，而下面的断言读取的是 dbModule.WORKSPACE_ROOT，
          // 两边不是同一份文件（waitFor 必然超时），同时污染开发者本机目录。
          dbModule.sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
            [parentSessionId, userId, JSON.stringify({ workingDirectory: workspaceRoot })],
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
                  load_skills: [],
                  run_in_background: true,
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

            // v2 投影会把同一条 tool 消息的 tool_call 与 tool_result 合并进
            // `content`（tool_call 在首位），因此必须按类型查找而不假定 `content[0]`。
            await waitFor(() => {
              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              const taskToolMessage = parentMessages.find((message) => message.role === 'tool');
              const taskToolPart = extractToolResultPart(taskToolMessage);
              const output = extractStructuredToolResultOutput(taskToolPart);
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
