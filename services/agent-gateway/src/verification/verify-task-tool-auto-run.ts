import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessages } from '../session-message-store.js';
import { subscribeSessionRunEvents } from '../session-run-events.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

function isTaskToolOutput(value: unknown): value is {
  assignedAgent: string;
  message?: string;
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

async function main(): Promise<void> {
  const fetchCalls: string[] = [];
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          if (typeof init?.body === 'string') {
            fetchCalls.push(init.body);
          }
          return createChatCompletionsStream('子代理已经执行完成。');
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const email = `subagent-${userId}@openawork.local`;
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              email,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
              [parentSessionId, userId],
            );
            const sandbox = createDefaultSandbox();
            const events: Array<{
              clientRequestId?: string;
              toolCallId?: string;
              toolName?: string;
              type: string;
              status?: string;
              sessionId?: string;
              taskId?: string;
            }> = [];
            const unsubscribe = subscribeSessionRunEvents(parentSessionId, (event) => {
              events.push(
                event as { type: string; status?: string; sessionId?: string; taskId?: string },
              );
            });

            try {
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
                  clientRequestId: 'parent-req-1',
                  nextRound: 2,
                  requestData: {
                    clientRequestId: 'parent-req-1',
                    message: '请委派一个子代理',
                    model: 'gpt-4o',
                    maxTokens: 512,
                    temperature: 1,
                    upstreamRetryMaxRetries: 1,
                    webSearchEnabled: false,
                  },
                },
              );

              assert(result.isError === false, 'task tool should succeed');
              assert(
                result.pendingPermissionRequestId === undefined,
                'task tool should not emit pendingPermissionRequestId when subagents are allowed by default',
              );
              assert(isTaskToolOutput(result.output), 'task tool should return structured output');
              assert(result.output.status === 'running', 'task tool should report running output');
              assert(
                result.output.assignedAgent === 'explore',
                'task tool output should expose the delegated agent id',
              );
              assert(
                typeof result.output.message === 'string' &&
                  result.output.message.includes('Background task launched.'),
                'task tool output should expose a human-friendly launch message',
              );

              const output = result.output;
              const parentTaskResultClientRequestId = 'parent-req-1:tool:task-call-1';
              const taskManager = new AgentTaskManagerImpl();
              const permissionRequestCount =
                sqliteGet<{ count: number }>(
                  `SELECT COUNT(1) AS count
                   FROM permission_requests
                   WHERE session_id = ? AND tool_name = 'task'`,
                  [parentSessionId],
                )?.count ?? 0;
              assert(
                permissionRequestCount === 0,
                'task tool should not create permission_requests when subagents are allowed by default',
              );

              await waitFor(async () => {
                const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
                return graph.tasks[output.taskId]?.status === 'completed';
              }, 'delegated child task should complete automatically');

              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              const task = graph.tasks[output.taskId];
              assert(task?.status === 'completed', 'parent task should be marked completed');
              assert(
                task.result === '子代理已经执行完成。',
                'parent task should store child summary',
              );

              const childMessages = listSessionMessages({ sessionId: output.sessionId, userId });
              assert(
                childMessages.length === 2,
                'child session should contain user and assistant messages',
              );
              assert(
                childMessages[0]?.role === 'user',
                'child session first message should be user prompt',
              );
              assert(
                childMessages[1]?.role === 'assistant',
                'child session second message should be assistant result',
              );
              assert(
                JSON.stringify(childMessages[0]?.content) ===
                  JSON.stringify([{ type: 'text', text: '请给出最终结论' }]),
                'child session should persist delegated prompt',
              );
              assert(
                JSON.stringify(childMessages[1]?.content) ===
                  JSON.stringify([{ type: 'text', text: '子代理已经执行完成。' }]),
                'child session should persist delegated assistant output',
              );
              const initialChildMetadata = sqliteGet<{ metadata_json: string }>(
                'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
                [output.sessionId, userId],
              );
              const parsedInitialChildMetadata = initialChildMetadata
                ? (JSON.parse(initialChildMetadata.metadata_json) as Record<string, unknown>)
                : null;
              assert(
                parsedInitialChildMetadata?.['upstreamRetryMaxRetries'] === 1,
                'child session should inherit the parent upstream retry snapshot',
              );

              const backgroundOutputResult = await sandbox.execute(
                {
                  toolCallId: 'background-output-1',
                  toolName: 'background_output',
                  rawInput: { task_id: output.taskId },
                },
                new AbortController().signal,
                parentSessionId,
              );
              assert(backgroundOutputResult.isError === false, 'background_output should succeed');
              assert(
                typeof backgroundOutputResult.output === 'string' &&
                  backgroundOutputResult.output.includes('Task Result') &&
                  backgroundOutputResult.output.includes('子代理已经执行完成。'),
                'background_output should return a human-friendly result string by default',
              );

              const backgroundOutputFullSessionResult = await sandbox.execute(
                {
                  toolCallId: 'background-output-2',
                  toolName: 'background_output',
                  rawInput: { task_id: output.taskId, full_session: true },
                },
                new AbortController().signal,
                parentSessionId,
              );
              assert(
                backgroundOutputFullSessionResult.isError === false,
                'background_output with full_session should succeed',
              );
              const backgroundTaskOutput =
                backgroundOutputFullSessionResult.output &&
                typeof backgroundOutputFullSessionResult.output === 'object'
                  ? (backgroundOutputFullSessionResult.output as Record<string, unknown>)
                  : null;
              assert(
                backgroundTaskOutput?.['result'] === '子代理已经执行完成。',
                'background_output should expose delegated child summary',
              );
              assert(
                typeof backgroundTaskOutput?.['message'] === 'string' &&
                  String(backgroundTaskOutput['message']).includes('Task Result'),
                'background_output full_session should preserve the formatted message',
              );
              assert(
                backgroundTaskOutput?.['status'] === 'done',
                'background_output full_session should report done',
              );
              const upstreamBody = JSON.parse(fetchCalls[0] ?? '{}') as {
                tools?: Array<{ function?: { name?: string } }>;
              };
              const visibleToolNames = Array.isArray(upstreamBody.tools)
                ? upstreamBody.tools
                    .map((tool) => tool.function?.name)
                    .filter((name): name is string => typeof name === 'string')
                : [];
              assert(
                visibleToolNames.includes('read'),
                'delegated child session should still receive normal workspace tools',
              );
              assert(
                !visibleToolNames.includes('task'),
                'delegated child session should not expose task by default',
              );
              assert(
                !visibleToolNames.includes('question'),
                'delegated child session should not expose question by default',
              );

              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              const parentTaskResult = parentMessages.find((message) => message.role === 'tool');
              const parentCompletionReminder = parentMessages.find((message) => {
                if (message.role !== 'assistant') {
                  return false;
                }

                const firstContent = message.content[0];
                if (!firstContent || firstContent.type !== 'text') {
                  return false;
                }

                try {
                  const parsed = JSON.parse(firstContent.text) as {
                    payload?: { title?: string; message?: string; status?: string };
                    type?: string;
                  };
                  return (
                    parsed.type === 'assistant_event' &&
                    parsed.payload?.title === '子代理已完成 · 让子代理写出结论'
                  );
                } catch {
                  return false;
                }
              });
              assert(
                parentTaskResult?.role === 'tool',
                'parent session should persist the delegated tool result',
              );
              const parentTaskResultPart = Array.isArray(parentTaskResult?.content)
                ? parentTaskResult.content[0]
                : undefined;
              assert(
                parentTaskResultPart &&
                  typeof parentTaskResultPart === 'object' &&
                  parentTaskResultPart['type'] === 'tool_result',
                'parent session should store a task tool_result entry',
              );
              assert(
                parentTaskResultPart &&
                  typeof parentTaskResultPart === 'object' &&
                  parentTaskResultPart['clientRequestId'] === parentTaskResultClientRequestId,
                'parent session tool_result should preserve the derived task tool clientRequestId',
              );
              const parentTaskOutput =
                parentTaskResultPart &&
                typeof parentTaskResultPart === 'object' &&
                parentTaskResultPart['output'] &&
                typeof parentTaskResultPart['output'] === 'object'
                  ? (parentTaskResultPart['output'] as Record<string, unknown>)
                  : null;
              assert(
                parentTaskOutput?.['status'] === 'done',
                'parent session tool_result should be replaced with the terminal task status',
              );
              assert(
                parentTaskOutput?.['result'] === '子代理已经执行完成。',
                'parent session tool_result should expose the delegated child summary',
              );
              assert(
                typeof parentTaskOutput?.['message'] === 'string' &&
                  String(parentTaskOutput['message']).includes('<task_result>') &&
                  String(parentTaskOutput['message']).includes(`task_id: ${output.sessionId}`),
                'parent session tool_result should expose opencode-style task_result semantics',
              );
              const parentReminderText =
                parentCompletionReminder?.content[0]?.type === 'text'
                  ? parentCompletionReminder.content[0].text
                  : null;
              assert(
                parentReminderText !== null,
                'parent session should persist a visible assistant reminder when the child task completes',
              );
              const parentReminderPayload = JSON.parse(parentReminderText ?? '{}') as {
                payload?: { message?: string; status?: string; title?: string };
                type?: string;
              };
              assert(
                parentReminderPayload.type === 'assistant_event',
                'parent completion reminder should use assistant_event payload',
              );
              assert(
                parentReminderPayload.payload?.status === 'success',
                'parent completion reminder should mark successful child runs as success',
              );
              assert(
                parentReminderPayload.payload?.message?.includes('结果：子代理已经执行完成。') ===
                  true,
                'parent completion reminder should include the delegated child summary',
              );
              assert(
                parentReminderPayload.payload?.message?.includes(`会话：${output.sessionId}`) ===
                  true,
                'parent completion reminder should point back to the child session id',
              );
              assert(
                events.some(
                  (event) =>
                    event.type === 'tool_result' &&
                    event.toolCallId === 'task-call-1' &&
                    event.toolName === 'task' &&
                    event.clientRequestId === parentTaskResultClientRequestId,
                ),
                'parent session should publish a task tool_result run event with the same trace key',
              );
              const persistedToolResultRequestId =
                sqliteGet<{ client_request_id: string | null }>(
                  `SELECT client_request_id
                   FROM session_run_events
                   WHERE session_id = ? AND event_type = 'tool_result' AND client_request_id = ?
                   ORDER BY id DESC
                   LIMIT 1`,
                  [parentSessionId, parentTaskResultClientRequestId],
                )?.client_request_id ?? null;
              assert(
                persistedToolResultRequestId === parentTaskResultClientRequestId,
                'parent task tool_result should persist the same request-scoped key into session_run_events',
              );

              const resumedResult = await sandbox.execute(
                {
                  toolCallId: 'task-call-2',
                  toolName: 'task',
                  rawInput: {
                    description: '让子代理写出结论',
                    prompt: '请基于刚才的结果继续补充第二段结论',
                    subagent_type: 'explore',
                    load_skills: [],
                    run_in_background: true,
                    task_id: output.taskId,
                  },
                },
                new AbortController().signal,
                parentSessionId,
                {
                  clientRequestId: 'parent-req-2',
                  nextRound: 2,
                  requestData: {
                    clientRequestId: 'parent-req-2',
                    message: '请继续同一个子代理会话',
                    model: 'gpt-4o',
                    maxTokens: 512,
                    temperature: 1,
                    upstreamRetryMaxRetries: 2,
                    webSearchEnabled: false,
                  },
                },
              );

              assert(resumedResult.isError === false, 'task resume should succeed');
              assert(
                isTaskToolOutput(resumedResult.output),
                'task resume should return structured output',
              );
              assert(
                resumedResult.output.taskId === output.taskId,
                'task resume should reuse the existing task id',
              );
              assert(
                resumedResult.output.sessionId === output.sessionId,
                'task resume should reuse the existing child session id',
              );

              await waitFor(async () => {
                const resumedGraph = await taskManager.loadOrCreate(
                  WORKSPACE_ROOT,
                  parentSessionId,
                );
                const resumedTask = resumedGraph.tasks[output.taskId];
                return (
                  resumedTask?.updatedAt !== task.updatedAt && resumedTask?.status === 'completed'
                );
              }, 'resumed delegated child task should complete again');

              const resumedChildMessages = listSessionMessages({
                sessionId: output.sessionId,
                userId,
              });
              assert(
                resumedChildMessages.length === 4,
                'resumed child session should append a new user/assistant exchange',
              );
              assert(
                JSON.stringify(resumedChildMessages[2]?.content) ===
                  JSON.stringify([{ type: 'text', text: '请基于刚才的结果继续补充第二段结论' }]),
                'task resume should persist the new delegated prompt into the same child session',
              );
              assert(
                JSON.stringify(resumedChildMessages[3]?.content) ===
                  JSON.stringify([{ type: 'text', text: '子代理已经执行完成。' }]),
                'task resume should persist the follow-up assistant output into the same child session',
              );
              const resumedChildMetadata = sqliteGet<{ metadata_json: string }>(
                'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
                [output.sessionId, userId],
              );
              const parsedResumedChildMetadata = resumedChildMetadata
                ? (JSON.parse(resumedChildMetadata.metadata_json) as Record<string, unknown>)
                : null;
              assert(
                parsedResumedChildMetadata?.['upstreamRetryMaxRetries'] === 2,
                'resumed child session should refresh to the latest parent retry snapshot',
              );
              assert(
                fetchCalls.length === 2,
                'task resume should issue a second child upstream request',
              );

              assert(
                events.some(
                  (event) => event.type === 'session_child' && event.sessionId === output.sessionId,
                ),
                'parent session should emit session_child event',
              );
              assert(
                events.some(
                  (event) =>
                    event.type === 'task_update' &&
                    event.taskId === output.taskId &&
                    event.status === 'in_progress',
                ),
                'parent session should emit in_progress task update',
              );
              assert(
                events.some(
                  (event) =>
                    event.type === 'task_update' &&
                    event.taskId === output.taskId &&
                    event.status === 'done',
                ),
                'parent session should emit done task update',
              );

              console.log('verify-task-tool-auto-run: ok');
            } finally {
              unsubscribe();
            }
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-auto-run: failed');
  console.error(error);
  process.exitCode = 1;
});
