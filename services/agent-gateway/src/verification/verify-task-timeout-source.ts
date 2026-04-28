import { randomUUID } from 'node:crypto';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../db.js';
import { reconcileSessionRuntime } from '../session-runtime-reconciler.js';
import { createDefaultSandbox } from '../tool-sandbox.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

function extractToolOutput(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function createParentAndChildTask(input: {
  childSessionId: string;
  parentSessionId: string;
  title: string;
  userId: string;
}) {
  const taskManager = new AgentTaskManagerImpl();
  const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, input.parentSessionId);
  const task = taskManager.addTask(graph, {
    title: input.title,
    description: input.title,
    status: 'running',
    blockedBy: [],
    sessionId: input.childSessionId,
    assignedAgent: 'explore',
    priority: 'medium',
    tags: ['task-tool'],
  });
  await taskManager.save(graph);
  return { task, taskManager };
}

async function main(): Promise<void> {
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
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          `timeout-source-${userId}@openawork.local`,
          'hash',
        ]);
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
           VALUES (?, ?, '[]', '{}', 'idle')`,
          [parentSessionId, userId],
        );

        const sandbox = createDefaultSandbox();

        const permissionChildSessionId = randomUUID();
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
           VALUES (?, ?, '[]', ?, 'paused')`,
          [
            permissionChildSessionId,
            userId,
            JSON.stringify({ createdByTool: 'task', parentSessionId, subagentType: 'explore' }),
          ],
        );
        const { task: permissionTask, taskManager } = await createParentAndChildTask({
          childSessionId: permissionChildSessionId,
          parentSessionId,
          title: '等待权限的子代理',
          userId,
        });
        sqliteRun(
          `INSERT INTO permission_requests
            (id, session_id, tool_name, scope, reason, risk_level, request_payload_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            'perm-timeout-source-1',
            permissionChildSessionId,
            'write',
            '/tmp/demo.txt',
            '需要写文件',
            'medium',
            JSON.stringify({ clientRequestId: 'perm-timeout-source-req-1' }),
            Date.now() - 1_000,
          ],
        );
        const permissionReconciliation = await reconcileSessionRuntime({
          sessionId: permissionChildSessionId,
          userId,
        });
        assert(
          permissionReconciliation.status === 'paused',
          '权限等待中的 child session 不应因过期时间字段自动超时',
        );
        const refreshedPermissionGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        assert(
          refreshedPermissionGraph.tasks[permissionTask.id]?.status === 'running',
          '权限等待中的 child task 应继续保持 running',
        );
        const permissionMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [permissionChildSessionId, userId],
        );
        const parsedPermissionMetadata = permissionMetadata
          ? (JSON.parse(permissionMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(parsedPermissionMetadata?.['terminalReason'] === undefined, '权限等待中不应写 terminalReason');
        assert(parsedPermissionMetadata?.['timeoutSource'] === undefined, '权限等待中不应写 timeoutSource');
        const permissionStatus = sqliteGet<{ status: string; decision: string | null }>(
          'SELECT status, decision FROM permission_requests WHERE id = ? LIMIT 1',
          ['perm-timeout-source-1'],
        );
        assert(permissionStatus?.status === 'pending', 'permission request 应继续保持 pending');
        assert(permissionStatus?.decision === null, 'permission request 不应自动写 decision');
        const permissionBackgroundOutput = await sandbox.execute(
          {
            toolCallId: 'permission-timeout-source-background-output',
            toolName: 'background_output',
            rawInput: { task_id: permissionTask.id, full_session: true },
          },
          new AbortController().signal,
          parentSessionId,
        );
        const permissionOutput = extractToolOutput(permissionBackgroundOutput.output);
        assert(permissionOutput?.['timeoutSource'] === undefined, 'background_output 不应暴露已移除的 legacy timeoutSource');

        const questionChildSessionId = randomUUID();
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
           VALUES (?, ?, '[]', ?, 'paused')`,
          [
            questionChildSessionId,
            userId,
            JSON.stringify({ createdByTool: 'task', parentSessionId, subagentType: 'explore' }),
          ],
        );
        const { task: questionTask } = await createParentAndChildTask({
          childSessionId: questionChildSessionId,
          parentSessionId,
          title: '等待回答的子代理',
          userId,
        });
        sqliteRun(
          `INSERT INTO question_requests
            (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, expires_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [
            'question-timeout-source-1',
            questionChildSessionId,
            userId,
            'question',
            '确认环境',
            JSON.stringify([{ question: '请确认目标环境？' }]),
            JSON.stringify({ clientRequestId: 'question-timeout-source-req-1' }),
            Date.now() - 1_000,
          ],
        );
        const questionReconciliation = await reconcileSessionRuntime({
          sessionId: questionChildSessionId,
          userId,
        });
        assert(
          questionReconciliation.status === 'paused',
          '问题等待中的 child session 不应因过期时间字段自动超时',
        );
        const refreshedQuestionGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
        assert(
          refreshedQuestionGraph.tasks[questionTask.id]?.status === 'running',
          '问题等待中的 child task 应继续保持 running',
        );
        const questionMetadata = sqliteGet<{ metadata_json: string }>(
          'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [questionChildSessionId, userId],
        );
        const parsedQuestionMetadata = questionMetadata
          ? (JSON.parse(questionMetadata.metadata_json) as Record<string, unknown>)
          : null;
        assert(parsedQuestionMetadata?.['terminalReason'] === undefined, '问题等待中不应写 terminalReason');
        assert(parsedQuestionMetadata?.['timeoutSource'] === undefined, '问题等待中不应写 timeoutSource');
        const questionStatus = sqliteGet<{ status: string }>(
          'SELECT status FROM question_requests WHERE id = ? LIMIT 1',
          ['question-timeout-source-1'],
        );
        assert(questionStatus?.status === 'pending', 'question request 应继续保持 pending');
        const questionBackgroundOutput = await sandbox.execute(
          {
            toolCallId: 'question-timeout-source-background-output',
            toolName: 'background_output',
            rawInput: { task_id: questionTask.id, full_session: true },
          },
          new AbortController().signal,
          parentSessionId,
        );
        const questionOutput = extractToolOutput(questionBackgroundOutput.output);
        assert(questionOutput?.['timeoutSource'] === undefined, 'background_output 不应暴露已移除的 legacy timeoutSource');

        console.log('verify-task-timeout-source: ok');
      } finally {
        await closeDb();
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-task-timeout-source: failed');
  console.error(error);
  process.exitCode = 1;
});
