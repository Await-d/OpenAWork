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
import { mkdtempSync, rmSync } from 'node:fs';
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
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('session deletion keeps the search index consistent', () => {
  it('DELETE /sessions/:sessionId removes the index rows of the deleted session only', async () => {
    seedSession('sess-delete-root');
    seedSession('sess-delete-survivor');
    await appendIndexedMessage('sess-delete-root', 'deleted-one');
    await appendIndexedMessage('sess-delete-root', 'deleted-two');
    await appendIndexedMessage('sess-delete-survivor', 'survivor-message');

    expect(countSearchRowsForSession('sess-delete-root')).toBe(2);

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
    // The surviving session must keep every one of its index rows.
    expect(countSearchRowsForSession('sess-delete-survivor')).toBe(1);
    expect(countShadowContentRowsForSession('sess-delete-survivor')).toBe(1);
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
