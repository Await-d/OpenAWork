import { createHash, randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteAll, sqliteGet, sqliteRun } from '../db.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { listSessionMessagesV2 as listSessionMessages } from '../message-v2-adapter.js';
import { listSessionRunEvents } from '../session-run-events.js';
import { listSessionSnapshots } from '../session-snapshot-store.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { streamRoutes } from '../routes/stream-routes-plugin.js';
import { withTempEnv } from './task-verification-helpers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function writeSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function main(): Promise<void> {
  const upstreamPort = 3351;
  const workspaceRoot = path.join('/tmp', `openawork-durable-${randomUUID()}`);
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
          const body = JSON.parse(chunks.join('')) as { input?: unknown };

          res.writeHead(200, { 'Content-Type': 'text/event-stream' });
          if (!hasFunctionCallOutput(body)) {
            writeSse(res, 'response.output_item.added', {
              output_index: 0,
              item: {
                id: 'tool-call-1',
                type: 'function_call',
                call_id: 'call-write-1',
                name: 'write',
                arguments: JSON.stringify({
                  path: path.join(workspaceRoot, 'tracked.ts'),
                  content: 'export const value = 2;\n',
                }),
              },
            });
            writeSse(res, 'response.output_item.done', {
              output_index: 0,
              item: {
                id: 'tool-call-1',
                type: 'function_call',
                call_id: 'call-write-1',
                name: 'write',
                arguments: JSON.stringify({
                  path: path.join(workspaceRoot, 'tracked.ts'),
                  content: 'export const value = 2;\n',
                }),
              },
            });
            writeSse(res, 'response.completed', {
              response: {
                output: [
                  {
                    id: 'tool-call-1',
                    type: 'function_call',
                    call_id: 'call-write-1',
                    name: 'write',
                    arguments: JSON.stringify({
                      path: path.join(workspaceRoot, 'tracked.ts'),
                      content: 'export const value = 2;\n',
                    }),
                  },
                ],
              },
            });
            res.end();
            return;
          }

          writeTextCompletion(res, 'durable write complete');
        });
      });

      await new Promise<void>((resolve) => upstream.listen(upstreamPort, '127.0.0.1', resolve));
      await connectDb();
      await migrate();

      try {
        const admin = sqliteGet<{ id: string }>('SELECT id FROM users WHERE email = ? LIMIT 1', [
          'admin@openAwork.local',
        ]);
        const adminId = admin?.id ?? randomUUID();
        if (!admin) {
          sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
            adminId,
            'admin@openAwork.local',
            createHash('sha256').update('admin123456').digest('hex'),
          ]);
        }

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

        const trackedPath = path.join(workspaceRoot, 'tracked.ts');
        mkdirSync(path.dirname(trackedPath), { recursive: true });
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, metadata_json) VALUES (?, ?, '[]', ?)`,
          [randomUUID(), adminId, JSON.stringify({ workingDirectory: workspaceRoot })],
        );
        writeFileSync(trackedPath, 'export const value = 1;\n', 'utf8');

        const app = Fastify();
        await app.register(cors, { origin: true });
        await app.register(websocket);
        await app.register(requestWorkflowPlugin);
        await app.register(authPlugin);
        await app.register(sessionsRoutes);
        await app.register(streamRoutes);
        await app.ready();

        try {
          const accessToken = app.jwt.sign({ sub: adminId, email: 'admin@openAwork.local' });
          const createRes = await app.inject({
            method: 'POST',
            url: '/sessions',
            headers: { authorization: `Bearer ${accessToken}` },
            payload: { metadata: { workingDirectory: workspaceRoot } },
          });
          const { sessionId } = JSON.parse(createRes.body) as { sessionId: string };
          sqliteRun('UPDATE sessions SET metadata_json = ? WHERE id = ?', [
            JSON.stringify({
              workingDirectory: workspaceRoot,
              source: 'channel',
              channel: {
                tools: {
                  read: true,
                  edit: true,
                },
                permissions: {
                  allowShell: true,
                  allowSubAgents: true,
                },
              },
            }),
            sessionId,
          ]);

          const response = await app.inject({
            method: 'GET',
            url: `/sessions/${sessionId}/stream/sse?message=${encodeURIComponent('write tracked file durably')}&clientRequestId=${encodeURIComponent('req-durable-1')}&providerId=${encodeURIComponent('openai')}&model=${encodeURIComponent('test-model')}&token=${encodeURIComponent(accessToken)}`,
          });

          assert(response.statusCode === 200, 'stream request should succeed');
          const backupRows = sqliteAll<{ backup_id: string; storage_path: string | null }>(
            'SELECT backup_id, storage_path FROM session_file_backups WHERE session_id = ? ORDER BY backup_id',
            [sessionId],
          );
          assert(backupRows.length >= 1, 'write flow should persist backup rows');
          assert(
            backupRows.every(
              (row) => typeof row.storage_path === 'string' && existsSync(row.storage_path),
            ),
            'backup rows should point to existing content-addressed files',
          );

          const fileDiffRows = sqliteAll<{ backup_before_ref_json: string | null }>(
            'SELECT backup_before_ref_json FROM session_file_diffs WHERE session_id = ? AND client_request_id = ? ORDER BY file_path',
            [sessionId, 'req-durable-1'],
          );
          assert(fileDiffRows.length >= 1, 'write flow should persist session_file_diffs rows');
          assert(
            fileDiffRows.some((row) => typeof row.backup_before_ref_json === 'string'),
            'at least one file diff row should carry backup_before_ref_json',
          );

          const snapshots = listSessionSnapshots({ sessionId, userId: adminId });
          assert(snapshots.length >= 1, 'write flow should persist a request snapshot');
          assert(
            snapshots.some((snapshot) => snapshot.summary.backupBeforeRefs.length >= 1),
            'snapshot summary should carry backup refs',
          );

          const toolMessages = listSessionMessages({ sessionId, userId: adminId }).filter(
            (message) => message.role === 'tool',
          );
          assert(toolMessages.length >= 1, 'write flow should persist tool messages');
          const toolMessagePart = toolMessages[0]?.content[0];
          assert(
            toolMessagePart &&
              typeof toolMessagePart === 'object' &&
              toolMessagePart['type'] === 'tool_result' &&
              Array.isArray(toolMessagePart['fileDiffs']) &&
              (toolMessagePart['fileDiffs'] as Array<{ backupBeforeRef?: unknown }>).some(
                (diff) => diff.backupBeforeRef,
              ),
            'tool_result message should carry fileDiffs with backupBeforeRef',
          );

          const runEvents = listSessionRunEvents(sessionId).filter(
            (event) => event.type === 'tool_result',
          );
          assert(runEvents.length >= 1, 'write flow should persist tool_result run events');
          const eventFileDiffs = (
            runEvents[0] as { fileDiffs?: Array<{ backupBeforeRef?: unknown }> }
          )?.fileDiffs;
          assert(
            Array.isArray(eventFileDiffs) && eventFileDiffs.some((diff) => diff.backupBeforeRef),
            'tool_result run event should carry backupBeforeRef in fileDiffs payload',
          );

          console.log('verify-write-tools-durable-closure: ok');
        } finally {
          await app.close();
        }
      } finally {
        await closeDb();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
      }
    },
  );
}

void main().catch((error) => {
  console.error('verify-write-tools-durable-closure: failed');
  console.error(error);
  process.exitCode = 1;
});

function hasFunctionCallOutput(body: Record<string, unknown>): boolean {
  const input = body['input'];
  return Array.isArray(input)
    ? input.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          item['type'] === 'function_call_output',
      )
    : false;
}

function writeTextCompletion(res: ServerResponse, text: string): void {
  writeSse(res, 'response.output_text.delta', {
    output_index: 0,
    content_index: 0,
    item_id: 'msg_done',
    delta: text,
  });
  writeSse(res, 'response.completed', {
    response: {
      output: [{ id: 'msg_done', type: 'message' }],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    },
  });
  res.end();
}
