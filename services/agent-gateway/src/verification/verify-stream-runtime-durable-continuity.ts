import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, connectDb, migrate, sqliteAll, sqliteRun } from '../db.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message/message-v2-adapter.js';
import { listSessionSnapshots } from '../session/session-snapshot-store.js';
import { runSessionInBackground } from '../routes/stream-runtime.js';
import { listStoredToolResults } from '../tools/tool-result-contract.js';
import { withTempEnv } from './task-verification-helpers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function writeChatToolCall(res: ServerResponse, filePath: string): void {
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call-write-1',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({
                    path: filePath,
                    content: 'export const value = 2;\n',
                  }),
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

function hasFunctionCallOutput(body: Record<string, unknown>): boolean {
  const messages = body['messages'];
  return Array.isArray(messages)
    ? messages.some(
        (item) =>
          item && typeof item === 'object' && !Array.isArray(item) && item['role'] === 'tool',
      )
    : false;
}

function writeTextCompletion(res: ServerResponse, text: string): void {
  res.write(
    `data: ${JSON.stringify({
      choices: [
        {
          delta: { content: text },
          finish_reason: 'stop',
        },
      ],
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
}

async function main(): Promise<void> {
  const upstreamPort = 3352;
  const workspaceRoot = path.join('/tmp', `openawork-background-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      AI_API_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      AI_API_KEY: 'test-key',
      WORKSPACE_ROOT: workspaceRoot,
    },
    async () => {
      const upstream = createServer((req, res) => {
        const chunks: string[] = [];
        req.on('data', (chunk) => chunks.push(chunk.toString()));
        req.on('end', () => {
          const body = JSON.parse(chunks.join('')) as Record<string, unknown>;
          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (!hasFunctionCallOutput(body)) {
            writeChatToolCall(res, path.join(workspaceRoot, 'tracked.ts'));
            return;
          }

          writeTextCompletion(res, 'background write complete');
        });
      });

      await new Promise<void>((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));
      await connectDb();
      await migrate();

      try {
        const adminId = randomUUID();
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          adminId,
          'background@openawork.local',
          createHash('sha256').update('admin123456').digest('hex'),
        ]);
        sqliteRun(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [
            adminId,
            JSON.stringify([
              {
                id: 'openai',
                type: 'openai',
                name: 'OpenAI',
                enabled: true,
                baseUrl: `http://127.0.0.1:${upstreamPort}`,
                apiKey: 'test-key',
                defaultModels: [{ id: 'test-model', label: 'Test Model', enabled: true }],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ]),
          ],
        );
        sqliteRun(
          `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
           ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
          [
            adminId,
            JSON.stringify({
              chat: { providerId: 'openai', modelId: 'test-model' },
              fast: { providerId: 'openai', modelId: 'test-model' },
            }),
          ],
        );

        const sessionId = randomUUID();
        const trackedPath = path.join(workspaceRoot, 'tracked.ts');
        writeFileSync(trackedPath, 'export const value = 1;\n', 'utf8');
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
          [
            sessionId,
            adminId,
            JSON.stringify({
              workingDirectory: workspaceRoot,
              source: 'channel',
              channel: {
                tools: { read: true, edit: true },
                permissions: { allowShell: true, allowSubAgents: true },
              },
            }),
          ],
        );

        const chunks: unknown[] = [];
        const result = await runSessionInBackground({
          sessionId,
          userId: adminId,
          requestData: {
            clientRequestId: 'req-background-1',
            message: 'write file in background',
            model: 'test-model',
            providerId: 'openai',
            maxTokens: 256,
            temperature: 1,
            webSearchEnabled: false,
          },
          writeChunk: (chunk) => chunks.push(chunk),
        });

        assert(result.statusCode === 200, 'background execution should succeed');
        assert(chunks.length > 0, 'background execution should emit run events');

        const backupRows = sqliteAll<{ backup_id: string; storage_path: string | null }>(
          'SELECT backup_id, storage_path FROM session_file_backups WHERE session_id = ? ORDER BY backup_id',
          [sessionId],
        );
        assert(backupRows.length >= 1, 'background write should persist backup rows');
        assert(
          backupRows.every(
            (row) => typeof row.storage_path === 'string' && existsSync(row.storage_path),
          ),
          'background backup rows should point to existing files',
        );

        const fileDiffRows = sqliteAll<{ backup_before_ref_json: string | null }>(
          'SELECT backup_before_ref_json FROM session_file_diffs WHERE session_id = ? AND client_request_id = ? ORDER BY file_path',
          [sessionId, 'req-background-1'],
        );
        assert(
          fileDiffRows.some((row) => typeof row.backup_before_ref_json === 'string'),
          'background write should persist backup refs in session_file_diffs',
        );

        const snapshots = listSessionSnapshots({ sessionId, userId: adminId });
        assert(
          snapshots.some((snapshot) => snapshot.summary.backupBeforeRefs.length >= 1),
          'background write should persist snapshot backup refs',
        );

        const toolResults = listStoredToolResults(
          listSessionMessages({ sessionId, userId: adminId }),
        );
        assert(toolResults.length >= 1, 'background write should persist tool results');

        console.log('verify-stream-runtime-durable-continuity: ok');
      } finally {
        await closeDb();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-stream-runtime-durable-continuity: failed');
  console.error(error);
  process.exitCode = 1;
});
