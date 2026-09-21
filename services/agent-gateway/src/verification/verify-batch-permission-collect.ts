import { randomUUID } from 'node:crypto';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendSessionMessageV2,
  listSessionMessagesV2 as listSessionMessages,
} from '../message/message-v2-adapter.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun, WORKSPACE_ROOT } from '../infra/db.js';
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

const READ_FILE_NAME = 'verify-batch-collect-input.txt';
const WRITE_FILE_NAME = 'verify-batch-collect-output.txt';

const CLIENT_REQUEST_ID = 'batch-collect-req-1';

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
          return createChatCompletionsStream('已收到整批工具结果。');
        },
        async () => {
          await connectDb();
          await migrate();

          try {
            writeFileSync(
              join(WORKSPACE_ROOT, '.openawork.permissions.json'),
              JSON.stringify({
                rules: [
                  { permission: 'bash', pattern: '*', action: 'ask' },
                  { permission: 'write', pattern: '*', action: 'allow' },
                ],
              }),
            );
            const readPath = join(WORKSPACE_ROOT, READ_FILE_NAME);
            const writePath = join(WORKSPACE_ROOT, WRITE_FILE_NAME);
            writeFileSync(readPath, 'hello batch\n');
            rmSync(writePath, { force: true });

            const userId = randomUUID();
            const sessionId = randomUUID();
            sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
              userId,
              `batch-${userId}@openawork.local`,
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
              message: '读取文件、查看目录、再写一个文件',
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

            const state = {
              toolCalls: new Map<string, { toolName: string; inputText: string }>([
                [
                  'call-read',
                  { toolName: 'read', inputText: JSON.stringify({ filePath: readPath }) },
                ],
                ['call-bash', { toolName: 'bash', inputText: JSON.stringify({ command: 'pwd' }) }],
                [
                  'call-write',
                  {
                    toolName: 'write',
                    inputText: JSON.stringify({ filePath: writePath, content: 'written\n' }),
                  },
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
              enabledToolNames: new Set(['read', 'bash', 'write']),
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
              'batch should pause on the bash permission request',
            );
            assert(
              JSON.stringify(pauseResult.pendingToolCallIds) ===
                JSON.stringify(['call-bash', 'call-write']),
              `blocked calls must be the pending bash plus the order-preserving gated write, got ${JSON.stringify(
                pauseResult.pendingToolCallIds,
              )}`,
            );

            assert(existsSync(readPath), 'read sibling input must exist for the scenario');
            assert(
              !existsSync(writePath),
              'gated write sibling must NOT execute while the turn is paused',
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
              blockedToolCalls?: Array<{ toolCallId: string; toolName: string }>;
            };
            assert(
              JSON.stringify(payload.blockedToolCalls?.map((call) => call.toolCallId)) ===
                JSON.stringify(['call-bash', 'call-write']),
              'pending payload must carry the whole blocked batch in tool_use order',
            );

            sqliteRun(
              `UPDATE permission_requests
               SET status = 'approved', decision = 'once', updated_at = datetime('now')
               WHERE id = ?`,
              [pendingRow.id],
            );

            await resumeApprovedPermissionRequest({
              payload: {
                clientRequestId: CLIENT_REQUEST_ID,
                nextRound: 2,
                requestData,
                toolCallId: 'call-bash',
                toolName: 'bash',
                rawInput: { command: 'pwd' },
                blockedToolCalls: payload.blockedToolCalls as Array<{
                  toolCallId: string;
                  toolName: string;
                  rawInput: Record<string, unknown>;
                }>,
              },
              sessionId,
              userId,
            });

            await waitFor(
              () => existsSync(writePath),
              'approved resume must execute the gated write sibling',
            );

            const persistedIds = listSessionMessages({ sessionId, userId })
              .flatMap((message) => message.content ?? [])
              .filter((part) => part.type === 'tool_result')
              .map((part) => part.toolCallId);
            assert(
              persistedIds.indexOf('call-read') < persistedIds.indexOf('call-bash') &&
                persistedIds.indexOf('call-bash') < persistedIds.indexOf('call-write'),
              `results must stay in tool_use order (read < bash < write), got ${JSON.stringify(persistedIds)}`,
            );

            const firstRender = JSON.stringify(listSessionMessages({ sessionId, userId }));
            const secondRender = JSON.stringify(listSessionMessages({ sessionId, userId }));
            assert(
              firstRender === secondRender,
              'rendering the same DB state twice must be byte-identical (prompt-cache prefix stability)',
            );

            console.log('verify-batch-permission-collect: ok');
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
  console.error('verify-batch-permission-collect: failed');
  console.error(error);
  process.exitCode = 1;
});
