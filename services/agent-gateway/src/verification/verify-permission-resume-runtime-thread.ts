/**
 * 权限批准后的「运行线程即时可见」契约。
 *
 * 背景：批准权限后，续跑会先执行被批准的工具（可能持续数秒），期间已经在发布
 * `terminal_*` / `tool_result` 事件；`/stream/active`（以及 `/status` 的
 * activeStream 投影）依赖**运行线程**（`session_runtime_threads`）才能报告活跃流。
 * 若运行线程要等工具执行完、模型轮开始时才注册，客户端在批准后约 100ms 发起的
 * attach 会拿到「无活跃流」并放弃重试，续跑输出在界面上永远接不上——表现为
 * 「批准后卡住，要整页刷新才看到结果」。
 *
 * 本脚本断言：`resumeApprovedPermissionRequest` 一进入执行阶段就注册运行线程，
 * 且在被批准的工具仍在执行时（`terminal_exited` 落库之前）该线程即可见。
 */
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendSessionMessageV2 } from '../message/message-v2-adapter.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { executeToolCalls } from '../routes/stream.js';
import { resumeApprovedPermissionRequest } from '../routes/stream-runtime.js';
import { getFreshSessionRuntimeThread } from '../session/session-runtime-thread-store.js';
import {
  assert,
  createChatCompletionsStream,
  readFetchBody,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const CLIENT_REQUEST_ID = 'resume-thread-req-1';
const SLOW_COMMAND = 'sleep 1.5 && echo slow-ok';
const TOOL_CALL_ID = 'call-slow-bash';

function configureOpenAIProvider(userId: string): void {
  const now = new Date().toISOString();
  const providerConfig = [
    {
      id: 'openai',
      type: 'openai',
      name: 'OpenAI',
      enabled: true,
      baseUrl: 'https://unit-test.invalid/v1',
      apiKey: 'test-key',
      upstreamProtocol: 'chat_completions',
      defaultModels: [{ id: 'gpt-4o', label: 'GPT-4o', enabled: true }],
      createdAt: now,
      updatedAt: now,
    },
  ];
  const activeSelection = {
    chat: { providerId: 'openai', modelId: 'gpt-4o' },
    fast: { providerId: 'openai', modelId: 'gpt-4o' },
  };

  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(providerConfig)],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, JSON.stringify(activeSelection)],
  );
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
        async (url, init) => {
          await readFetchBody(url, init);
          return createChatCompletionsStream('续跑完成。');
        },
        async () => {
          await connectDb();
          await migrate();

          const permissionsFilePath = join(WORKSPACE_ROOT, '.openawork.permissions.json');
          const permissionsFileExisted = existsSync(permissionsFilePath);
          try {
            writeFileSync(
              permissionsFilePath,
              JSON.stringify({
                rules: [{ permission: 'bash', pattern: '*', action: 'ask' }],
              }),
            );

            const userId = randomUUID();
            const sessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `resume-thread-${userId}@openawork.local`,
              'hash',
            ]);
            configureOpenAIProvider(userId);
            sqliteRun(
              `INSERT INTO sessions (id, user_id, messages_json, metadata_json, state_status)
               VALUES (?, ?, '[]', ?, 'running')`,
              [sessionId, userId, JSON.stringify({ workingDirectory: WORKSPACE_ROOT })],
            );

            const requestData = {
              clientRequestId: CLIENT_REQUEST_ID,
              message: '执行慢命令',
              model: 'gpt-4o',
              maxTokens: 512,
              temperature: 1,
              webSearchEnabled: false,
              workingDirectory: WORKSPACE_ROOT,
            };

            appendSessionMessageV2({
              sessionId,
              userId,
              role: 'user',
              clientRequestId: CLIENT_REQUEST_ID,
              content: [{ type: 'text', text: requestData.message }],
            });
            appendSessionMessageV2({
              sessionId,
              userId,
              role: 'assistant',
              clientRequestId: `${CLIENT_REQUEST_ID}:assistant:1`,
              content: [
                {
                  type: 'tool_call',
                  toolCallId: TOOL_CALL_ID,
                  toolName: 'bash',
                  input: { command: SLOW_COMMAND },
                },
              ],
            });

            const state = {
              toolCalls: new Map<string, { toolName: string; inputText: string }>([
                [
                  TOOL_CALL_ID,
                  { toolName: 'bash', inputText: JSON.stringify({ command: SLOW_COMMAND }) },
                ],
              ]),
            };

            const pauseResult = await executeToolCalls({
              clientRequestId: CLIENT_REQUEST_ID,
              executionContext: {
                clientRequestId: CLIENT_REQUEST_ID,
                nextRound: 2,
                requestData,
                userId,
              },
              enabledToolNames: new Set(['bash']),
              eventSequence: { value: 1 },
              runId: randomUUID(),
              signal: new AbortController().signal,
              sessionContext: {
                metadataJson: JSON.stringify({ workingDirectory: WORKSPACE_ROOT }),
              },
              sessionId,
              state,
              turnFileDiffs: new Map(),
              userId,
              writeChunk: () => undefined,
              workspaceRoot: WORKSPACE_ROOT,
            });

            assert(
              pauseResult.hasPendingPermission === true,
              'slow bash should pause on the permission request',
            );

            await waitFor(() => {
              const row = sqliteGet<{ id: string }>(
                `SELECT id FROM permission_requests
                 WHERE session_id = ? AND status = 'pending' LIMIT 1`,
                [sessionId],
              );
              return typeof row?.id === 'string';
            }, 'pending permission request should be persisted');

            const pendingRow = sqliteGet<{ id: string; request_payload_json: string | null }>(
              `SELECT id, request_payload_json FROM permission_requests
               WHERE session_id = ? AND status = 'pending' LIMIT 1`,
              [sessionId],
            );
            assert(pendingRow?.id, 'pending permission request should exist');

            const payload = JSON.parse(pendingRow.request_payload_json ?? '{}') as {
              blockedToolCalls?: Array<{
                toolCallId: string;
                toolName: string;
                rawInput: Record<string, unknown>;
              }>;
            };

            sqliteRun(
              `UPDATE permission_requests
               SET status = 'approved', decision = 'once', updated_at = datetime('now')
               WHERE id = ?`,
              [pendingRow.id],
            );

            assert(
              getFreshSessionRuntimeThread({ sessionId, userId }) === null,
              'runtime thread must be absent before the resume starts',
            );

            const resumePromise = resumeApprovedPermissionRequest({
              payload: {
                clientRequestId: CLIENT_REQUEST_ID,
                nextRound: 2,
                requestData,
                toolCallId: TOOL_CALL_ID,
                toolName: 'bash',
                rawInput: { command: SLOW_COMMAND },
                blockedToolCalls: payload.blockedToolCalls ?? [],
              },
              sessionId,
              userId,
            });

            let firstThreadObservedAtMs: number | null = null;
            const pollDeadlineMs = Date.now() + 5_000;
            while (Date.now() < pollDeadlineMs && firstThreadObservedAtMs === null) {
              if (getFreshSessionRuntimeThread({ sessionId, userId }) !== null) {
                firstThreadObservedAtMs = Date.now();
                break;
              }
              await new Promise((resolve) => setTimeout(resolve, 20));
            }

            await resumePromise;

            const terminalExited = sqliteGet<{ occurred_at_ms: number }>(
              `SELECT occurred_at_ms FROM session_run_events
               WHERE session_id = ? AND event_type = 'terminal_exited'
               ORDER BY seq ASC LIMIT 1`,
              [sessionId],
            );
            assert(
              typeof terminalExited?.occurred_at_ms === 'number',
              'slow bash should publish terminal_exited run event',
            );
            assert(
              firstThreadObservedAtMs !== null,
              'runtime thread must become visible during the approved-tool phase',
            );
            assert(
              firstThreadObservedAtMs < terminalExited.occurred_at_ms,
              `runtime thread must be visible before the approved tool finishes ` +
                `(thread=${String(firstThreadObservedAtMs)}, terminalExited=${terminalExited.occurred_at_ms})`,
            );

            assert(
              getFreshSessionRuntimeThread({ sessionId, userId }) === null,
              'runtime thread must be cleared after the resume finishes',
            );

            console.log('verify-permission-resume-runtime-thread: ok');
          } finally {
            if (!permissionsFileExisted) {
              rmSync(permissionsFilePath, { force: true });
            }
            await closeDb();
          }
        },
      );
    },
  );
}

void main();
