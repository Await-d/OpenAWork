import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessages } from '../session-message-store.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const EXPECTED_ERROR_SUMMARY = 'Upstream request failed (500): 子代理上游失败';

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
            return createChatCompletionsStream('我已收到失败的子代理结果，并同步回主对话。');
          }

          return new Response(JSON.stringify({ error: { message: '子代理上游失败' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
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
              `failure-${userId}@openawork.local`,
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
                toolCallId: 'task-call-failure',
                toolName: 'task',
                rawInput: {
                  description: '让子代理触发失败',
                  prompt: '请执行一个会失败的子代理请求',
                  subagent_type: 'explore',
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-failure-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-failure-req-1',
                  message: '请委派一个会失败的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, 'task tool should still return a running task handle');
            assert(
              isTaskToolOutput(result.output),
              'task tool should return structured task output',
            );
            const taskOutput = result.output;

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return graph.tasks[taskOutput.taskId]?.status === 'failed';
            }, 'delegated child task should propagate failed status to the parent task');

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[taskOutput.taskId];
            assert(task?.status === 'failed', 'parent task should become failed');
            assert(
              task.errorMessage === EXPECTED_ERROR_SUMMARY,
              'parent task should store the extracted child error summary',
            );

            const childMessages = listSessionMessages({
              sessionId: taskOutput.sessionId,
              userId,
            });
            assert(
              childMessages.some(
                (message) =>
                  message.role === 'assistant' &&
                  readSingleTextMessage(
                    message as { content: Array<{ type: string; text?: string }> },
                  ) === `[错误: MODEL_ERROR] ${EXPECTED_ERROR_SUMMARY}`,
              ),
              'child session should persist the upstream failure as an assistant error message',
            );

            await waitFor(() => {
              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              return parentMessages.some(
                (message) =>
                  message.role === 'assistant' &&
                  readSingleTextMessage(
                    message as { content: Array<{ type: string; text?: string }> },
                  ) === '我已收到失败的子代理结果，并同步回主对话。',
              );
            }, 'parent session should still auto-run after a failed child task');

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentToolMessage = parentMessages.find((message) => message.role === 'tool');
            const parentReminder = parentMessages.find((message) => {
              if (message.role !== 'assistant') {
                return false;
              }
              const text = readSingleTextMessage(
                message as { content: Array<{ type: string; text?: string }> },
              );
              return text.includes('子代理失败 · 让子代理触发失败');
            });
            const parentSyntheticUser = parentMessages.find(
              (message) =>
                message.role === 'user' &&
                readSingleTextMessage(
                  message as { content: Array<{ type: string; text?: string }> },
                ).includes('- 状态：失败'),
            );

            assert(
              parentToolMessage?.role === 'tool',
              'parent session should persist a tool_result',
            );
            const toolPart = parentToolMessage?.content[0];
            assert(
              toolPart && toolPart.type === 'tool_result',
              'parent tool message should be tool_result',
            );
            const toolOutput =
              toolPart.output && typeof toolPart.output === 'object'
                ? (toolPart.output as Record<string, unknown>)
                : null;
            assert(
              toolOutput?.['status'] === 'failed',
              'parent tool_result should mark failed status',
            );
            assert(
              toolOutput?.['errorMessage'] === EXPECTED_ERROR_SUMMARY,
              'parent tool_result should expose the extracted child error summary',
            );

            const reminderText = readSingleTextMessage(
              parentReminder as { content: Array<{ type: string; text?: string }> },
            );
            const reminderPayload = JSON.parse(reminderText) as {
              payload?: { message?: string; status?: string; title?: string };
              type?: string;
            };
            assert(
              reminderPayload.type === 'assistant_event',
              'failure reminder should be assistant_event',
            );
            assert(
              reminderPayload.payload?.status === 'error',
              'failure reminder should be marked error',
            );
            assert(
              reminderPayload.payload?.message?.includes(`错误：${EXPECTED_ERROR_SUMMARY}`) ===
                true,
              'failure reminder should include the extracted error summary',
            );

            assert(
              parentSyntheticUser?.role === 'user',
              'parent session should inject a synthetic user summary for failed child tasks',
            );
            assert(
              readSingleTextMessage(
                parentSyntheticUser as { content: Array<{ type: string; text?: string }> },
              ).includes(`- 错误：\n${EXPECTED_ERROR_SUMMARY}`),
              'synthetic user summary should carry the extracted child error summary',
            );

            console.log('verify-task-tool-failure-propagation: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-failure-propagation: failed');
  console.error(error);
  process.exitCode = 1;
});
