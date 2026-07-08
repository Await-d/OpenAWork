import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import { resumeApprovedPermissionRequest } from '../routes/stream-runtime.js';
import {
  assert,
  extractStructuredToolResultOutput,
  extractToolResultPart,
  createChatCompletionsStream,
  readLastUserMessage,
  seedPendingToolCallConversation,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PendingPermissionRow {
  id: string;
  request_payload_json: string | null;
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
      OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
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

          return createChatCompletionsStream('审批恢复后的子代理结论');
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              join(WORKSPACE_ROOT, '.openawork.permissions.json'),
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `pending-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
              [parentSessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );

            const childSessionId = randomUUID();
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'idle')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-paused',
                  taskParentToolRequestId: 'parent-paused-req-1',
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '让子代理触发权限暂停后恢复',
              description: '权限恢复链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'pending-interaction-resume'],
            });
            await taskManager.save(graph);

            const sandbox = createDefaultSandbox();
            await seedPendingToolCallConversation({
              clientRequestId: 'child-paused-req-1',
              rawInput: { command: 'pwd' },
              sessionId: childSessionId,
              toolCallId: 'call_bash_1',
              toolName: 'bash',
              userId,
              userMessage: '请调用 bash 工具查看当前目录',
            });
            const pauseResult = await sandbox.execute(
              {
                toolCallId: 'call_bash_1',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-paused-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-paused-req-1',
                  message: '请调用 bash 工具查看当前目录',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                  workingDirectory: WORKSPACE_ROOT,
                },
              },
            );
            assert(
              typeof pauseResult.pendingPermissionRequestId === 'string',
              'bash tool should create a pending permission request',
            );
            const taskOutput = { taskId: task.id, sessionId: childSessionId };

            await waitFor(() => {
              const pendingPermission = sqliteGet<PendingPermissionRow>(
                `SELECT id, request_payload_json
                 FROM permission_requests
                 WHERE session_id = ? AND status = 'pending'
                 ORDER BY created_at DESC
                 LIMIT 1`,
                [taskOutput.sessionId],
              );
              return (
                typeof pendingPermission?.id === 'string' &&
                pendingPermission.request_payload_json !== null
              );
            }, 'child session should persist a pending permission request');

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

            const completedGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const completedTask = completedGraph.tasks[taskOutput.taskId];
            assert(
              completedTask?.status === 'completed',
              'parent task should complete after approval resume',
            );
            assert(
              completedTask.result === '审批恢复后的子代理结论',
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
