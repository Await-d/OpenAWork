import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import { resumeApprovedPermissionRequest } from '../routes/stream-runtime.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PendingPermissionRow {
  id: string;
  request_payload_json: string | null;
}

function extractToolResultPart(
  message: { content?: Array<{ type: string; output?: unknown }> } | undefined,
): { type: 'tool_result'; output?: unknown } | undefined {
  if (!Array.isArray(message?.content)) {
    return undefined;
  }

  const part = message.content.find((item) => item.type === 'tool_result');
  return part && part.type === 'tool_result'
    ? (part as { type: 'tool_result'; output?: unknown })
    : undefined;
}

function extractStructuredToolResultOutput(
  part: { type: 'tool_result'; output?: unknown } | undefined,
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

function createChatToolCallStream(input: {
  argsJson: string;
  toolCallId: string;
  toolName: string;
}): Response {
  const encoder = new TextEncoder();
  const openAiFrames = [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: input.toolCallId,
                function: {
                  name: input.toolName,
                  arguments: input.argsJson,
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })}`,
    '',
    'data: [DONE]',
    '',
  ];
  const anthropicFrames = [
    'event: message_start',
    `data: ${JSON.stringify({
      type: 'message_start',
      message: { id: 'msg_mock_tool', usage: { input_tokens: 0, output_tokens: 0 } },
    })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: {
        type: 'tool_use',
        id: input.toolCallId,
        name: input.toolName,
        input: {},
      },
    })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'input_json_delta', partial_json: input.argsJson },
    })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'tool_use' },
      usage: { output_tokens: 1 },
    })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: 'message_stop' })}`,
    '',
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([...openAiFrames, ...anthropicFrames].join('\n')));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function hasToolResultInChatRequest(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{
        content?: Array<{ type?: string }> | string;
        role?: string;
        tool_call_id?: string;
      }>;
    };
    return (parsed.messages ?? []).some(
      (message) =>
        (message.role === 'tool' && typeof message.tool_call_id === 'string') ||
        (Array.isArray(message.content) &&
          message.content.some((part) => part.type === 'tool_result')),
    );
  } catch {
    return false;
  }
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
            return createChatCompletionsStream('我已收到审批恢复后的子代理结果，并同步回主对话。');
          }

          if (hasToolResultInChatRequest(body)) {
            return createChatCompletionsStream('审批恢复后的子代理结论');
          }

          return createChatToolCallStream({
            argsJson: JSON.stringify({ command: 'pwd' }),
            toolCallId: 'call_bash_1',
            toolName: 'bash',
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
              `pending-${userId}@openawork.local`,
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
                toolCallId: 'task-call-paused',
                toolName: 'task',
                rawInput: {
                  description: '让子代理触发权限暂停后恢复',
                  prompt: '请尝试调用 bash 工具查看当前目录',
                  subagent_type: 'explore',
                  load_skills: [],
                  run_in_background: true,
                },
              },
              new AbortController().signal,
              parentSessionId,
              {
                clientRequestId: 'parent-paused-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'parent-paused-req-1',
                  message: '请委派一个会先触发权限暂停再继续的子代理',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                },
              },
            );

            assert(result.isError === false, 'task tool should still return a task handle');
            assert(isTaskToolOutput(result.output), 'task tool should return structured output');
            const taskOutput = result.output;

            await waitFor(async () => {
              const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              const task = graph.tasks[taskOutput.taskId];
              return task?.status === 'running';
            }, 'parent task should remain running after child permission pause');

            await waitFor(() => {
              const childSessionState = sqliteGet<{ state_status: string }>(
                'SELECT state_status FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
                [taskOutput.sessionId, userId],
              );
              const pendingPermission = sqliteGet<PendingPermissionRow>(
                `SELECT id, request_payload_json
                 FROM permission_requests
                 WHERE session_id = ? AND status = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [taskOutput.sessionId],
              );
              return (
                childSessionState?.state_status === 'paused' &&
                typeof pendingPermission?.id === 'string' &&
                pendingPermission.request_payload_json !== null
              );
            }, 'child session should settle into paused state with a pending permission request');

            const pendingPermission = sqliteGet<PendingPermissionRow>(
              `SELECT id, request_payload_json
               FROM permission_requests
               WHERE session_id = ? AND status = 'pending'
               ORDER BY created_at DESC
               LIMIT 1`,
              [taskOutput.sessionId],
            );
            assert(
              pendingPermission?.id,
              'child session should create a pending permission request',
            );
            assert(
              pendingPermission.request_payload_json !== null,
              'pending permission request should persist its resume payload',
            );
            sqliteRun(
              `UPDATE permission_requests
               SET status = 'approved', decision = 'once', updated_at = datetime('now')
               WHERE id = ?`,
              [pendingPermission.id],
            );

            const parsedPayload = JSON.parse(pendingPermission.request_payload_json ?? '{}') as {
              clientRequestId?: string;
              nextRound?: number;
              rawInput?: Record<string, unknown>;
              requestData?: Record<string, unknown>;
              toolCallId?: string;
            };
            assert(
              typeof parsedPayload.clientRequestId === 'string' &&
                typeof parsedPayload.nextRound === 'number' &&
                typeof parsedPayload.toolCallId === 'string' &&
                parsedPayload.rawInput &&
                typeof parsedPayload.rawInput === 'object' &&
                parsedPayload.requestData &&
                typeof parsedPayload.requestData === 'object',
              'pending permission request should persist a complete resume payload',
            );

            await resumeApprovedPermissionRequest({
              payload: {
                clientRequestId: parsedPayload.clientRequestId,
                nextRound: parsedPayload.nextRound,
                rawInput: parsedPayload.rawInput,
                requestData: parsedPayload.requestData,
                toolCallId: parsedPayload.toolCallId,
                toolName: 'bash',
              },
              sessionId: taskOutput.sessionId,
              userId,
            });

            await waitFor(
              async () => {
                const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
                return graph.tasks[taskOutput.taskId]?.status === 'completed';
              },
              'resumed child task should eventually complete the parent task',
              600,
              50,
            );

            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = graph.tasks[taskOutput.taskId];
            assert(
              task?.status === 'completed',
              'parent task should complete after approval resume',
            );
            assert(
              task.result === '审批恢复后的子代理结论',
              'parent task should store the resumed child summary',
            );

            const parentMessages = listSessionMessages({ sessionId: parentSessionId, userId });
            const parentToolMessage = parentMessages.find((message) => message.role === 'tool');
            const toolPart = extractToolResultPart(parentToolMessage);
            assert(toolPart && toolPart.type === 'tool_result', 'parent tool message should exist');
            const toolOutput = extractStructuredToolResultOutput(toolPart);
            assert(toolOutput?.['status'] === 'done', 'parent tool_result should converge to done');
            assert(
              toolOutput?.['result'] === '审批恢复后的子代理结论',
              'parent tool_result should expose the resumed child summary',
            );

            console.log('verify-task-tool-pending-interaction-resume: ok');
          } finally {
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-tool-pending-interaction-resume: failed');
  console.error(error);
  process.exitCode = 1;
});
