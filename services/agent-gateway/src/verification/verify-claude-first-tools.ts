import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import authPlugin from '../infra/auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import requestWorkflowPlugin from '../runtime/request-workflow.js';
import { questionsRoutes } from '../routes/questions.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { createDefaultSandbox } from '../tools/tool-sandbox.js';
import { AgentTaskManagerImpl } from '@openAwork/agent-core';
import {
  assert,
  createProtocolAwareStream,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

interface QuestionRequestRow {
  id: string;
  questions_json: string;
  request_payload_json: string | null;
  tool_name: string;
}

interface SessionMetadataRow {
  metadata_json: string;
}

function readOutputText(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
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
        async (url) => createProtocolAwareStream(url, 'Claude-first Agent 子代理已完成。'),
        async () => {
          await connectDb();
          await migrate();

          const app = Fastify();
          await app.register(websocket);
          await app.register(requestWorkflowPlugin);
          await app.register(authPlugin);
          await app.register(sessionsRoutes);
          await app.register(questionsRoutes);
          await app.register(streamRoutes);
          await app.ready();

          try {
            const userId = randomUUID();
            const email = `claude-first-${userId}@openawork.local`;
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              email,
              'hash',
            ]);

            const accessToken = app.jwt.sign({ sub: userId, email });
            const sessionId = randomUUID();
            sqliteRun(
              // yolo 档位：本脚本关注 Claude-first 工具契约（Agent 工具），
              // 委派免审批（权限门控由 verify-task-tool-permission-gate.ts 专门验收）。
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
               VALUES (?, ?, '[]', ?, 'idle')`,
              [sessionId, userId, JSON.stringify({ permissionMode: 'yolo' })],
            );

            const sandbox = createDefaultSandbox();

            await verifyAskUserQuestion({ sandbox, sessionId, userId });
            await verifyPlanMode({ app, accessToken, sandbox, sessionId, userId });
            await verifyAgent({ sandbox, sessionId, userId });

            console.log('verify-claude-first-tools: ok');
          } finally {
            await app.close();
            await closeDb();
          }
        },
      );
    },
  );
}

async function verifyAskUserQuestion(input: {
  sandbox: ReturnType<typeof createDefaultSandbox>;
  sessionId: string;
  userId: string;
}): Promise<void> {
  const result = await input.sandbox.execute(
    {
      toolCallId: 'question-call-claude',
      toolName: 'AskUserQuestion',
      rawInput: {
        questions: [
          {
            question: '请选择继续方式',
            header: '执行策略',
            multiSelect: false,
            options: [
              { label: '继续', description: '继续执行', preview: '<b>继续</b>' },
              { label: '暂停', description: '暂停执行' },
            ],
          },
        ],
      },
    },
    new AbortController().signal,
    input.sessionId,
    {
      clientRequestId: 'claude-question-req',
      nextRound: 2,
      requestData: {
        clientRequestId: 'claude-question-req',
        message: '请先问我一个问题',
        model: 'gpt-4o',
        maxTokens: 512,
        temperature: 1,
        webSearchEnabled: false,
      },
    },
  );

  assert(
    typeof result.pendingPermissionRequestId === 'string',
    'AskUserQuestion should create a pending question request',
  );

  const row = sqliteGet<QuestionRequestRow>(
    `SELECT id, tool_name, questions_json, request_payload_json
     FROM question_requests
     WHERE session_id = ? AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.sessionId],
  );
  assert(row?.id, 'AskUserQuestion should persist a pending question row');
  assert(
    row.tool_name === 'question',
    'AskUserQuestion should still execute through canonical question',
  );

  const payload = JSON.parse(row.request_payload_json ?? '{}') as {
    observability?: Record<string, unknown>;
  };
  assert(
    payload.observability?.['presentedToolName'] === 'AskUserQuestion',
    'AskUserQuestion pending payload should preserve presentedToolName',
  );
  assert(
    payload.observability?.['canonicalToolName'] === 'question',
    'AskUserQuestion pending payload should preserve canonicalToolName',
  );
  assert(
    payload.observability?.['canonicalToolName'] !== undefined,
    'AskUserQuestion pending payload should preserve canonicalToolName',
  );
}

