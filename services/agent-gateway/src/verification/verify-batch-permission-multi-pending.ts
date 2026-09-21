import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendSessionMessageV2,
  listSessionMessagesV2 as listSessionMessages,
} from '../message/message-v2-adapter.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
import { parseApprovedPermissionResumePayload } from '../permission/permission-contract.js';
import { executeToolCalls } from '../routes/stream.js';
import { resumeApprovedPermissionRequest } from '../routes/stream-runtime.js';
import {
  assert,
  createChatCompletionsStream,
  readFetchBody,
  waitFor,
  withMockFetch,
  withTempEnv,
} from './task-verification-helpers.js';

const READ_FILE_NAME = 'verify-batch-multi-input.txt';
const WRITE_FILE_NAME = 'verify-batch-multi-output.txt';
const CLIENT_REQUEST_ID = 'batch-multi-req-1';

interface PendingRow {
  id: string;
  tool_name: string;
  request_payload_json: string | null;
}

function configureOpenAIProvider(userId: string): void {
  const now = new Date().toISOString();
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [
      userId,
      JSON.stringify([
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
      ]),
    ],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [
      userId,
      JSON.stringify({
        chat: { providerId: 'openai', modelId: 'gpt-4o' },
        fast: { providerId: 'openai', modelId: 'gpt-4o' },
      }),
    ],
  );
}

