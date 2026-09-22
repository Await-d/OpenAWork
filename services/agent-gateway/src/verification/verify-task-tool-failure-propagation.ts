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
              // 父会话置为**非空闲**：本脚本关注的是「子代理失败向上传播」，与唤醒无关。
              // 若父会话空闲，子代理结算会**同步唤醒**父会话（单通道交付，见
              // `task/task-job-delivery.ts`），其后台流会与脚本收尾竞态——脚本关库后
              // 该流仍在 flush 运行事件 → `Database has closed` → 退出码 1（断言其实已全过）。
              // 非空闲时唤醒按设计「留库待消费」（通知照常注入，断言不受影响），
              // 与 `verify-task-tool-auto-run.ts` 的既有隔离手法一致。
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', '{}', 'paused')`,
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
            // 完成提示现由**合成通知**承载（T-27 已移除 assistant_event 卡片生产者）。
            const parentNotice = parentMessages.find((message) => message.role === 'synthetic');
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

            const noticeText = readSingleTextMessage(
              parentNotice as { content: Array<{ type: string; text?: string }> },
            );
            assert(
              noticeText.includes(EXPECTED_USER_FACING_ERROR),
              'failure notice should include the user-facing error summary',
            );
            assert(
              parentNotice?.metadata?.['state'] === 'failed',
              'failure notice metadata should mark failed state',
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
