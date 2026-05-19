/**
 * Fastify route coverage for `/skills/selection` and its session-override
 * variants. Uses a real in-memory SQLite migrated through `migrate()` so
 * every query path the routes touch is exercised end-to-end.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as AuthModule from '../../auth.js';
import type * as RequestWorkflowModule from '../../request-workflow.js';
import type * as SkillSelectionRoutesModule from '../../routes/skill-selection.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let skillSelectionRoutes: typeof SkillSelectionRoutesModule.skillSelectionRoutes;

const USER_ID = 'u-routes';
const OTHER_USER_ID = 'u-other';
const SESSION_ID = 's-routes';
const OTHER_SESSION_ID = 's-other';
const WORKSPACE_A = '/home/alice/projects/alpha';

function installedManifest(id: string) {
  return {
    apiVersion: 'agent-skill/v1',
    id,
    name: id.split('.').pop() ?? id,
    displayName: id,
    version: '1.0.0',
    description: `Skill ${id}`,
    capabilities: [],
    permissions: [],
  };
}

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string, metadata?: object): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', ?)`,
    [sessionId, userId, metadata ? JSON.stringify(metadata) : null],
  );
}

function seedInstalled(userId: string, id: string, enabled: 0 | 1 = 1): void {
  const manifest = installedManifest(id);
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', ?, ?, ?)`,
    [id, userId, JSON.stringify(manifest), enabled, now, now],
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(skillSelectionRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function resetState(): void {
  dbModule.sqliteRun('DELETE FROM chat_session_skill_overrides');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_selections');
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_configured');
  dbModule.sqliteRun('DELETE FROM installed_skills');
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
}

beforeAll(async () => {
  dbModule = await import('../../db.js');
  authPlugin = (await import('../../auth.js')).default;
  requestWorkflowPlugin = (await import('../../request-workflow.js')).default;
  skillSelectionRoutes = (await import('../../routes/skill-selection.js')).skillSelectionRoutes;
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  resetState();
  seedUser(USER_ID, 'u@example.com');
  seedUser(OTHER_USER_ID, 'o@example.com');
  seedSession(SESSION_ID, USER_ID, { workingDirectory: WORKSPACE_A });
  seedSession(OTHER_SESSION_ID, OTHER_USER_ID);
});

describe('PUT /skills/selection', () => {
  it('rejects unauthenticated callers', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      payload: { workspacePath: WORKSPACE_A, items: [] },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('writes the full selection set and is idempotent across calls', async () => {
    seedInstalled(USER_ID, 'com.example.a');
    seedInstalled(USER_ID, 'com.example.b');
    const app = await buildApp();

    const first = await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [
          { skillId: 'com.example.a', enabled: true, pinned: true, reason: 'core' },
          { skillId: 'com.example.b', enabled: false, pinned: false },
        ],
      },
    });
    expect(first.statusCode).toBe(200);

    // Second PUT with fewer items fully replaces state — `com.example.b`
    // must be gone, not merged.
    const second = await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [{ skillId: 'com.example.a', enabled: true, pinned: false }],
      },
    });
    expect(second.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/skills/selection?workspacePath=${encodeURIComponent(WORKSPACE_A)}`,
      headers: { authorization: bearer(app) },
    });
    const body = JSON.parse(get.body) as {
      workspaceSelections: Array<{ skillId: string; enabled: boolean; pinned: boolean }>;
    };
    expect(body.workspaceSelections).toEqual([
      {
        skillId: 'com.example.a',
        enabled: true,
        pinned: false,
        reason: null,
        source: 'manual',
        updatedAt: expect.any(Number),
        priority: 0,
      },
    ]);
    await app.close();
  });

  it('persists an explicitly empty selection set so the resolver no longer falls back to installed_skills', async () => {
    // Regression for the spec follow-up where an empty `items` array used to
    // be indistinguishable from "never configured" and re-enabled every
    // installed skill via fallback.
    seedInstalled(USER_ID, 'com.example.a');
    seedInstalled(USER_ID, 'com.example.b');
    const app = await buildApp();

    const put = await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: { workspacePath: WORKSPACE_A, items: [] },
    });
    expect(put.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/skills/selection?workspacePath=${encodeURIComponent(WORKSPACE_A)}`,
      headers: { authorization: bearer(app) },
    });
    const body = JSON.parse(get.body) as {
      workspaceSelections: unknown[];
      effective: Array<{ skillId: string; origin: string }>;
    };
    expect(body.workspaceSelections).toEqual([]);
    // Effective set should be BUILTIN-only, not the fallback union of every
    // installed skill.
    expect(body.effective.every((entry) => entry.origin === 'builtin')).toBe(true);
    expect(body.effective.some((entry) => entry.skillId === 'com.example.a')).toBe(false);
    await app.close();
  });

  it('persists priority based on items array order so reordered PUTs round-trip through GET', async () => {
    seedInstalled(USER_ID, 'com.example.alpha');
    seedInstalled(USER_ID, 'com.example.bravo');
    seedInstalled(USER_ID, 'com.example.charlie');
    const app = await buildApp();

    await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [
          { skillId: 'com.example.charlie', enabled: true, pinned: true },
          { skillId: 'com.example.alpha', enabled: true, pinned: true },
          { skillId: 'com.example.bravo', enabled: true, pinned: false },
        ],
      },
    });

    const get = await app.inject({
      method: 'GET',
      url: `/skills/selection?workspacePath=${encodeURIComponent(WORKSPACE_A)}`,
      headers: { authorization: bearer(app) },
    });
    const body = JSON.parse(get.body) as {
      workspaceSelections: Array<{ skillId: string; priority: number }>;
      effective: Array<{ skillId: string; origin: string }>;
    };
    expect(body.workspaceSelections.map((row) => row.skillId)).toEqual([
      'com.example.charlie',
      'com.example.alpha',
      'com.example.bravo',
    ]);
    expect(body.workspaceSelections.map((row) => row.priority)).toEqual([0, 1, 2]);
    // Effective set must follow the same priority ordering for non-builtin
    // entries — pinned-skills-prompt iterates effective in this order.
    const nonBuiltinIds = body.effective
      .filter((entry) => entry.origin !== 'builtin')
      .map((entry) => entry.skillId);
    expect(nonBuiltinIds).toEqual([
      'com.example.charlie',
      'com.example.alpha',
      'com.example.bravo',
    ]);

    await app.close();
  });

  it('refuses to write BUILTIN skill ids through the selection API', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [{ skillId: 'com.openAwork.builtin.git-master', enabled: true }],
      },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe('GET /skills/selection', () => {
  it('returns effective set with BUILTIN + workspace rows after a PUT', async () => {
    seedInstalled(USER_ID, 'com.example.a');
    const app = await buildApp();

    await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [{ skillId: 'com.example.a', enabled: true, pinned: true }],
      },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/skills/selection?workspacePath=${encodeURIComponent(WORKSPACE_A)}&sessionId=${SESSION_ID}`,
      headers: { authorization: bearer(app) },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      effective: Array<{ skillId: string; origin: string; enabled: boolean; pinned: boolean }>;
    };
    expect(
      body.effective.some((e) => e.skillId === 'com.example.a' && e.origin === 'workspace'),
    ).toBe(true);
    expect(body.effective.some((e) => e.origin === 'builtin')).toBe(true);
    await app.close();
  });

  it('404s when session belongs to another user', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/skills/selection?sessionId=${OTHER_SESSION_ID}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('PATCH /skills/selection/session/:sessionId', () => {
  it('upserts session overrides and reflects them in the effective set', async () => {
    seedInstalled(USER_ID, 'com.example.a');
    const app = await buildApp();

    await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [{ skillId: 'com.example.a', enabled: true, pinned: false }],
      },
    });

    const patch = await app.inject({
      method: 'PATCH',
      url: `/skills/selection/session/${SESSION_ID}`,
      headers: { authorization: bearer(app) },
      payload: {
        items: [{ skillId: 'com.example.a', enabled: false }],
      },
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.parse(patch.body) as {
      effective: Array<{ skillId: string; origin: string; enabled: boolean }>;
    };
    const match = body.effective.find((e) => e.skillId === 'com.example.a');
    expect(match).toMatchObject({ origin: 'session-override', enabled: false });
    await app.close();
  });

  it('404s when patching another user session', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: `/skills/selection/session/${OTHER_SESSION_ID}`,
      headers: { authorization: bearer(app) },
      payload: { items: [] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /skills/selection/session/:sessionId', () => {
  it('clears overrides and restores workspace defaults', async () => {
    seedInstalled(USER_ID, 'com.example.a');
    const app = await buildApp();

    await app.inject({
      method: 'PUT',
      url: '/skills/selection',
      headers: { authorization: bearer(app) },
      payload: {
        workspacePath: WORKSPACE_A,
        items: [{ skillId: 'com.example.a', enabled: true, pinned: true }],
      },
    });

    await app.inject({
      method: 'PATCH',
      url: `/skills/selection/session/${SESSION_ID}`,
      headers: { authorization: bearer(app) },
      payload: { items: [{ skillId: 'com.example.a', enabled: false }] },
    });

    const del = await app.inject({
      method: 'DELETE',
      url: `/skills/selection/session/${SESSION_ID}`,
      headers: { authorization: bearer(app) },
    });
    expect(del.statusCode).toBe(200);

    const get = await app.inject({
      method: 'GET',
      url: `/skills/selection?workspacePath=${encodeURIComponent(WORKSPACE_A)}&sessionId=${SESSION_ID}`,
      headers: { authorization: bearer(app) },
    });
    const body = JSON.parse(get.body) as {
      effective: Array<{ skillId: string; origin: string; enabled: boolean; pinned: boolean }>;
      sessionOverrides: unknown[];
    };
    expect(body.sessionOverrides).toHaveLength(0);
    const match = body.effective.find((e) => e.skillId === 'com.example.a');
    expect(match).toMatchObject({ origin: 'workspace', enabled: true, pinned: true });
    await app.close();
  });
});
