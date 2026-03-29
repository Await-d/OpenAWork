import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessages } from '../session-message-store.js';
import { subscribeSessionRunEvents } from '../session-run-events.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  clearInFlightStreamRequest,
  registerInFlightStreamRequest,
} from '../routes/stream-cancellation.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

function readSingleTextMessage(message: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const firstContent = message.content[0];
  return firstContent?.type === 'text' && typeof firstContent.text === 'string'
    ? firstContent.text
    : '';
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
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
            const lastUserMessage = readLastUserMessage(init.body);
            if (lastUserMessage.includes('以下是后台子代理已完成后自动回流到主对话的结果')) {
              return createChatCompletionsStream('我已收到子代理结果，并同步回主对话。');
            }
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

              const output = result.output;
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

              await waitFor(() => {
                const latestParentMessages = listSessionMessages({
                  sessionId: parentSessionId,
                  userId,
                });
                return latestParentMessages.some(
                  (message) =>
                    message.role === 'user' &&
                    readSingleTextMessage(
                      message as { content: Array<{ type: string; text?: string }> },
                    ).includes('以下是后台子代理已完成后自动回流到主对话的结果'),
                );
              }, 'parent session should receive an auto-resume synthetic user message');

              await waitFor(() => {
                const latestParentMessages = listSessionMessages({
                  sessionId: parentSessionId,
                  userId,
                });
                return latestParentMessages.some(
                  (message) =>
                    message.role === 'assistant' &&
                    readSingleTextMessage(
                      message as { content: Array<{ type: string; text?: string }> },
                    ) === '我已收到子代理结果，并同步回主对话。',
                );
              }, 'parent session should auto-run and persist a follow-up assistant reply');

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

              assert(
                fetchCalls.length >= 2,
                'delegated child completion should also trigger a parent auto-resume upstream request',
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
              const parentAutoResumeUserMessage = parentMessages.find(
                (message) =>
                  message.role === 'user' &&
                  readSingleTextMessage(
                    message as { content: Array<{ type: string; text?: string }> },
                  ).includes('以下是后台子代理已完成后自动回流到主对话的结果'),
              );
              const parentAutoResumeAssistantMessage = parentMessages.find(
                (message) =>
                  message.role === 'assistant' &&
                  readSingleTextMessage(
                    message as { content: Array<{ type: string; text?: string }> },
                  ) === '我已收到子代理结果，并同步回主对话。',
              );
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
                parentAutoResumeUserMessage?.role === 'user',
                'parent session should persist the synthetic auto-resume user message',
              );
              assert(
                readSingleTextMessage(
                  parentAutoResumeUserMessage as {
                    content: Array<{ type: string; text?: string }>;
                  },
                ).includes(`- 会话：${output.sessionId}`),
                'auto-resume user message should include the child session reference',
              );
              assert(
                parentAutoResumeAssistantMessage?.role === 'assistant',
                'parent session should persist the assistant reply created by the auto-resume run',
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

              const busyParentSessionId = randomUUID();
              sqliteRun(
                `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', '{}')`,
                [busyParentSessionId, userId],
              );
              const busyExecution = createDeferred<{ statusCode: number }>();
              registerInFlightStreamRequest({
                abortController: new AbortController(),
                clientRequestId: 'busy-parent-request',
                execution: busyExecution.promise,
                sessionId: busyParentSessionId,
                userId,
              });

              const busyTaskResult = await sandbox.execute(
                {
                  toolCallId: 'task-call-busy',
                  toolName: 'task',
                  rawInput: {
                    description: '验证父会话忙碌时自动重试',
                    prompt: '请给出需要重试场景的子代理结论',
                    subagent_type: 'explore',
                  },
                },
                new AbortController().signal,
                busyParentSessionId,
                {
                  clientRequestId: 'busy-parent-source-req',
                  nextRound: 2,
                  requestData: {
                    clientRequestId: 'busy-parent-source-req',
                    message: '请委派一个会在父会话忙碌时回流的子代理',
                    model: 'gpt-4o',
                    maxTokens: 512,
                    temperature: 1,
                    webSearchEnabled: false,
                  },
                },
              );
              assert(
                isTaskToolOutput(busyTaskResult.output),
                'busy-retry task should return structured task output',
              );
              const busyTaskOutput = busyTaskResult.output;

              await waitFor(async () => {
                const busyGraph = await taskManager.loadOrCreate(
                  WORKSPACE_ROOT,
                  busyParentSessionId,
                );
                return busyGraph.tasks[busyTaskOutput.taskId]?.status === 'completed';
              }, 'busy parent child task should still complete');

              await new Promise((resolve) => setTimeout(resolve, 900));
              const busyParentMessagesBeforeDrain = listSessionMessages({
                sessionId: busyParentSessionId,
                userId,
              });
              assert(
                !busyParentMessagesBeforeDrain.some(
                  (message) =>
                    message.role === 'user' &&
                    readSingleTextMessage(
                      message as { content: Array<{ type: string; text?: string }> },
                    ).includes('以下是后台子代理已完成后自动回流到主对话的结果'),
                ),
                'auto-resume should wait while the parent session is busy',
              );

              busyExecution.resolve({ statusCode: 200 });
              clearInFlightStreamRequest({
                clientRequestId: 'busy-parent-request',
                execution: busyExecution.promise,
                sessionId: busyParentSessionId,
              });

              await waitFor(() => {
                const busyParentMessages = listSessionMessages({
                  sessionId: busyParentSessionId,
                  userId,
                });
                return busyParentMessages.some(
                  (message) =>
                    message.role === 'assistant' &&
                    readSingleTextMessage(
                      message as { content: Array<{ type: string; text?: string }> },
                    ) === '我已收到子代理结果，并同步回主对话。',
                );
              }, 'auto-resume should retry after the parent session becomes idle');

              const resumedResult = await sandbox.execute(
                {
                  toolCallId: 'task-call-2',
                  toolName: 'task',
                  rawInput: {
                    description: '让子代理写出结论',
                    prompt: '请基于刚才的结果继续补充第二段结论',
                    subagent_type: 'explore',
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
              const resumedFetchCount = fetchCalls.filter(() => true).length;
              assert(resumedFetchCount >= 2, 'task resume should issue a second upstream request');

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
