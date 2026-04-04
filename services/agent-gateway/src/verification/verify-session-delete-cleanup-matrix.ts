import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { rmSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import authPlugin from '../auth.js';
import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../db.js';
import { appendSessionMessage } from '../session-message-store.js';
import { persistSessionFileBackup } from '../session-file-backup-store.js';
import { persistSessionFileDiffs } from '../session-file-diff-store.js';
import requestWorkflowPlugin from '../request-workflow.js';
import { publishSessionRunEvent } from '../session-run-events.js';
import { persistSessionSnapshot, createRequestSnapshotRef } from '../session-snapshot-store.js';
import { sessionsRoutes } from '../routes/sessions.js';
import { withTempEnv } from './task-verification-helpers.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const workspaceRoot = path.join('/tmp', `openawork-delete-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });

  await withTempEnv(
    {
      DATABASE_URL: ':memory:',
      WORKSPACE_ROOT: workspaceRoot,
    },
    async () => {
      await connectDb();
      await migrate();

      try {
        const userId = randomUUID();
        sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
          userId,
          'delete-matrix@openawork.local',
          createHash('sha256').update('admin123456').digest('hex'),
        ]);

        const parentSessionId = randomUUID();
        const childSessionId = randomUUID();
        const siblingSessionId = randomUUID();
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, '[]', 'idle', '{}')`,
          [parentSessionId, userId],
        );
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, '[]', 'idle', ?)`,
          [childSessionId, userId, JSON.stringify({ parentSessionId })],
        );
        sqliteRun(
          `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, '[]', 'idle', '{}')`,
          [siblingSessionId, userId],
        );

        const app = Fastify();
        await app.register(requestWorkflowPlugin);
        await app.register(authPlugin);
        await app.register(sessionsRoutes);
        await app.ready();

        try {
          const accessToken = app.jwt.sign({ sub: userId, email: 'delete-matrix@openawork.local' });

          sqliteRun(
            `INSERT INTO permission_requests (id, session_id, tool_name, scope, reason, risk_level, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [
              randomUUID(),
              parentSessionId,
              'write',
              'workspace:tracked.txt',
              'pending write',
              'medium',
            ],
          );

          const blockedRes = await app.inject({
            method: 'DELETE',
            url: `/sessions/${parentSessionId}`,
            headers: { authorization: `Bearer ${accessToken}` },
          });
          assert(blockedRes.statusCode === 409, 'pending interaction should block session delete');

          sqliteRun(`DELETE FROM permission_requests WHERE session_id = ?`, [parentSessionId]);

          appendSessionMessage({
            sessionId: parentSessionId,
            userId,
            role: 'tool',
            content: [{ type: 'text', text: 'parent tool message' }],
          });
          appendSessionMessage({
            sessionId: childSessionId,
            userId,
            role: 'assistant',
            content: [{ type: 'text', text: 'child assistant message' }],
          });

          const sharedBackupParent = await persistSessionFileBackup({
            sessionId: parentSessionId,
            userId,
            filePath: path.join(workspaceRoot, 'tracked.txt'),
            content: 'shared backup\n',
            kind: 'before_write',
            toolName: 'write',
          });
          const sharedBackupSibling = await persistSessionFileBackup({
            sessionId: siblingSessionId,
            userId,
            filePath: path.join(workspaceRoot, 'sibling.txt'),
            content: 'shared backup\n',
            kind: 'before_write',
            toolName: 'write',
          });
          assert(
            sharedBackupParent.storagePath === sharedBackupSibling.storagePath,
            'shared backup content should reuse same storage path',
          );

          persistSessionFileDiffs({
            sessionId: parentSessionId,
            userId,
            clientRequestId: 'req-parent',
            requestId: 'req-parent:tool:write',
            toolName: 'write',
            diffs: [
              {
                file: 'tracked.txt',
                before: '',
                after: 'value',
                additions: 1,
                deletions: 0,
                sourceKind: 'structured_tool_diff',
                guaranteeLevel: 'strong',
              },
            ],
          });
          persistSessionSnapshot({
            sessionId: parentSessionId,
            userId,
            snapshotRef: createRequestSnapshotRef('req-parent'),
            fileDiffs: [
              {
                file: 'tracked.txt',
                before: '',
                after: 'value',
                additions: 1,
                deletions: 0,
                sourceKind: 'structured_tool_diff',
                guaranteeLevel: 'strong',
                backupBeforeRef: sharedBackupParent,
              },
            ],
          });
          publishSessionRunEvent(parentSessionId, {
            type: 'tool_result',
            toolCallId: 'call-parent',
            toolName: 'write',
            output: { ok: true },
            isError: false,
          });
          sqliteRun(
            'INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [parentSessionId, 'write', 'req-parent:tool:write', '{}', '{}', 0, 1],
          );

          const deleteRes = await app.inject({
            method: 'DELETE',
            url: `/sessions/${parentSessionId}`,
            headers: { authorization: `Bearer ${accessToken}` },
          });
          const payload = JSON.parse(deleteRes.body) as { deletedSessionIds: string[] };
          assert(deleteRes.statusCode === 200, 'idle parent session should delete successfully');
          assert(
            payload.deletedSessionIds.includes(parentSessionId) &&
              payload.deletedSessionIds.includes(childSessionId),
            'parent delete should include descendant sessions',
          );

          const counts = {
            sessions:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM sessions WHERE id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
            messages:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM session_messages WHERE session_id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
            diffs:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM session_file_diffs WHERE session_id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
            snapshots:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM session_snapshots WHERE session_id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
            runEvents:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM session_run_events WHERE session_id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
            backups:
              sqliteGet<{ count: number }>(
                'SELECT COUNT(*) as count FROM session_file_backups WHERE session_id IN (?, ?)',
                [parentSessionId, childSessionId],
              )?.count ?? 0,
          };
          assert(counts.sessions === 0, 'deleted sessions should be removed');
          assert(counts.messages === 0, 'session_messages should cascade delete');
          assert(counts.diffs === 0, 'session_file_diffs should cascade delete');
          assert(counts.snapshots === 0, 'session_snapshots should cascade delete');
          assert(counts.runEvents === 0, 'session_run_events should cascade delete');
          assert(counts.backups === 0, 'session_file_backups rows should be removed');

          const auditSessionId = sqliteGet<{ session_id: string | null }>(
            'SELECT session_id FROM audit_logs WHERE request_id = ? LIMIT 1',
            ['req-parent:tool:write'],
          )?.session_id;
          assert(auditSessionId === null, 'audit_logs should keep rows but null out session_id');

          assert(
            typeof sharedBackupParent.storagePath === 'string' &&
              existsSync(sharedBackupParent.storagePath),
            'shared backup file should remain while sibling session still references it',
          );

          const siblingDeleteRes = await app.inject({
            method: 'DELETE',
            url: `/sessions/${siblingSessionId}`,
            headers: { authorization: `Bearer ${accessToken}` },
          });
          assert(
            siblingDeleteRes.statusCode === 200,
            'sibling cleanup session should delete successfully',
          );
          assert(
            typeof sharedBackupParent.storagePath === 'string' &&
              !existsSync(sharedBackupParent.storagePath),
            'shared backup file should be garbage-collected after last referencing session is deleted',
          );

          console.log('verify-session-delete-cleanup-matrix: ok');
        } finally {
          await app.close();
        }
      } finally {
        await closeDb();
      }
    },
  );

  rmSync(workspaceRoot, { recursive: true, force: true });
}

void main().catch((error) => {
  console.error('verify-session-delete-cleanup-matrix: failed');
  console.error(error);
  process.exitCode = 1;
});
