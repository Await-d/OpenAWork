import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import type { MessageContent } from '@openAwork/shared';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { subscribeSessionRunEvents } from '../session/session-run-events.js';
import { reconcileSessionRuntime } from '../session/session-runtime-reconciler.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  createDelayedChatCompletionsStream,
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

function extractUpstreamReasoningEffort(body: unknown): string | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const record = body as Record<string, unknown>;
  if (typeof record['reasoning_effort'] === 'string') {
    return record['reasoning_effort'];
  }

  const reasoning = record['reasoning'];
  if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) {
    const thinking = record['thinking'];
    if (!thinking || typeof thinking !== 'object' || Array.isArray(thinking)) {
      return null;
    }

    const budgetTokens = (thinking as Record<string, unknown>)['budget_tokens'];
    if (budgetTokens === 1024) {
      return 'minimal';
    }
    if (budgetTokens === 4096) {
      return 'low';
    }
    if (budgetTokens === 8192) {
      return 'medium';
    }
    if (budgetTokens === 16000) {
      return 'high';
    }
    if (budgetTokens === 31999) {
      return 'xhigh';
    }

    return null;
  }

  return typeof (reasoning as Record<string, unknown>)['effort'] === 'string'
    ? ((reasoning as Record<string, unknown>)['effort'] as string)
    : null;
}

function extractToolResultPart(
  message: { content?: MessageContent[] } | undefined,
): Extract<MessageContent, { type: 'tool_result' }> | undefined {
  if (!Array.isArray(message?.content)) {
    return undefined;
  }

  return message.content.find(
    (part): part is Extract<MessageContent, { type: 'tool_result' }> => part.type === 'tool_result',
  );
}