async function verifyPlanMode(input: {
  app: FastifyInstance;
  accessToken: string;
  sandbox: ReturnType<typeof createDefaultSandbox>;
  sessionId: string;
  userId: string;
}): Promise<void> {
  const enterResult = await input.sandbox.execute(
    {
      toolCallId: 'enter-plan-call',
      toolName: 'EnterPlanMode',
      rawInput: {},
    },
    new AbortController().signal,
    input.sessionId,
  );
  assert(enterResult.isError === false, 'EnterPlanMode should succeed');

  const afterEnter = sqliteGet<SessionMetadataRow>(
    'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
    [input.sessionId],
  );
  const enterMetadata = JSON.parse(afterEnter?.metadata_json ?? '{}') as Record<string, unknown>;
  assert(
    enterMetadata['planMode'] === true,
    'EnterPlanMode should enable planMode in session metadata',
  );

  const exitResult = await input.sandbox.execute(
    {
      toolCallId: 'exit-plan-call',
      toolName: 'ExitPlanMode',
      rawInput: {
        plan: '1. 查看能力\n2. 开始实现',
      },
    },
    new AbortController().signal,
    input.sessionId,
    {
      clientRequestId: 'claude-plan-req',
      nextRound: 3,
      requestData: {
        clientRequestId: 'claude-plan-req',
        message: '请退出规划模式',
        model: 'gpt-4o',
        maxTokens: 512,
        temperature: 1,
        webSearchEnabled: false,
      },
    },
  );
  assert(
    typeof exitResult.pendingPermissionRequestId === 'string',
    'ExitPlanMode should create a pending approval request',
  );

  const pending = sqliteGet<QuestionRequestRow>(
    `SELECT id, tool_name, questions_json, request_payload_json
     FROM question_requests
     WHERE session_id = ? AND tool_name = 'ExitPlanMode' AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.sessionId],
  );
  assert(pending?.id, 'ExitPlanMode should persist a pending ExitPlanMode question request');
  const pendingPayload = JSON.parse(pending.request_payload_json ?? '{}') as {
    observability?: Record<string, unknown>;
  };
  assert(
    pendingPayload.observability?.['presentedToolName'] === 'ExitPlanMode',
    'ExitPlanMode payload should preserve presentedToolName',
  );
  assert(
    pendingPayload.observability?.['canonicalToolName'] === 'ExitPlanMode',
    'ExitPlanMode payload should preserve canonicalToolName',
  );

  const reply = await input.app.inject({
    method: 'POST',
    url: `/sessions/${input.sessionId}/questions/reply`,
    headers: { authorization: `Bearer ${input.accessToken}` },
    payload: {
      requestId: pending.id,
      status: 'answered',
      answers: [['Start implementation']],
    },
  });
  assert(reply.statusCode === 200, 'answering ExitPlanMode request should succeed');

  await waitFor(() => {
    const session = sqliteGet<SessionMetadataRow>(
      'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
      [input.sessionId],
    );
    const metadata = JSON.parse(session?.metadata_json ?? '{}') as Record<string, unknown>;
    return metadata['planMode'] === false;
  }, 'ExitPlanMode approval should clear planMode state');
}

async function verifyAgent(input: {
  sandbox: ReturnType<typeof createDefaultSandbox>;
  sessionId: string;
  userId: string;
}): Promise<void> {
  const result = await input.sandbox.execute(
    {
      toolCallId: 'agent-call-1',
      toolName: 'Agent',
      rawInput: {
        description: '让子代理给出结论',
        prompt: '请给出最终结论',
        subagent_type: 'explore',
        run_in_background: true,
      },
    },
    new AbortController().signal,
    input.sessionId,
    {
      clientRequestId: 'claude-agent-req',
      nextRound: 2,
      requestData: {
        clientRequestId: 'claude-agent-req',
        message: '请委派一个 Agent',
        model: 'gpt-4o',
        maxTokens: 512,
        temperature: 1,
        webSearchEnabled: false,
      },
    },
  );

  assert(result.isError === false, 'Agent tool should succeed');
  // 261102 批次 B（T-18）：`Agent` 呈报名经输入适配层归一为规范名 `subagent`，输出
  // 形态随之收敛到 `task` 工具的结构化输出（`taskId` / `sessionId` / `status`），
  // 不再使用已删除的 `call_omo_agent` 文本摘要。
  const backgroundOutput = result.output as {
    taskId?: unknown;
    sessionId?: unknown;
    status?: unknown;
    message?: unknown;
  };
  assert(
    typeof backgroundOutput === 'object' && backgroundOutput !== null,
    'Agent tool should return the structured subagent output',
  );
  assert(
    typeof backgroundOutput.taskId === 'string' && backgroundOutput.taskId.length > 0,
    'Agent output should include the delegated task id',
  );
  assert(
    typeof backgroundOutput.sessionId === 'string' && backgroundOutput.sessionId.length > 0,
    'Agent output should include the delegated child session id',
  );
  assert(
    backgroundOutput.status === 'running',
    'Agent output should report the delegated task as running',
  );
  assert(
    readOutputText(backgroundOutput.message).includes('explore'),
    'Agent output should include the delegated agent label',
  );
  const taskId = backgroundOutput.taskId;

  const taskManager = new AgentTaskManagerImpl();
  await waitFor(async () => {
    const graph = await taskManager.loadOrCreate(WORKSPACE_ROOT, input.sessionId);
    return graph.tasks[taskId]?.status === 'completed';
  }, 'Agent delegated task should complete automatically');

  const syncResult = await input.sandbox.execute(
    {
      toolCallId: 'agent-call-2',
      toolName: 'Agent',
      rawInput: {
        description: '让子代理同步返回结论',
        prompt: '请给出最终结论',
        subagent_type: 'explore',
        run_in_background: false,
      },
    },
    new AbortController().signal,
    input.sessionId,
    {
      clientRequestId: 'claude-agent-req-sync',
      nextRound: 2,
      requestData: {
        clientRequestId: 'claude-agent-req-sync',
        message: '请同步委派一个 Agent',
        model: 'gpt-4o',
        maxTokens: 512,
        temperature: 1,
        webSearchEnabled: false,
      },
    },
  );

  assert(syncResult.isError === false, 'sync Agent tool should succeed');
  // 261102 批次 B（T-18）：同步委派同样收敛到 `subagent`/task 的结构化输出，
  // 子会话终态文本（`<subagent sessionID="…">` 包裹 + `task_id:` 提示）落在
  // 输出的 `message` 字段中。
  const syncOutput = syncResult.output as {
    message?: unknown;
    sessionId?: unknown;
    status?: unknown;
    taskId?: unknown;
  };
  assert(
    typeof syncOutput === 'object' && syncOutput !== null,
    'sync Agent tool should return the structured subagent output',
  );
  const syncMessage = readOutputText(syncOutput.message);
  assert(
    syncMessage.includes('Claude-first Agent 子代理已完成。'),
    'sync Agent output should include the delegated child content',
  );
  assert(
    syncMessage.includes('<subagent sessionID="'),
    'sync Agent output should use the opencode subagent result wrapper',
  );
  assert(
    syncMessage.includes('task_id:'),
    'sync Agent output should include the delegated session id task_id hint',
  );
}

void main().catch((error) => {
  console.error('verify-claude-first-tools: failed');
  console.error(error);
  process.exitCode = 1;
});
