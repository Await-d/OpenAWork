import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message-v2-adapter.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const CHILD_RESULT = '子代理已经执行完成。';
const AUTO_RESUME_RESULT = '我已收到子代理结果，并同步回主对话。';
const AUTO_RESUME_HEADER = '以下是后台子代理已完成后自动回流到主对话的结果';

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
    },
    async () => {
      await withMockFetch(
        (async (_url, init) => {
          const body = typeof init?.body === 'string' ? init.body : '';
          fetchCalls.push(body);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(AUTO_RESUME_HEADER)) {
            return createChatCompletionsStream(AUTO_RESUME_RESULT);
          }
          return createChatCompletionsStream(CHILD_RESULT);
        }) as typeof fetch,
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

            await waitFor(() => {
              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              return parentMessages.some(
                (message) =>
                  message.role === 'assistant' &&
                  readTextMessage(message as never) === AUTO_RESUME_RESULT,
              );
            }, 'parent session should receive the auto-resumed assistant reply');

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const autoResumeReply = parentMessages.find(
              (message) =>
                message.role === 'assistant' &&
                readTextMessage(message as never) === AUTO_RESUME_RESULT,
            );
            const completionReminder = parentMessages.find((message) => {
              if (message.role !== 'assistant') {
                return false;
              }
              const text = readTextMessage(message as never);
              return text.includes('子代理已完成 · 让子代理完成后自动回流');
            });

            assert(
              autoResumeReply?.role === 'assistant',
              'parent session should persist auto-resume reply',
            );
            assert(
              completionReminder?.role === 'assistant',
              'parent session should still keep the completion reminder alongside auto-resume',
            );
            assert(
              fetchCalls.length === 2,
              'auto-resume should trigger one child run and one parent continuation',
            );
            assert(
              readLastUserMessage(fetchCalls[1] ?? '').includes(AUTO_RESUME_HEADER),
              'second upstream request should be driven by the injected auto-resume message',
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
