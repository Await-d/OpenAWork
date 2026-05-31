import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamRoutesModule from '../../routes/team.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
}));

// Partial-mock ./sessions.js so buildMergedSessionTaskProjection throws for a
// specific "poisoned" session while every other export is the real one. This
// deterministically reproduces a per-session task-graph load failure (hard
// I/O) without corrupting on-disk state.
const POISON_SESSION_ID = 's-task-projection-poison';
vi.mock('../../routes/sessions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionsRoutesModule>();
  return {
    ...actual,
    buildMergedSessionTaskProjection: vi.fn(async (input: { sessionId: string }) => {
      if (input.sessionId === POISON_SESSION_ID) {
        throw new Error('simulated task-graph load failure');
      }
      return { tasks: [], updatedAt: 0 };
    }),
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamRoutes: typeof TeamRoutesModule.teamRoutes;

const USER_ID = 'u-team-task-projection';
const TEAM_WORKSPACE_ID = 'tw-task-projection';
const SESSION_OK_ID = 's-task-projection-ok';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedWorkspace(): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO team_workspaces (id, user_id, name) VALUES (?, ?, '任务投影测试工作区')`,
    [TEAM_WORKSPACE_ID, USER_ID],
  );
}

function seedTeamSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'team-session', ?, 'idle')`,
    [sessionId, USER_ID, JSON.stringify({ teamWorkspaceId: TEAM_WORKSPACE_ID })],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamRoutes = (await import('../../routes/team.js')).teamRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM team_workspaces', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedWorkspace();
  seedTeamSession(SESSION_OK_ID);
  seedTeamSession(POISON_SESSION_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /team/workspaces/:id/runtime 任务投影行级韧性', () => {
  it('单个会话任务投影抛错时整张工作区运行时面板不 500', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/team/workspaces/${TEAM_WORKSPACE_ID}/runtime`,
        headers: { authorization: bearer(app) },
      });

      // The poisoned session's projection threw, but the dashboard must still
      // return 200 with both sessions listed (degraded, not failed).
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Both team sessions are still listed (the row read does not depend on
      // the task projection).
      const sessionIds = (body.sessions as Array<{ id: string }>).map((s) => s.id);
      expect(sessionIds).toContain(SESSION_OK_ID);
      expect(sessionIds).toContain(POISON_SESSION_ID);
      // The dashboard degraded the poisoned session instead of rejecting: the
      // response carries runtimeTaskGroups and a warn was logged for the bad row.
      expect(Array.isArray(body.runtimeTaskGroups)).toBe(true);
      expect(warn).toHaveBeenCalled();
    } finally {
      await app.close();
      warn.mockRestore();
    }
  });
});
