import { randomUUID } from 'node:crypto';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { hasPendingSessionInteraction } from '../session/session-runtime-state.js';
import { tryResolveTaskPendingInteractionWithParent } from '../task/task-parent-auto-decision.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import {
  assert,
  createChatCompletionsStream,
  readLastUserMessage,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface PermissionRow {
  decision: string | null;
  status: string;
}

const DECISION_MARKER = '下级开发 agent 因工具权限请求暂停';
const APPROVED_RESULT = '父级已自动批准开发层权限，子代理继续完成。';
const REJECTED_RESULT = '父级已自动拒绝开发层权限，子代理改用替代方案完成。';

async function verifyParentPermissionDecisionErrorFallback(): Promise<void> {
  const permissionFile = join(WORKSPACE_ROOT, '.openawork.permissions.json');
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
          if (lastUserMessage.includes(DECISION_MARKER)) {
            throw new Error('simulated parent permission decision transport failure');
          }
          return createChatCompletionsStream(APPROVED_RESULT);
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              permissionFile,
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `parent-permission-error-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'idle')`,
              [parentSessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-parent-permission-error',
                  taskParentToolRequestId: 'parent-permission-error-req-1',
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级权限决策异常时回退',
              description: '父级权限自动决策异常回退链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-permission-error-fallback'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-permission-error-req-1',
                  message: '请委派子代理并在开发层权限出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const pauseResult = await sandbox.execute(
              {
                toolCallId: 'call_bash_parent_permission_error',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-parent-permission-error-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-parent-permission-error-req-1',
                  message: '请调用 bash 查看当前目录',
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
              'permission tool should create pending request before parent decision error',
            );

            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(
              resolvedByParent === false,
              'parent permission decision errors should fall back',
            );

            const permissionRow = sqliteGet<PermissionRow>(
              'SELECT status, decision FROM permission_requests WHERE id = ? AND session_id = ? LIMIT 1',
              [pauseResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              permissionRow?.status === 'pending',
              'parent permission decision error should release permission request back to pending',
            );
            const sessionRow = sqliteGet<{ state_status: string }>(
              'SELECT state_status FROM sessions WHERE id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              sessionRow?.state_status === 'paused',
              'parent permission decision error should preserve child session paused state for manual fallback',
            );
          } finally {
            if (existsSync(permissionFile)) {
              unlinkSync(permissionFile);
            }
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyLatePermissionDecisionFallback(): Promise<void> {
  const permissionFile = join(WORKSPACE_ROOT, '.openawork.permissions.json');
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
          if (lastUserMessage.includes(DECISION_MARKER)) {
            return createChatCompletionsStream(
              JSON.stringify({
                kind: 'permission',
                decision: 'approve',
                rationale: '晚到批准不应覆盖已拒绝权限。',
              }),
            );
          }
          return createChatCompletionsStream(APPROVED_RESULT);
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              permissionFile,
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `late-permission-decision-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'idle')`,
              [parentSessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-late-permission',
                  taskParentToolRequestId: 'parent-late-permission-req-1',
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '父级权限决策晚到时回退',
              description: '晚到权限决策不应覆盖已处理状态',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-permission-late'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-late-permission-req-1',
                  message: '请委派子代理并在开发层权限出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const pauseResult = await sandbox.execute(
              {
                toolCallId: 'call_bash_late_permission',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-late-permission-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-late-permission-req-1',
                  message: '请调用 bash 查看当前目录',
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
              'late permission scenario should create pending request first',
            );
            sqliteRun(
              `UPDATE permission_requests
               SET status = 'deciding'
               WHERE id = ? AND session_id = ?`,
              [pauseResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              hasPendingSessionInteraction(childSessionId),
              'deciding permission request should block session deletion/reconciliation as pending interaction',
            );
            sqliteRun(
              `UPDATE permission_requests
               SET updated_at = datetime('now', '-11 minutes')
               WHERE id = ? AND session_id = ?`,
              [pauseResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              hasPendingSessionInteraction(childSessionId),
              'stale deciding permission should be released to pending and still block as pending interaction',
            );
            const stalePermissionRow = sqliteGet<PermissionRow>(
              'SELECT status, decision FROM permission_requests WHERE id = ? AND session_id = ? LIMIT 1',
              [pauseResult.pendingPermissionRequestId, childSessionId],
            );
            assert(
              stalePermissionRow?.status === 'pending',
              'stale deciding permission should return to pending for manual fallback',
            );
            sqliteRun(
              `UPDATE permission_requests
               SET status = 'rejected', decision = 'reject'
               WHERE id = ? AND session_id = ?`,
              [pauseResult.pendingPermissionRequestId, childSessionId],
            );

            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent === false, 'late parent permission decision should fall back');

            const permissionRow = sqliteGet<PermissionRow>(
              'SELECT status, decision FROM permission_requests WHERE session_id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              permissionRow?.status === 'rejected' && permissionRow.decision === 'reject',
              'late parent permission decision should not overwrite existing rejection',
            );
          } finally {
            if (existsSync(permissionFile)) {
              unlinkSync(permissionFile);
            }
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyParentRejectsPermission(): Promise<void> {
  const permissionFile = join(WORKSPACE_ROOT, '.openawork.permissions.json');
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
        (async (_url, init) => {
          const body = typeof init?.body === 'string' ? init.body : '';
          fetchCalls.push(body);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(DECISION_MARKER)) {
            return createChatCompletionsStream(
              JSON.stringify({
                kind: 'permission',
                decision: 'reject',
                feedback: '请改用无需执行 shell 的只读分析。',
                rationale: '命令权限不应在该开发层自动放行。',
              }),
            );
          }
          return createChatCompletionsStream(REJECTED_RESULT);
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              permissionFile,
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `parent-permission-reject-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'idle')`,
              [parentSessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-parent-permission-reject',
                  taskParentToolRequestId: 'parent-permission-reject-req-1',
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '让父级自动拒绝子代理权限',
              description: '父级自动拒绝权限恢复链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-permission-reject'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-permission-reject-req-1',
                  message: '请委派子代理并在开发层权限出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const pauseResult = await sandbox.execute(
              {
                toolCallId: 'call_bash_parent_permission_reject',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-parent-permission-reject-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-parent-permission-reject-req-1',
                  message: '请调用 bash 查看当前目录',
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
              'bash tool should create a pending permission request before parent reject decision',
            );
            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent, 'parent AI should reject the child development permission');

            await waitFor(async () => {
              const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return nextGraph.tasks[task.id]?.status === 'completed';
            }, 'parent reject decision should resume child and complete with alternative result');

            const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            assert(
              nextGraph.tasks[task.id]?.result === REJECTED_RESULT,
              'parent permission rejection should persist resumed child result',
            );
            const permissionRow = sqliteGet<PermissionRow>(
              'SELECT status, decision FROM permission_requests WHERE session_id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              permissionRow?.status === 'rejected' && permissionRow.decision === 'reject',
              'permission request should be rejected by parent AI',
            );
            assert(
              fetchCalls.some((body) => readLastUserMessage(body).includes(DECISION_MARKER)),
              'parent AI should receive the structured development permission request before reject',
            );
          } finally {
            if (existsSync(permissionFile)) {
              unlinkSync(permissionFile);
            }
            await closeDb();
          }
        },
      );
    },
  );
}

async function main(): Promise<void> {
  const permissionFile = join(WORKSPACE_ROOT, '.openawork.permissions.json');
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
        (async (_url, init) => {
          const body = typeof init?.body === 'string' ? init.body : '';
          fetchCalls.push(body);
          const lastUserMessage = readLastUserMessage(body);
          if (lastUserMessage.includes(DECISION_MARKER)) {
            return createChatCompletionsStream(
              JSON.stringify({
                kind: 'permission',
                decision: 'approve',
                rationale: '只读 pwd 命令用于确认工作目录，可批准一次。',
              }),
            );
          }
          return createChatCompletionsStream(APPROVED_RESULT);
        }) as typeof fetch,
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              permissionFile,
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const userId = randomUUID();
            const parentSessionId = randomUUID();
            const childSessionId = randomUUID();

            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `parent-permission-${userId}@openawork.local`,
              'hash',
            ]);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'idle')`,
              [parentSessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status) VALUES (?, ?, '[]', ?, 'paused')`,
              [
                childSessionId,
                userId,
                JSON.stringify({
                  createdByTool: 'task',
                  parentSessionId,
                  requestedSkills: [],
                  subagentType: 'explore',
                  taskParentToolCallId: 'task-call-parent-permission',
                  taskParentToolRequestId: 'parent-permission-req-1',
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const taskManager = new AgentTaskManagerImpl();
            const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            const task = taskManager.addTask(graph, {
              title: '让父级自动决策子代理权限',
              description: '父级自动决策权限恢复链路',
              status: 'running',
              blockedBy: [],
              sessionId: childSessionId,
              assignedAgent: 'explore',
              priority: 'high',
              tags: ['task-tool', 'parent-auto-permission'],
            });
            await taskManager.save(graph);
            sqliteRun(
              `INSERT INTO task_parent_auto_resume_contexts
                (child_session_id, parent_session_id, user_id, task_id, request_data_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              [
                childSessionId,
                parentSessionId,
                userId,
                task.id,
                JSON.stringify({
                  clientRequestId: 'parent-permission-req-1',
                  message: '请委派子代理并在开发层权限出现时自行决策',
                  model: 'gpt-4o',
                  maxTokens: 512,
                  temperature: 1,
                  webSearchEnabled: false,
                  workingDirectory: WORKSPACE_ROOT,
                }),
              ],
            );

            const sandbox = createDefaultSandbox();
            const pauseResult = await sandbox.execute(
              {
                toolCallId: 'call_bash_parent_permission',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
              },
              new AbortController().signal,
              childSessionId,
              {
                clientRequestId: 'child-parent-permission-req-1',
                nextRound: 2,
                requestData: {
                  clientRequestId: 'child-parent-permission-req-1',
                  message: '请调用 bash 查看当前目录',
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
              'bash tool should create a pending permission request before parent auto-decision',
            );
            const resolvedByParent = await tryResolveTaskPendingInteractionWithParent({
              childSessionId,
              userId,
            });
            assert(resolvedByParent, 'parent AI should resolve the child development permission');

            await waitFor(async () => {
              const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
              return nextGraph.tasks[task.id]?.status === 'completed';
            }, 'parent auto-decision should approve permission and complete the task');

            const nextGraph = await taskManager.loadOrCreate(WORKSPACE_ROOT, parentSessionId);
            assert(
              nextGraph.tasks[task.id]?.result === APPROVED_RESULT,
              'parent auto-permission should persist resumed child result',
            );
            const permissionRow = sqliteGet<PermissionRow>(
              'SELECT status, decision FROM permission_requests WHERE session_id = ? LIMIT 1',
              [childSessionId],
            );
            assert(
              permissionRow?.decision === 'once' &&
                permissionRow.status !== 'pending' &&
                permissionRow.status !== 'rejected',
              'permission request should be approved once by parent AI and then consumed or completed',
            );
            assert(
              fetchCalls.some((body) => readLastUserMessage(body).includes(DECISION_MARKER)),
              'parent AI should receive the structured development permission request',
            );

            console.log('verify-task-tool-parent-auto-permission-decision: approve ok');
          } finally {
            if (existsSync(permissionFile)) {
              unlinkSync(permissionFile);
            }
            await closeDb();
          }
        },
      );
    },
  );

  await verifyParentPermissionDecisionErrorFallback();
  await verifyLatePermissionDecisionFallback();
  await verifyParentRejectsPermission();
  console.log('verify-task-tool-parent-auto-permission-decision: ok');
}

void main().catch((error) => {
  console.error('verify-task-tool-parent-auto-permission-decision: failed');
  console.error(error);
  process.exitCode = 1;
});