function readLatestPending(sessionId: string): PendingRow {
  const row = sqliteGet<PendingRow>(
    `SELECT id, tool_name, request_payload_json FROM permission_requests
     WHERE session_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
    [sessionId],
  );
  assert(row?.id, 'a pending permission request should exist');
  return row;
}

function approveAndBuildPayload(
  sessionId: string,
  row: PendingRow,
): {
  payload: Parameters<typeof resumeApprovedPermissionRequest>[0]['payload'];
} {
  const parsed = parseApprovedPermissionResumePayload(row.request_payload_json);
  assert(parsed, 'pending request should persist a parseable resume payload');
  sqliteRun(
    `UPDATE permission_requests
     SET status = 'approved', decision = 'once', updated_at = datetime('now')
     WHERE id = ?`,
    [row.id],
  );
  return { payload: { ...parsed, toolName: row.tool_name } };
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
      let upstreamCalls = 0;
      await withMockFetch(
        async (url, init) => {
          upstreamCalls += 1;
          await readFetchBody(url, init);
          return createChatCompletionsStream('已收到整批工具结果。');
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              join(WORKSPACE_ROOT, '.openawork.permissions.json'),
              JSON.stringify({ rules: [{ permission: 'bash', pattern: '*', action: 'ask' }] }),
            );
            const readPath = join(WORKSPACE_ROOT, READ_FILE_NAME);
            const writePath = join(WORKSPACE_ROOT, WRITE_FILE_NAME);
            writeFileSync(readPath, 'hello multi\n');
            rmSync(writePath, { force: true });

            const userId = randomUUID();
            const sessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `multi-${userId}@openawork.local`,
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
              message: '读取、查看目录、再写一个文件',
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
                  toolCallId: 'call-read',
                  toolName: 'read',
                  input: { filePath: readPath },
                },
                {
                  type: 'tool_call',
                  toolCallId: 'call-bash',
                  toolName: 'bash',
                  input: { command: 'pwd' },
                },
                {
                  type: 'tool_call',
                  toolCallId: 'call-write',
                  toolName: 'write',
                  input: { filePath: writePath, content: 'written\n' },
                },
              ],
            });

            const pauseResult = await executeToolCalls({
              clientRequestId: CLIENT_REQUEST_ID,
              executionContext: {
                clientRequestId: CLIENT_REQUEST_ID,
                nextRound: 2,
                requestData,
                userId,
              },
              enabledToolNames: new Set(['read', 'bash', 'write']),
              eventSequence: { value: 1 },
              runId: randomUUID(),
              signal: new AbortController().signal,
              sessionContext: {
                metadataJson: JSON.stringify({ workingDirectory: WORKSPACE_ROOT }),
              },
              sessionId,
              state: {
                toolCalls: new Map<string, { toolName: string; inputText: string }>([
                  [
                    'call-read',
                    { toolName: 'read', inputText: JSON.stringify({ filePath: readPath }) },
                  ],
                  [
                    'call-bash',
                    { toolName: 'bash', inputText: JSON.stringify({ command: 'pwd' }) },
                  ],
                  [
                    'call-write',
                    {
                      toolName: 'write',
                      inputText: JSON.stringify({ filePath: writePath, content: 'written\n' }),
                    },
                  ],
                ]),
              },
              turnFileDiffs: new Map(),
              userId,
              writeChunk: () => undefined,
              workspaceRoot: WORKSPACE_ROOT,
            });

            assert(pauseResult.hasPendingPermission === true, 'batch should pause');
            assert(
              JSON.stringify(pauseResult.pendingToolCallIds) ===
                JSON.stringify(['call-bash', 'call-write']),
              `pending batch must be [call-bash, call-write], got ${JSON.stringify(
                pauseResult.pendingToolCallIds,
              )}`,
            );
            assert(!existsSync(writePath), 'gated write must not run during the pause turn');
            assert(upstreamCalls === 0, 'a paused batch must not call upstream');

            await waitFor(
              () => typeof readLatestPending(sessionId).request_payload_json === 'string',
              'pending permission payload should be persisted',
            );

            const firstPending = readLatestPending(sessionId);
            const firstPayload = JSON.parse(firstPending.request_payload_json ?? '{}') as {
              blockedToolCalls?: Array<{ toolCallId: string }>;
            };
            assert(
              JSON.stringify(firstPayload.blockedToolCalls?.map((call) => call.toolCallId)) ===
                JSON.stringify(['call-bash', 'call-write']),
              'first pending payload must carry both blocked calls in order',
            );

            // Approve the first blocked call: it runs, and the held-back write
            // then raises its OWN approval, so the turn must pause again without
            // sending anything upstream.
            const first = approveAndBuildPayload(sessionId, firstPending);
            await resumeApprovedPermissionRequest({
              payload: first.payload,
              sessionId,
              userId,
            });

            assert(
              !existsSync(writePath),
              'the held-back write must not run before its own approval',
            );
            assert(
              upstreamCalls === 0,
              'a resumed batch with a residual pending must not call upstream',
            );

            const secondPending = readLatestPending(sessionId);
            assert(
              secondPending.tool_name === 'write',
              `the second pending must belong to write, got ${secondPending.tool_name}`,
            );
            const secondPayload = JSON.parse(secondPending.request_payload_json ?? '{}') as {
              blockedToolCalls?: Array<{ toolCallId: string }>;
            };
            assert(
              JSON.stringify(secondPayload.blockedToolCalls?.map((call) => call.toolCallId)) ===
                JSON.stringify(['call-write']),
              'second pending payload must carry the remaining blocked call',
            );

            const second = approveAndBuildPayload(sessionId, secondPending);
            await resumeApprovedPermissionRequest({
              payload: second.payload,
              sessionId,
              userId,
            });

            await waitFor(() => existsSync(writePath), 'the write must run after its approval');
            await waitFor(
              () => upstreamCalls === 1,
              'the final approval must continue the turn exactly once',
            );
            // 上面的 `assert(upstreamCalls === 0)` 是断言函数，会把变量在控制流上
            // 收窄为字面量 0，而真正的自增发生在 mock 回调里；这里用显式 number 声明
            // 重新放宽类型，避免 `0 === 1` 被判为永不成立的比较。
            const totalUpstreamCalls: number = upstreamCalls;
            assert(
              totalUpstreamCalls === 1,
              `the whole batch must reach upstream exactly once, got ${totalUpstreamCalls}`,
            );

            const persistedIds = listSessionMessages({ sessionId, userId })
              .flatMap((message) => message.content ?? [])
              .filter((part) => part.type === 'tool_result')
              .map((part) => part.toolCallId);
            assert(
              persistedIds.indexOf('call-read') < persistedIds.indexOf('call-bash') &&
                persistedIds.indexOf('call-bash') < persistedIds.indexOf('call-write'),
              `results must stay in tool_use order, got ${JSON.stringify(persistedIds)}`,
            );

            console.log('verify-batch-permission-multi-pending: ok');
          } finally {
            rmSync(join(WORKSPACE_ROOT, WRITE_FILE_NAME), { force: true });
            rmSync(join(WORKSPACE_ROOT, READ_FILE_NAME), { force: true });
            await closeDb();
          }
        },
      );
    },
  );
}

void main().catch((error) => {
  console.error('verify-batch-permission-multi-pending: failed');
  console.error(error);
  process.exitCode = 1;
});
