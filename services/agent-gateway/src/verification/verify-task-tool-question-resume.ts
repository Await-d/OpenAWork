import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { listSessionMessages } from '../session-message-store.js';
import { upsertTaskParentAutoResumeContext } from '../task-parent-auto-resume.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import { formatAnsweredQuestionOutput } from '../question-tools.js';
import type { QuestionToolInput } from '../question-tools.js';
import { resumeAnsweredQuestionRequest } from '../routes/stream.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PendingQuestionRow {
  id: string;
  questions_json: string;
  request_payload_json: string | null;
}

function readSingleTextMessage(message: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const firstContent = message.content[0];
  return firstContent?.type === 'text' && typeof firstContent.text === 'string'
    ? firstContent.text
    : '';
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
            return createChatCompletionsStream('我已收到问题恢复后的子代理结果，并同步回主对话。');
          }

          return createChatCompletionsStream('问题恢复后的子代理结论');
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `question-${userId}@openawork.local`,
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
                  questionToolEnabled: true,
                  requestedSkills: ['dummy-skill'],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-question',
                  taskParentToolRequestId: 'parent-question-req-1',
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '让子代理先提问再继续',
              description: '问题恢复链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'question-resume'],
            });
            await taskManager.save(graph);

            upsertTaskParentAutoResumeContext({
              childSessionId,
              parentSessionId,
              requestData: {
                clientRequestId: 'parent-question-req-1',
                message: '请在子代理问题得到回答后继续主会话',
                model: 'gpt-4o',
                maxTokens: 512,
                temperature: 1,
                webSearchEnabled: false,
              },
              taskId: task.id,
              userId,
            });

            const sandbox = createDefaultSandbox();
            const questionResult = await sandbox.execute(
              {
                toolCallId: 'question-call-1',
                toolName: 'question',
                rawInput: {
                  questions: [
                    {
                      header: '选择目录',
                      question: '请选择要查看的目录',
                      options: [
                        { label: 'workspace', description: '查看工作目录' },
                        { label: 'home', description: '查看主目录' },
                      ],
                    },
                  ],
                },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-question-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-question-req-1',
                  message: '请先问我一个问题再继续',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(
              typeof questionResult.pendingPermissionRequestId === 'string',
              'question tool should create a pending question request',
            );

            const pendingQuestion = sqliteGet<PendingQuestionRow>(
              `SELECT id, questions_json, request_payload_json
               FROM question_requests
               WHERE session_id = ? AND status = 'pending'
               ORDER BY created_at DESC
               LIMIT 1`,
              [childSessionId],
            );
            assert(pendingQuestion?.id, 'child session should persist a pending question request');
            assert(
              pendingQuestion.request_payload_json !== null,
              'pending question request should persist its resume payload',
            );

            const parsedPayload = JSON.parse(pendingQuestion.request_payload_json ?? '{}') as {
              clientRequestId?: string;
              nextRound?: number;
              rawInput?: Record<string, unknown>;
              requestData?: Record<string, unknown>;
              toolCallId?: string;
            };
            const questions = JSON.parse(
              pendingQuestion.questions_json,
            ) as QuestionToolInput['questions'];
            const answerOutput = formatAnsweredQuestionOutput({
              questions,
              answers: [['workspace']],
            });

            await resumeAnsweredQuestionRequest({
              payload: {
                clientRequestId: parsedPayload.clientRequestId ?? 'child-question-req-1',
                nextRound: parsedPayload.nextRound ?? 2,
                rawInput: parsedPayload.rawInput ?? {},
                requestData: parsedPayload.requestData ?? {
                  clientRequestId: 'child-question-req-1',
                  message: '请先问我一个问题再继续',
                  model: 'gpt-4o',
                },
                toolCallId: parsedPayload.toolCallId ?? 'question-call-1',
                toolName: 'question',
              },
              answerOutput,
              sessionId: childSessionId,
              userId,
            });

            await waitFor(async () => {
              const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return nextGraph.tasks[task.id]?.status === 'completed';
            }, 'question resume should eventually complete the parent task');

            const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const nextTask = nextGraph.tasks[task.id];
            assert(
              nextTask?.status === 'completed',
              'parent task should complete after question resume',
            );
            assert(
              nextTask.result === '问题恢复后的子代理结论',
              'parent task should store the resumed child summary after question answer',
            );

            await waitFor(() => {
              const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
              return parentMessages.some(
                (message) =>
                  message.role === 'assistant' &&
                  readSingleTextMessage(
                    message as { content: Array<{ type: string; text?: string }> },
                  ) === '我已收到问题恢复后的子代理结果，并同步回主对话。',
              );
            }, 'parent session should auto-resume after question answer resume');

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentToolMessage = parentMessages.find((message) => message.role === 'tool');
            const toolPart = parentToolMessage?.content[0];
            assert(toolPart && toolPart.type === 'tool_result', 'parent tool message should exist');
            const toolOutput =
              toolPart.output && typeof toolPart.output === 'object'
                ? (toolPart.output as Record<string, unknown>)
                : null;
            assert(
              toolOutput?.['status'] === 'done',
              'question resume should converge parent tool_result',
            );
            assert(
              toolOutput?.['result'] === '问题恢复后的子代理结论',
              'question resume should propagate resumed child summary into parent tool_result',
            );

            console.log('verify-task-tool-question-resume: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-question-resume: failed');
  console.error(error);
  process.exitCode = 1;
});