function extractStructuredToolResultOutput(
  part: Extract<MessageContent, { type: 'tool_result' }> | undefined,
): Record<string, unknown> | null {
  if (!part?.output) {
    return null;
  }

  if (typeof part.output === 'string') {
    try {
      const parsed = JSON.parse(part.output) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return typeof part.output === 'object' ? (part.output as Record<string, unknown>) : null;
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
              `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'default_thinking', ?)`,
              [
                userId,
                JSON.stringify({
                  chat: { enabled: false, effort: 'medium' },
                  fast: { enabled: true, effort: 'high' },
                }),
              ],
            );
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
                    model: 'o3',
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
                typeof task?.result === 'string',
                'parent task should store a delegated child summary',
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
                Array.isArray(childMessages[1]?.content),
                'child session should persist a delegated assistant output message',
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
                  backgroundOutputResult.output.includes('Task Result'),
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
                typeof backgroundTaskOutput?.['result'] === 'string',
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
              assert(
                extractUpstreamReasoningEffort(upstreamBody) === 'high',
                'delegated child session should backfill the fast thinking default when the parent omitted it',
              );
              const visibleToolNames = Array.isArray(upstreamBody.tools)
                ? upstreamBody.tools
                    .map((tool) => tool.function?.name)
                    .filter((name): name is string => typeof name === 'string')
                : [];
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
              const parentTaskResultPart = extractToolResultPart(parentTaskResult);
              assert(
                parentTaskResultPart &&
                  typeof parentTaskResultPart === 'object' &&
                  parentTaskResultPart['type'] === 'tool_result',
                'parent session should store a task tool_result entry',
              );
              assert(
                parentTaskResult?.clientRequestId === parentTaskResultClientRequestId,
                'parent session tool_result should preserve the derived task tool clientRequestId',
              );
              const parentTaskResultContent:
                | Extract<MessageContent, { type: 'tool_result' }>
                | undefined =
                parentTaskResultPart?.type === 'tool_result' ? parentTaskResultPart : undefined;
              const parentTaskOutput = extractStructuredToolResultOutput(parentTaskResultContent);
              assert(
                parentTaskOutput?.['status'] === 'done',
                'parent session tool_result should be replaced with the terminal task status',
              );
              assert(
                typeof parentTaskOutput?.['result'] === 'string',
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
                typeof parentReminderPayload.payload?.message === 'string',
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
                Array.isArray(resumedChildMessages[3]?.content),
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

              const preservedResult = await sandbox.execute(
                {
                  toolCallId: 'task-call-3',
                  toolName: 'task',
                  rawInput: {
                    description: '让子代理保留显式思考设置',
                    prompt: '请给出保留后的最终结论',
                    subagent_type: 'explore',
                    load_skills: [],
                    run_in_background: true,
                  },
                },
                new AbortController().signal,
                parentSessionId,
                {
                  clientRequestId: 'parent-req-explicit',
                  nextRound: 2,
                  requestData: {
                    clientRequestId: 'parent-req-explicit',
                    message: '请再委派一个子代理',
                    model: 'o3',
                    maxTokens: 512,
                    reasoningEffort: 'low',
                    temperature: 1,
                    thinkingEnabled: true,
                    upstreamRetryMaxRetries: 1,
                    webSearchEnabled: false,
                  },
                },
              );
              assert(
                preservedResult.isError === false,
                'explicit-thinking task tool run should succeed',
              );
              if (!isTaskToolOutput(preservedResult.output)) {
                throw new Error('explicit-thinking task tool run should return structured output');
              }
              const preservedOutput = preservedResult.output;
              await waitFor(async () => {
                const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
                return graph.tasks[preservedOutput.taskId]?.status === 'completed';
              }, 'delegated child task with explicit thinking should complete automatically');

              const preservedUpstreamBody = JSON.parse(fetchCalls[2] ?? '{}');
              assert(
                extractUpstreamReasoningEffort(preservedUpstreamBody) === 'low',
                "delegated child session should preserve the parent's explicit thinking effort",
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
            'write',
            '/tmp/demo.txt',
            '需要写文件',
            'medium',
            JSON.stringify({ clientRequestId: 'permission-timeout-req-1' }),
            Date.now() - 1_000,
          ],
        );

        const reconciliation = await reconcileSessionRuntime({ sessionId: childSessionId, userId });
        assert(
          reconciliation.status === 'paused',
          '权限等待中的 child session 应继续保持 paused，不应自动超时',
        );

        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const refreshedTask = refreshedGraph.tasks[task.id];
        assert(refreshedTask?.status === 'running', '权限等待中的 child task 不应被自动终止');
        assert(
          refreshedTask?.errorMessage === undefined,
          '权限等待中的 child task 不应写入超时错误',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === undefined,
          '权限等待中的 child session 不应记录 terminalReason=timeout',
        );
        assert(
          parsedChildMetadata?.['timeoutSource'] === undefined,
          '权限等待中不应写入 timeoutSource',
        );

        const permissionStatus = sqliteGet<{ status: string; decision: string | null }>(
          'SELECT status, decision FROM permission_requests WHERE id = ? LIMIT 1',
          ['perm-timeout-1'],
        );
        assert(
          permissionStatus?.status === 'pending',
          '过期时间字段不应再自动把 permission request 收敛为 rejected',
        );
        assert(
          permissionStatus?.decision === null,
          '未处理的 permission request 不应自动写 decision',
        );
      } finally {
        await closeDb();
      }
    },
  );

  const startupActivityFetchCalls: string[] = [];
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_TASK_CHILD_FIRST_RESPONSE_TIMEOUT_MS: '50',
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          if (typeof init?.body === 'string') {
            startupActivityFetchCalls.push(init.body);
          }
          return createDelayedChatCompletionsStream({
            delayMs: 80,
            signal: init?.signal instanceof AbortSignal ? init.signal : undefined,
            text: '子代理启动后的最终结论。',
          });
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const email = `subagent-startup-activity-${userId}@openawork.local`;
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
                toolCallId: 'task-startup-activity-call-1',
                toolName: 'task',
                rawInput: {
                  description: '让子代理启动后延迟返回最终结论',
                  prompt: '请在短暂准备后给出最终结论',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-startup-activity-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-startup-activity-req-1',
                  message: '请委派一个启动后会稍晚才输出结论的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  upstreamRetryMaxRetries: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, '子代理启动活动场景的 task 启动应成功');
            assert(isTaskToolOutput(result.output), '子代理启动活动场景仍应返回结构化 task 输出');

            const output = result.output;

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return graph.tasks[output.taskId]?.status === 'completed';
            }, '子代理启动后不应再因延迟首包而误触发首响应超时');

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[output.taskId];
            assert(task?.status === 'completed', '子代理启动活动后父任务最终应完成');
            assert(typeof task?.result === 'string', '子代理启动活动后应产生可见任务结果');

            const childMetadata = sqliteGet<{ metadata_json: string }>(
              'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
              [output.sessionId, userId],
            );
            const parsedChildMetadata = childMetadata
              ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
              : null;
            assert(
              parsedChildMetadata?.['terminalReason'] !== 'timeout',
              '子代理启动活动后 child session 不应留下 timeout 终结原因',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentTaskResult = parentMessages.find((message) => message.role === 'tool');
            const parentTaskResultPart = extractToolResultPart(parentTaskResult);
            const parentTaskOutput = extractStructuredToolResultOutput(parentTaskResultPart);
            assert(parentTaskOutput?.['status'] === 'done', '父会话 tool_result 应反映成功终态');
            assert(
              parentTaskOutput?.['reason'] === undefined,
              '子代理启动活动场景成功后父会话 tool_result 不应残留 timeout reason',
            );
            assert(
              parentTaskOutput?.['timeoutSource'] === undefined,
              '非 timeout 的成功场景不应暴露 timeoutSource',
            );
            assert(
              startupActivityFetchCalls.length === 1,
              '子代理启动活动应阻止首响应超时重试，最终只发起一次 upstream 请求',
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
        assert(
          refreshedTask?.status === 'failed',
          '无活跃 runtime thread 的 child task 仍会被收敛为失败，但不应按 deadline 超时处理',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === undefined,
          '取消总 deadline 语义后，reconcile 不应再把 child session 标成 timeout',
        );
        assert(
          parsedChildMetadata?.['timeoutSource'] === undefined,
          '取消总 deadline 语义后，reconcile 不应写入 timeoutSource=deadline',
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
          reconciliation.status === 'paused',
          '问题等待中的 child session 应继续保持 paused，不应自动超时',
        );

        const refreshedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        const refreshedTask = refreshedGraph.tasks[task.id];
        assert(refreshedTask?.status === 'running', '问题等待中的 child task 不应被自动终止');
        assert(
          refreshedTask?.errorMessage === undefined,
          '问题等待中的 child task 不应写入超时错误',
        );

        const childMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [childSessionId, userId],
        );
        const parsedChildMetadata = childMetadata
          ? (JSON.parse(childMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(
          parsedChildMetadata?.['terminalReason'] === undefined,
          '问题等待中的 child session 不应记录 terminalReason=timeout',
        );
        assert(
          parsedChildMetadata?.['timeoutSource'] === undefined,
          '问题等待中不应写入 timeoutSource',
        );

        const questionStatus = sqliteGet<{ status: string }>(
          'SELECT status FROM question_requests WHERE id = ? LIMIT 1',
          ['question-timeout-1'],
        );
        assert(
          questionStatus?.status === 'pending',
          '未处理的 question request 应继续保持 pending',
        );
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
