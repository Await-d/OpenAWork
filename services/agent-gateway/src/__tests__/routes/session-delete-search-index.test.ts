/**
 * Regression coverage for search-index consistency across session-deletion
 * HTTP paths.
 *
 * `session_messages_fts` is a regular (in-table content) FTS5 table with no
 * foreign key to `sessions`, so deleting a session cascades to
 * `session_messages` but never reaches the index. Every path that removes
 * sessions must clean the index rows of exactly the sessions it removed, and
 * must leave the rows of a surviving session untouched.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';
import type * as TeamRoutesModule from '../../routes/team.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-session-delete-fts-'));

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
// 会话删除会按 sessionId 回收磁盘型产物（artifacts-index.json）：必须把数据目录
// 指到临时目录，避免测试读到 / 写真实用户的产物索引。
process.env['OPENAWORK_DATA_DIR'] = workspaceRoot;
process.env['JWT_SECRET'] = 'session-delete-fts-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

vi.mock('../../provider/provider-catalog.js', () => ({
  getChatProvider: vi.fn(async () => ({
    provider: { id: 'snapshot-provider' },
    modelId: 'snapshot-model',
  })),
}));

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;
let teamRoutes: typeof TeamRoutesModule.teamRoutes;

const USER_ID = 'u-session-delete-fts';
const TEAM_WORKSPACE_ID = 'tw-session-delete-fts';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.register(teamRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'session-delete-fts@example.com' })}`;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(
  sessionId: string,
  options: { metadata?: Record<string, unknown>; teamParentSessionId?: string | null } = {},
): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, team_parent_session_id)
     VALUES (?, ?, 'session', ?, 'idle', ?)`,
    [
      sessionId,
      USER_ID,
      JSON.stringify(options.metadata ?? {}),
      options.teamParentSessionId ?? null,
    ],
  );
}

function seedTeamWorkspace(): void {
  dbModule.sqliteRun(
    `INSERT INTO team_workspaces (
      id, user_id, name, description, visibility, default_working_root, default_team_roster_json
    ) VALUES (?, ?, '团队工作区', NULL, 'private', NULL, '[]')`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
}

async function appendIndexedMessage(sessionId: string, text: string): Promise<string> {
  const { appendSessionMessageV2 } = await import('../../message/message-v2-adapter.js');
  const messageId = `${sessionId}-msg-${text}`;
  appendSessionMessageV2({
    sessionId,
    userId: USER_ID,
    role: 'user',
    content: [{ type: 'text', text }],
    messageId,
  });
  return messageId;
}

function countSearchRowsForSession(sessionId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_messages_fts WHERE session_id = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}

function countLegacyMessagesForSession(sessionId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_messages WHERE session_id = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}

function countShadowContentRowsForSession(sessionId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM session_messages_fts_content WHERE c1 = ?',
    [sessionId],
  );
  return row?.count ?? 0;
}

function countEventLogRowsForAggregate(aggregateId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM event_log WHERE aggregate_id = ?',
    [aggregateId],
  );
  return row?.count ?? 0;
}

function countEventSequencesForAggregate(aggregateId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM event_sequences WHERE aggregate_id = ?',
    [aggregateId],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
  teamRoutes = (await import('../../routes/team.js')).teamRoutes;
});

beforeEach(() => {
  // `session_messages_fts` has no FK, so wiping `users` does not clear it.
  dbModule.sqliteRun('DELETE FROM session_messages_fts', []);
  dbModule.sqliteRun('DELETE FROM team_workspaces', []);
  // event_log / event_sequences 没有指向 sessions 的外键，也不会被上面的清理带走。
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM event_sequences', []);
  dbModule.sqliteRun('DELETE FROM session_deletion_cleanup', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('session deletion keeps the search index consistent', () => {
  it('keeps the session and its stream reservation when stopping exceeds the deadline', async () => {
    const { clearInFlightStreamRequest, getInFlightStreamRequest, reserveInFlightStreamRequest } =
      await import('../../routes/stream-cancellation.js');
    const sessionId = 'delete-slow-stream';
    seedSession(sessionId);
    const app = await buildApp();
    const key = { sessionId, clientRequestId: 'active', userId: USER_ID };
    const stream = reserveInFlightStreamRequest(key);
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/sessions/${sessionId}`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ blockReason: 'stream', sessionId });
      expect(stream.abortController.signal.aborted).toBe(true);
      expect(getInFlightStreamRequest(sessionId, key.clientRequestId)?.execution).toBe(
        stream.execution,
      );
      expect(dbModule.sqliteGet('SELECT id FROM sessions WHERE id = ?', [sessionId])).toBeDefined();
      expect(dbModule.sqliteGet('SELECT id FROM session_deletion_cleanup')).toBeUndefined();
    } finally {
      stream.resolve({ statusCode: 200 });
      clearInFlightStreamRequest({ ...key, execution: stream.execution });
      await app.close();
    }
  });

  it('responds while disk cleanup is pending and resumes a failed job on startup', async () => {
    const { getGatewayArtifactManager } = await import('../../infra/artifact-manager.js');
    const sessionId = 'delete-with-assets';
    seedSession(sessionId);
    seedSession('delete-with-assets-survivor');
    const manager = getGatewayArtifactManager();
    const path = join(workspaceRoot, 'delayed-cleanup.txt');
    writeFileSync(path, 'temporary attachment');
    const artifact = manager.add({ sessionId, path, name: 'attachment.txt', type: 'document' });
    let failCleanup: (error: Error) => void = () => undefined;
    const cleanup = vi.spyOn(manager, 'removeForDeletedSessions').mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          failCleanup = reject;
        }),
    );
    const app = await buildApp();
    try {
      const deleted = await app.inject({
        method: 'DELETE',
        url: `/sessions/${sessionId}`,
        headers: { authorization: bearer(app) },
      });
      expect(deleted.statusCode).toBe(200);
      expect(deleted.json()).toEqual({ ok: true, deletedSessionIds: [sessionId] });
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledWith(new Set([sessionId])));
      const list = await app.inject({
        method: 'GET',
        url: '/sessions',
        headers: { authorization: bearer(app) },
      });
      expect(list.statusCode).toBe(200);
      expect(list.body).toContain('delete-with-assets-survivor');
      expect(
        dbModule.sqliteGet('SELECT id FROM sessions WHERE id = ?', [sessionId]),
      ).toBeUndefined();
      expect(existsSync(path)).toBe(true);
      failCleanup(new Error('模拟一次磁盘清理失败'));
      await vi.waitFor(() =>
        expect(dbModule.sqliteGet('SELECT attempts FROM session_deletion_cleanup')).toEqual({
          attempts: 1,
        }),
      );
    } finally {
      failCleanup(new Error('结束清理测试'));
      await app.close();
      cleanup.mockRestore();
    }

    dbModule.sqliteRun('UPDATE session_deletion_cleanup SET next_attempt_at = 0');
    const restartedApp = await buildApp();
    try {
      await vi.waitFor(() =>
        expect(dbModule.sqliteGet('SELECT id FROM session_deletion_cleanup')).toBeUndefined(),
      );
      expect(existsSync(path)).toBe(false);
      expect(manager.get(artifact.id)).toBeUndefined();
    } finally {
      await restartedApp.close();
    }
  });

  it('deletes mixed descendants without crossing owners or parsing unrelated malformed metadata', async () => {
    seedSession('mixed-root');
    seedSession('mixed-team', { teamParentSessionId: 'mixed-root' });
    seedSession('mixed-grandchild', { metadata: { parentSessionId: 'mixed-team' } });
    seedSession('mixed-malformed', { teamParentSessionId: 'mixed-root' });
    dbModule.sqliteRun("UPDATE sessions SET metadata_json = '{' WHERE id = 'mixed-malformed'", []);
    dbModule.sqliteRun(
      "INSERT INTO users (id, email, password_hash) VALUES ('other', 'other@example.com', 'x')",
      [],
    );
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, team_parent_session_id)
       VALUES ('other-child', 'other', 'session', '{"parentSessionId":"mixed-root"}', 'mixed-root')`,
      [],
    );
    // The migration must make JSON parent lookup indexable without rejecting corrupt legacy rows.
    const plan = dbModule.sqliteAll<{ detail: string }>(
      `EXPLAIN QUERY PLAN SELECT id FROM sessions
       WHERE user_id = ? AND (CASE WHEN json_valid(metadata_json)
         THEN json_extract(metadata_json, '$.parentSessionId') END) = ?`,
      [USER_ID, 'mixed-root'],
    );
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/mixed-root',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().deletedSessionIds.sort()).toEqual([
        'mixed-grandchild',
        'mixed-malformed',
        'mixed-root',
        'mixed-team',
      ]);
      expect(
        dbModule.sqliteGet('SELECT id FROM sessions WHERE id = ?', ['other-child']),
      ).toBeDefined();
      expect(plan.some(({ detail }) => detail.includes('idx_sessions_metadata_parent'))).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('DELETE /sessions/:sessionId removes the index rows of the deleted session only', async () => {
    seedSession('sess-delete-root');
    seedSession('sess-delete-survivor');
    await appendIndexedMessage('sess-delete-root', 'deleted-one');
    await appendIndexedMessage('sess-delete-root', 'deleted-two');
    await appendIndexedMessage('sess-delete-survivor', 'survivor-message');

    expect(countSearchRowsForSession('sess-delete-root')).toBe(2);
    // 消息写入会 emit 事件（`message.part.created` 携带完整 part），先确认确有事件行。
    expect(countEventLogRowsForAggregate('sess-delete-root')).toBeGreaterThan(0);
    expect(countEventSequencesForAggregate('sess-delete-root')).toBeGreaterThan(0);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-delete-root',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        deletedSessionIds: ['sess-delete-root'],
      });
    } finally {
      await app.close();
    }

    expect(countLegacyMessagesForSession('sess-delete-root')).toBe(0);
    expect(countSearchRowsForSession('sess-delete-root')).toBe(0);
    expect(countShadowContentRowsForSession('sess-delete-root')).toBe(0);
    // event_log / event_sequences 无 FK 级联，必须由删除流程显式清理。
    expect(countEventLogRowsForAggregate('sess-delete-root')).toBe(0);
    expect(countEventSequencesForAggregate('sess-delete-root')).toBe(0);
    // The surviving session must keep every one of its index rows.
    expect(countSearchRowsForSession('sess-delete-survivor')).toBe(1);
    expect(countShadowContentRowsForSession('sess-delete-survivor')).toBe(1);
    expect(countEventLogRowsForAggregate('sess-delete-survivor')).toBeGreaterThan(0);
    expect(countEventSequencesForAggregate('sess-delete-survivor')).toBeGreaterThan(0);
  });

  it('DELETE /sessions/:sessionId purges the index of every cascaded descendant session', async () => {
    seedSession('sess-tree-root');
    seedSession('sess-tree-child', { metadata: { parentSessionId: 'sess-tree-root' } });
    seedSession('sess-tree-team-child', { teamParentSessionId: 'sess-tree-root' });
    seedSession('sess-tree-unrelated');
    await appendIndexedMessage('sess-tree-root', 'root-message');
    await appendIndexedMessage('sess-tree-child', 'child-message');
    await appendIndexedMessage('sess-tree-team-child', 'team-child-message');
    await appendIndexedMessage('sess-tree-unrelated', 'unrelated-message');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-tree-root',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().deletedSessionIds.sort()).toEqual([
        'sess-tree-child',
        'sess-tree-root',
        'sess-tree-team-child',
      ]);
    } finally {
      await app.close();
    }

    for (const sessionId of ['sess-tree-root', 'sess-tree-child', 'sess-tree-team-child']) {
      expect(countSearchRowsForSession(sessionId)).toBe(0);
      expect(countShadowContentRowsForSession(sessionId)).toBe(0);
    }
    expect(countSearchRowsForSession('sess-tree-unrelated')).toBe(1);
  });

  it('DELETE /team/workspaces/:teamWorkspaceId keeps the workspace sessions and their index rows', async () => {
    seedTeamWorkspace();
    seedSession('sess-workspace-kept', { metadata: { teamWorkspaceId: TEAM_WORKSPACE_ID } });
    await appendIndexedMessage('sess-workspace-kept', 'workspace-message');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(204);
    } finally {
      await app.close();
    }

    const workspace = dbModule.sqliteGet<{ id: string }>(
      'SELECT id FROM team_workspaces WHERE id = ?',
      [TEAM_WORKSPACE_ID],
    );
    expect(workspace).toBeUndefined();

    const session = dbModule.sqliteGet<{ id: string }>('SELECT id FROM sessions WHERE id = ?', [
      'sess-workspace-kept',
    ]);
    expect(session).toBeDefined();
    expect(countSearchRowsForSession('sess-workspace-kept')).toBe(1);
  });

  it('deleting a team workspace session through the session route leaves no index rows', async () => {
    seedTeamWorkspace();
    seedSession('sess-workspace-root', { metadata: { teamWorkspaceId: TEAM_WORKSPACE_ID } });
    seedSession('sess-workspace-pm1', {
      metadata: { teamWorkspaceId: TEAM_WORKSPACE_ID },
      teamParentSessionId: 'sess-workspace-root',
    });
    await appendIndexedMessage('sess-workspace-root', 'reception-message');
    await appendIndexedMessage('sess-workspace-pm1', 'pm1-message');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-workspace-root',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    expect(countSearchRowsForSession('sess-workspace-root')).toBe(0);
    expect(countSearchRowsForSession('sess-workspace-pm1')).toBe(0);
  });
});
