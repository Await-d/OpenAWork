import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessages } from '../session-message-store.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import { resumeApprovedPermissionRequest } from '../routes/stream-runtime.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PendingPermissionRow {
  id: string;
  request_payload_json: string | null;
}

function isTaskToolOutput(value: unknown): value is {
  assignedAgent: string;
  sessionId: string;
  status: 'pending' | 'running';
  taskId: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['assignedAgent'] === 'string' &&
    typeof candidate['taskId'] === 'string' &&
    typeof candidate['sessionId'] === 'string' &&
    (candidate['status'] === 'pending' || candidate['status'] === 'running')
  );
}

function createChatToolCallStream(input: {
  argsJson: string;
  toolCallId: string;
  toolName: string;
}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            [
              `data: ${JSON.stringify({
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: input.toolCallId,
                          function: {
                            name: input.toolName,
                            arguments: input.argsJson,
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
              })}`,
              '',
              'data: [DONE]',
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

function hasToolResultInChatRequest(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{ role?: string; tool_call_id?: string }>;
    };
    return (parsed.messages ?? []).some(
      (message) => message.role === 'tool' && typeof message.tool_call_id === 'string',
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          const body = typeof init?.body === 'string' ? init.body : '';
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes('以下是后台子代理已完成后自动回流到主对话的结果')) {
            return createChatCompletionsStream('我已收到审批恢复后的子代理结果，并同步回主对话。');
          }

          if (hasToolResultInChatRequest(body)) {
            return createChatCompletionsStream('审批恢复后的子代理结论');
          }

          return createChatToolCallStream({
            argsJson: JSON.stringify({ command: 'pwd' }),
            toolCallId: 'call_bash_1',
            toolName: 'bash',
          });
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `pending-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
              [parentSessionId, userId],
            );

            const sandbox = createDefaultSandbox();
            const taskManager = new AgentTaskManagerImpl();
            const result = await sandbox.execute(
              {
                toolCallId: 'task-call-paused',
                toolName: 'task',
                rawInput: {
                  description: '让子代理触发权限暂停后恢复',
                  prompt: '请尝试调用 bash 工具查看当前目录',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-paused-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-paused-req-1',
                  message: '请委派一个会先触发权限暂停再继续的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, 'task tool should still return a task handle');
            assert(isTaskToolOutput(result.output), 'task tool should return structured output');
            const taskOutput = result.output;

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              const task = graph.tasks[taskOutput.taskId];
              return task?.status === 'running';
            }, 'parent task should remain running after child permission pause');

            await waitFor(() => {
              const childSessionState = sqliteGet<{ state_status: string }>(
                'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
                [taskOutput.sessionId, userId],
              );
              const pendingPermission = sqliteGet<PendingPermissionRow>(
                `SELECT id, request_payload_json
                 FROM permission_requests
                 WHERE session_id = ? AND status = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [taskOutput.sessionId],
              );
              return (
                childSessionState?.state_status === 'paused' &&
                typeof pendingPermission?.id === 'string' &&
                pendingPermission.request_payload_json !== null
              );
            }, 'child session should settle into paused state with a pending permission request');

            const pendingPermission = sqliteGet<PendingPermissionRow>(
              `SELECT id, request_payload_json
               FROM permission_requests
               WHERE session_id = ? AND status = 'pending'
               ORDER BY created_at DESC
               LIMIT 1`,
              [taskOutput.sessionId],
            );
            assert(
              pendingPermission?.id,
              'child session should create a pending permission request',
            );
            assert(
              pendingPermission.request_payload_json !== null,
              'pending permission request should persist its resume payload',
            );
            sqliteRun(
              `UPDATE permission_requests
               SET status = 'approved', decision = 'once', updated_at = datetime('now')
               WHERE id = ?`,
              [pendingPermission.id],
            );

            const parsedPayload = JSON.parse(pendingPermission.request_payload_json ?? '{}') as {
              clientRequestId?: string;
              nextRound?: number;
              rawInput?: Record<string, unknown>;
              requestData?: Record<string, unknown>;
              toolCallId?: string;
            };
            assert(
              typeof parsedPayload.clientRequestId === 'string' &&
                typeof parsedPayload.nextRound === 'number' &&
                typeof parsedPayload.toolCallId === 'string' &&
                parsedPayload.rawInput &&
                typeof parsedPayload.rawInput === 'object' &&
                parsedPayload.requestData &&
                typeof parsedPayload.requestData === 'object',
              'pending permission request should persist a complete resume payload',
            );

            await resumeApprovedPermissionRequest({
              payload: {
                clientRequestId: parsedPayload.clientRequestId,
                nextRound: parsedPayload.nextRound,
                rawInput: parsedPayload.rawInput,
                requestData: parsedPayload.requestData,
                toolCallId: parsedPayload.toolCallId,
                toolName: 'bash',
              },
              sessionId: taskOutput.sessionId,
              userId,
            });

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return graph.tasks[taskOutput.taskId]?.status === 'completed';
            }, 'resumed child task should eventually complete the parent task');

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[taskOutput.taskId];
            assert(
              task?.status === 'completed',
              'parent task should complete after approval resume',
            );
            assert(
              task.result === '审批恢复后的子代理结论',
              'parent task should store the resumed child summary',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentToolMessage = parentMessages.find((message) => message.role === 'tool');
            const toolPart = parentToolMessage?.content[0];
            assert(toolPart && toolPart.type === 'tool_result', 'parent tool message should exist');
            const toolOutput =
              toolPart.output && typeof toolPart.output === 'object'
                ? (toolPart.output as Record<string, unknown>)
                : null;
            assert(toolOutput?.['status'] === 'done', 'parent tool_result should converge to done');
            assert(
              toolOutput?.['result'] === '审批恢复后的子代理结论',
              'parent tool_result should expose the resumed child summary',
            );

            console.log('verify-task-tool-pending-interaction-resume: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-pending-interaction-resume: failed');
  console.error(error);
  process.exitCode = 1;
});
