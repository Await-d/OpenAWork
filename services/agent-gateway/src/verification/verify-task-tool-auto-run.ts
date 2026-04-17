import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { MessageContent } from '@openAwork/shared';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message-v2-adapter.js';
import { subscribeSessionRunEvents } from '../session-run-events.js';
import { reconcileSessionRuntime } from '../session-runtime-reconciler.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  createDelayedChatCompletionsStream,
  createHangingChatCompletionsStream,
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

function stringifyAssertionValue(value: unknown): string {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return value.name.length > 0 ? `[Function: ${value.name}]` : '[Function]';
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
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
                  result.output.message.includes('Background task launched successfully.'),
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
              const parentTaskResultContent:
                | Extract<MessageContent, { type: 'tool_result' }>
                | undefined =
                parentTaskResultPart?.type === 'tool_result' ? parentTaskResultPart : undefined;
              const parentTaskOutput =
                parentTaskResultContent?.output &&
                typeof parentTaskResultContent.output === 'object'
                  ? (parentTaskResultContent.output as Record<string, unknown>)
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

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_PERMISSION_REQUEST_TIMEOUT_MS: '25',
    },
    async () => {
      await connectDb();
      await migrate();

      try {
        const userId = randomUUID();
        const parentSessionId = randomUUID();
        const childSessionId = randomUUID();
        const email = `subagent-permission-timeout-${userId}@openawork.local`;
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          email,
          'hash',
        ]);
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
          [parentSessionId, userId],
        );
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
          [
            childSessionId,
            userId,
            JSON.stringify({
              createdByTool: 'task',
              parentSessionId,
              subagentType: 'explore',
            }),
          ],
        );

        const taskManager = new AgentTaskManagerImpl();
        const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const task = taskManager.addTask(graph, {
          title: '等待权限的子代理',
          description: '等待权限批准',
          status: 'running',
          blockedBy: [],
          sessionId: childSessionId,
          assignedAgent: 'explore',
          priority: 'medium',
          tags: ['task-tool'],
        });
        await taskManager.save(graph);

        sqliteRun(
          `INSERT INTO permission_requests
            (id, session_id, tool_name, scope, reason, risk_level, request_payload_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            'perm-timeout-1',
            childSessionId,
            'write_file',
            '/tmp/demo.txt',
            '需要写文件',
            'medium',
            JSON.stringify({ clientRequestId: 'permission-timeout-req-1' }),
            Date.now() - 1_000,
          ],
        );

        const reconciliation = await reconcileSessionRuntime({ sessionId: childSessionId, userId });
        assert(
          reconciliation.status === 'idle',
          '权限超时后的 child session 应被 reconcile 为 idle',
        );

        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const refreshedTask = refreshedGraph.tasks[task.id];
        assert(refreshedTask?.status === 'failed', '权限超时后的 child task 应被收敛为 failed');
        assert(
          refreshedTask?.errorMessage === '子代理执行已超时，已被终止。',
          '权限超时后的 child task 应沿用 timeout 错误文案',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === 'timeout',
          '权限超时后的 child session 应记录 terminalReason=timeout',
        );

        const permissionStatus = sqliteGet<{ status: string; decision: string | null }>(
          'SELECT status, decision FROM permission_requests WHERE id = ? LIMIT 1',
          ['perm-timeout-1'],
        );
        assert(
          permissionStatus?.status === 'rejected',
          '过期 permission request 应收敛为 rejected',
        );
        assert(
          permissionStatus?.decision === 'reject',
          '过期 permission request 应带 reject decision',
        );
      } finally {
        await closeDb();
      }
    },
  );

  const timeoutFetchCalls: string[] = [];
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS: '25',
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          if (typeof init?.body === 'string') {
            timeoutFetchCalls.push(init.body);
          }
          return createHangingChatCompletionsStream(
            init?.signal instanceof AbortSignal ? init.signal : undefined,
          );
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const email = `subagent-timeout-${userId}@openawork.local`;
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
            const taskManager = new AgentTaskManagerImpl();
            const result = await sandbox.execute(
              {
                toolCallId: 'task-timeout-call-1',
                toolName: 'task',
                rawInput: {
                  description: '让子代理等待首条响应',
                  prompt: '请给出第一条响应',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-timeout-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-timeout-req-1',
                  message: '请委派一个会卡在首响应的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  upstreamRetryMaxRetries: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, '首响应超时场景的 task 启动应成功');
            assert(isTaskToolOutput(result.output), '首响应超时场景仍应返回结构化 task 输出');

            const output = result.output;

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return graph.tasks[output.taskId]?.status === 'failed';
            }, '首响应超时重试耗尽后，子代理任务应失败');

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[output.taskId];
            assert(task?.status === 'failed', '首响应超时重试耗尽后，父任务应标记 failed');
            assert(
              task?.errorMessage?.includes('首条响应在 25ms 内未返回') === true,
              '失败任务应记录首响应超时摘要',
            );

            const childMessages = listSessionMessages({ sessionId: output.sessionId, userId });
            assert(
              childMessages.length === 1,
              '首响应超时重试不应重复写入用户消息，也不应写入 assistant 消息',
            );
            assert(
              childMessages[0]?.role === 'user',
              '超时失败的 child session 只应保留首条 user 消息',
            );

            const childMetadata = sqliteGet<{ metadata_json: string }>(
              'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
              [output.sessionId, userId],
            );
            const parsedChildMetadata = childMetadata
              ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
              : null;
            assert(
              parsedChildMetadata?.['terminalReason'] === 'timeout',
              '首响应超时重试耗尽后应在 child session metadata 中记录 terminalReason=timeout',
            );

            const remainingRunEventCount =
              sqliteGet<{ count: number }>(
                `SELECT COUNT(1) AS count FROM session_run_events WHERE session_id = ? AND client_request_id = ?`,
                [output.sessionId, 'parent-timeout-req-1'],
              )?.count ?? 0;
            assert(
              remainingRunEventCount === 0,
              '首响应超时重试清理后不应残留被取消 attempt 的 child run events',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentTaskResult = parentMessages.find((message) => message.role === 'tool');
            const parentTaskResultPart = Array.isArray(parentTaskResult?.content)
              ? parentTaskResult.content[0]
              : undefined;
            const parentTaskResultContent:
              | Extract<MessageContent, { type: 'tool_result' }>
              | undefined =
              parentTaskResultPart?.type === 'tool_result' ? parentTaskResultPart : undefined;
            const parentTaskOutput =
              parentTaskResultContent?.output && typeof parentTaskResultContent.output === 'object'
                ? (parentTaskResultContent.output as Record<string, unknown>)
                : null;
            assert(
              parentTaskOutput?.['status'] === 'failed',
              '父会话的 task tool_result 应暴露 failed 终态',
            );
            assert(
              parentTaskOutput?.['reason'] === 'timeout',
              '父会话的 task tool_result 应保留 reason=timeout',
            );

            assert(
              timeoutFetchCalls.length === 2,
              '首响应超时应按 upstreamRetryMaxRetries=1 触发 2 次 child upstream 请求',
            );
          } finally {
            await closeDb();
          }
        },
      );
    },
  );

  const raceFetchCalls: string[] = [];
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS: '25',
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          if (typeof init?.body === 'string') {
            raceFetchCalls.push(init.body);
          }

          if (raceFetchCalls.length === 1) {
            return createDelayedChatCompletionsStream({
              delayMs: 40,
              ignoreAbort: true,
              signal: init?.signal instanceof AbortSignal ? init.signal : undefined,
              text: '第一次超时 attempt 的晚到内容。',
            });
          }

          return createChatCompletionsStream('第二次重试后的最终结论。');
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const email = `subagent-timeout-race-${userId}@openawork.local`;
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
            const taskManager = new AgentTaskManagerImpl();
            const result = await sandbox.execute(
              {
                toolCallId: 'task-timeout-race-call-1',
                toolName: 'task',
                rawInput: {
                  description: '让子代理跨过 timeout 边界后再返回首包',
                  prompt: '请给出最终结论',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-timeout-race-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-timeout-race-req-1',
                  message: '请委派一个会在超时边界后才返回首包的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  upstreamRetryMaxRetries: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, '边界 race 场景的 task 启动应成功');
            assert(isTaskToolOutput(result.output), '边界 race 场景仍应返回结构化 task 输出');

            const output = result.output;
            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return graph.tasks[output.taskId]?.status === 'completed';
            }, '边界 race 场景在清理旧 attempt 后应重试成功');

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[output.taskId];
            assert(
              task?.status === 'completed',
              '边界 race 场景最终应完成，而不是卡在 timeout failed',
            );

            const childMessages = listSessionMessages({ sessionId: output.sessionId, userId });
            assert(
              childMessages.length === 2,
              '边界 race 清理后 child session 应只保留 user + 最终 assistant',
            );
            assert(
              JSON.stringify(childMessages[0]?.content) ===
                JSON.stringify([{ type: 'text', text: '请给出最终结论' }]),
              '边界 race 场景应保留原始 child user prompt',
            );
            assert(
              JSON.stringify(childMessages[1]?.content) ===
                JSON.stringify([{ type: 'text', text: '第二次重试后的最终结论。' }]),
              '边界 race 清理后最终 assistant 内容应来自成功重试，而不是首个超时 attempt',
            );

            const transcript = JSON.stringify(childMessages);
            assert(
              transcript.includes('第一次超时 attempt 的晚到内容。') === false,
              '边界 race 清理后不应残留超时 attempt 的晚到 assistant 内容',
            );

            const childMetadata = sqliteGet<{ metadata_json: string }>(
              'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
              [output.sessionId, userId],
            );
            const parsedChildMetadata = childMetadata
              ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
              : null;
            assert(
              parsedChildMetadata?.['terminalReason'] !== 'timeout',
              '边界 race 在重试成功后不应把 timeout 终结原因残留到 child metadata',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentTaskResult = parentMessages.find((message) => message.role === 'tool');
            const parentTaskResultPart = Array.isArray(parentTaskResult?.content)
              ? parentTaskResult.content[0]
              : undefined;
            const parentTaskResultContent:
              | Extract<MessageContent, { type: 'tool_result' }>
              | undefined =
              parentTaskResultPart?.type === 'tool_result' ? parentTaskResultPart : undefined;
            const parentTaskOutput =
              parentTaskResultContent?.output && typeof parentTaskResultContent.output === 'object'
                ? (parentTaskResultContent.output as Record<string, unknown>)
                : null;
            assert(
              parentTaskOutput?.['status'] === 'done',
              '父会话 tool_result 应反映最终成功终态',
            );
            assert(
              parentTaskOutput?.['reason'] === undefined,
              '重试成功后父会话 tool_result 不应残留 timeout reason',
            );
            assert(
              stringifyAssertionValue(parentTaskOutput?.['result']).includes(
                '第二次重试后的最终结论。',
              ),
              '父会话 tool_result 应回流成功重试后的最终 child 摘要',
            );

            assert(
              raceFetchCalls.length === 2,
              '边界 race 场景应经历 1 次超时 attempt + 1 次成功重试',
            );
          } finally {
            await closeDb();
          }
        },
      );
    },
  );

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
    },
    async () => {
      await connectDb();
      await migrate();

      try {
        const userId = randomUUID();
        const parentSessionId = randomUUID();
        const childSessionId = randomUUID();
        const email = `subagent-timeout-reconcile-${userId}@openawork.local`;
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          email,
          'hash',
        ]);
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
          [parentSessionId, userId],
        );
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'running')`,
          [
            childSessionId,
            userId,
            JSON.stringify({
              createdByTool: 'task',
              parentSessionId,
              subagentType: 'explore',
              deadlineMs: Date.now() - 1_000,
            }),
          ],
        );

        const taskManager = new AgentTaskManagerImpl();
        const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const task = taskManager.addTask(graph, {
          title: '重启后待补偿的子代理',
          description: '等待 stale runtime reconcile',
          status: 'running',
          blockedBy: [],
          sessionId: childSessionId,
          assignedAgent: 'explore',
          priority: 'medium',
          tags: ['task-tool'],
        });
        await taskManager.save(graph);

        const reconciliation = await reconcileSessionRuntime({ sessionId: childSessionId, userId });
        assert(reconciliation.wasReset === true, '过期 child session 的 reconcile 应判定为 reset');
        assert(reconciliation.status === 'idle', '过期 child session 的 session 状态应收敛为 idle');

        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const refreshedTask = refreshedGraph.tasks[task.id];
        assert(refreshedTask?.status === 'failed', 'reconcile 后过期 child task 应标记为 failed');
        assert(
          refreshedTask?.errorMessage === '子代理执行已超时，已被终止。',
          'reconcile 后过期 child task 应保留 timeout 错误文案',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === 'timeout',
          'reconcile 后过期 child session 应写入 terminalReason=timeout',
        );
      } finally {
        await closeDb();
      }
    },
  );

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_QUESTION_REQUEST_TIMEOUT_MS: '25',
    },
    async () => {
      await connectDb();
      await migrate();

      try {
        const userId = randomUUID();
        const parentSessionId = randomUUID();
        const childSessionId = randomUUID();
        const email = `subagent-question-timeout-${userId}@openawork.local`;
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          email,
          'hash',
        ]);
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'idle')`,
          [parentSessionId, userId],
        );
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
          [
            childSessionId,
            userId,
            JSON.stringify({
              createdByTool: 'task',
              parentSessionId,
              subagentType: 'explore',
            }),
          ],
        );

        const taskManager = new AgentTaskManagerImpl();
        const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const task = taskManager.addTask(graph, {
          title: '等待问题回答的子代理',
          description: '等待用户回答问题',
          status: 'running',
          blockedBy: [],
          sessionId: childSessionId,
          assignedAgent: 'explore',
          priority: 'medium',
          tags: ['task-tool'],
        });
        await taskManager.save(graph);

        sqliteRun(
          `INSERT INTO question_requests
            (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            'question-timeout-1',
            childSessionId,
            userId,
            'question',
            '需要用户补充信息',
            JSON.stringify([{ question: '请确认目标环境？' }]),
            JSON.stringify({ clientRequestId: 'question-timeout-req-1' }),
            Date.now() - 1_000,
          ],
        );

        const reconciliation = await reconcileSessionRuntime({ sessionId: childSessionId, userId });
        assert(
          reconciliation.status === 'idle',
          '问题超时后的 child session 应被 reconcile 为 idle',
        );

        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const refreshedTask = refreshedGraph.tasks[task.id];
        assert(refreshedTask?.status === 'failed', '问题超时后的 child task 应被收敛为 failed');
        assert(
          refreshedTask?.errorMessage === '子代理执行已超时，已被终止。',
          '问题超时后的 child task 应沿用 timeout 错误文案',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === 'timeout',
          '问题超时后的 child session 应记录 terminalReason=timeout',
        );

        const questionStatus = sqliteGet<{ status: string }>(
          'SELECT status FROM question_requests WHERE id = ? LIMIT 1',
          ['question-timeout-1'],
        );
        assert(questionStatus?.status === 'dismissed', '过期 question request 应收敛为 dismissed');
      } finally {
        await closeDb();
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-auto-run: failed');
  console.error(error);
  process.exitCode = 1;
});
