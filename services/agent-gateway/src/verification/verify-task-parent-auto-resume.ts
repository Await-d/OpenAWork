import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  createProtocolAwareStream,
  readFetchBody,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const CHILD_RESULT = '子代理已经执行完成。';
const AUTO_RESUME_RESULT = '我已收到子代理结果，并同步回主对话。';
/**
 * 单通道交付（T-25）的唤醒请求由**合成通知**驱动，通知正文即子代理结果。
 * 旧路径（`buildAutoResumeMessage`）的固定表头已随伪造用户请求一并退役——
 * 这里改用通知正文作为「父会话侧上游请求」的判定标记。
 */
const NOTICE_BODY = CHILD_RESULT;

function readTextMessage(message: { content: Array<{ type: string; text?: string }> }): string {
  const firstContent = message.content[0];
  return firstContent?.type === 'text' && typeof firstContent.text === 'string'
    ? firstContent.text
    : '';
}

async function main(): Promise<void> {
  const fetchCalls: string[] = [];
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
          fetchCalls.push(body);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(NOTICE_BODY)) {
            return createProtocolAwareStream(_url, AUTO_RESUME_RESULT);
          }
          return createProtocolAwareStream(_url, CHILD_RESULT);
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `auto-resume-${userId}@openawork.local`,
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
                toolCallId: 'task-call-auto-resume',
                toolName: 'task',
                rawInput: {
                  description: '让子代理完成后自动回流',
                  prompt: '请先独立完成分析，然后回流主对话',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-auto-resume-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-auto-resume-req-1',
                  message: '请委派一个子代理并在完成后继续主对话',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, 'task tool should return a background task handle');

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return (
                graph.tasks[(result.output as { taskId: string }).taskId]?.status === 'completed'
              );
            }, 'delegated child task should complete before auto-resume');

            await waitFor(
              () => {
                const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
                return parentMessages.some(
                  (message) =>
                    message.role === 'assistant' && readTextMessage(message) === AUTO_RESUME_RESULT,
                );
              },
              'parent session should receive the auto-resumed assistant reply',
              240,
              50,
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const autoResumeReply = parentMessages.find(
              (message) =>
                message.role === 'assistant' &&
                readTextMessage(message as never) === AUTO_RESUME_RESULT,
            );
            assert(
              autoResumeReply?.role === 'assistant',
              'parent session should persist auto-resume reply',
            );
            assert(fetchCalls.length === 2, '单通道交付应触发一次子会话运行 + 一次父会话唤醒');
            assert(
              readLastUserMessage(fetchCalls[1] ?? '').includes(NOTICE_BODY),
              '第二次上游请求应由合成通知驱动（而非伪造的用户请求）',
            );

            // ── 单通道交付契约（T-25）──────────────────────────────────
            const notices = parentMessages.filter((message) => message.role === 'synthetic');
            assert(
              notices.length === 1,
              `父会话应恰好收到一条 synthetic 通知，实际 ${notices.length}`,
            );
            assert(
              readTextMessage(notices[0] ?? { content: [] }) === NOTICE_BODY,
              '通知正文应为子代理结果',
            );
            assert(
              !parentMessages.some((message) => message.role === 'user'),
              '单通道交付不得在父会话中伪造用户轮',
            );

            console.log('verify-task-parent-auto-resume: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-parent-auto-resume: failed');
  console.error(error);
  process.exitCode = 1;
});
