import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  extractStructuredToolResultOutput,
  extractToolResultPart,
  isTaskToolOutput,
  readSingleTextMessage,
  createProtocolAwareStream,
  readFetchBody,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const EXPECTED_USER_FACING_ERROR = '模型服务内部错误，请稍后重试';

async function main(): Promise<void> {
  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_KEY: 'test-key',
      AI_API_BASE_URL: 'https://unit-test.invalid/v1',
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
    },
    async () => {
      await withMockFetch(
        async (_url, init) => {
          const body = await readFetchBody(_url, init);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes('以下是后台子代理已完成后自动回流到主对话的结果')) {
            return createProtocolAwareStream(_url, '我已收到失败的子代理结果，并同步回主对话。');
          }

          return new Response(JSON.stringify({ error: { message: '子代理上游失败' } }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        },
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
                  load_skills: [],
                  run_in_background: true,
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
                  upstreamRetryMaxRetries: 0,
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

            await waitFor(
              async () => {
                const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
                return graph.tasks[taskOutput.taskId]?.status === 'failed';
              },
              'delegated child task should propagate failed status to the parent task',
              240,
              50,
            );

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[taskOutput.taskId];
            assert(task?.status === 'failed', 'parent task should become failed');
            assert(
              task.errorMessage?.includes(EXPECTED_USER_FACING_ERROR) === true,
              'parent task should store the user-facing child error summary',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentToolMessage = parentMessages.find((message) => message.role === 'tool');
            const parentReminder = parentMessages.find((message) => {
              if (message.role !== 'assistant') {
                return false;
              }
              const text = readSingleTextMessage(message);
              return text.includes('子代理失败 · 让子代理触发失败');
            });
            assert(
              parentToolMessage?.role === 'tool',
              'parent session should persist a tool_result',
            );
            const toolPart = extractToolResultPart(parentToolMessage);
            assert(
              toolPart && toolPart.type === 'tool_result',
              'parent tool message should be tool_result',
            );
            const toolOutput = extractStructuredToolResultOutput(toolPart);
            assert(
              toolOutput?.['status'] === 'failed',
              'parent tool_result should mark failed status',
            );
            const errorMessage =
              typeof toolOutput['errorMessage'] === 'string' ? toolOutput['errorMessage'] : '';
            assert(
              errorMessage.includes(EXPECTED_USER_FACING_ERROR),
              'parent tool_result should expose the user-facing child error summary',
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
              reminderPayload.payload?.message?.includes(`错误：${EXPECTED_USER_FACING_ERROR}`) ===
                true,
              'failure reminder should include the user-facing error summary',
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
