import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamInitRoutesModule from '../../routes/team-init.js';
import type * as PlannerModule from '../../team/init/team-init-planner.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

// 无 LLM：understand-architecture 走启发式兜底（不影响路由层断言）。
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamInitRoutes: typeof TeamInitRoutesModule.teamInitRoutes;
let planner: typeof PlannerModule;

const USER_ID = 'u-team-init-route';
const TEAM_WORKSPACE_ID = 'tw-team-init-route';
const SESSION_ID = 's-team-init-route';

let workspaceRoots: string[] = [];

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamInitRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

async function seedSessionWithPlan(workingRoot: string): Promise<void> {
  const state = await planner.planTeamInit({
    workingRoot,
    teamWorkspaceId: TEAM_WORKSPACE_ID,
    userId: USER_ID,
  });
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status, role_layer)
     VALUES (?, ?, 'team-init-route', ?, 'idle', 'reception')`,
    [
      SESSION_ID,
      USER_ID,
      JSON.stringify({
        teamWorkspaceId: TEAM_WORKSPACE_ID,
        workingDirectory: workingRoot,
        teamInit: state,
      }),
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamInitRoutes = (await import('../../routes/team-init.js')).teamInitRoutes;
  planner = await import('../../team/init/team-init-planner.js');
  workspaceRoots = [mkdtempSync(join(tmpdir(), 'openawork-team-init-route-'))];
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
  for (const root of workspaceRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('team init routes', () => {
  it('GET /team/sessions/:id/init 需要认证', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: 'GET', url: `/team/sessions/${SESSION_ID}/init` });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('GET /team/sessions/:id/init 对不存在会话返回结构化 404', async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/team/sessions/missing-session/init',
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'team_session_not_found' });
    } finally {
      await app.close();
    }
  });

  it('GET /team/sessions/:id/init 返回该会话的 teamInit', async () => {
    const dir = join(workspaceRoots[0]!, 'get-init');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await seedSessionWithPlan(dir);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'GET',
        url: `/team/sessions/${SESSION_ID}/init`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { teamInit: { projectKind: string; phase: string } };
      expect(body.teamInit.projectKind).toBe('existing');
      expect(body.teamInit.phase).toBe('proposed');
    } finally {
      await app.close();
    }
  });

  it('POST confirm 对非法 stepKey 返回结构化 404', async () => {
    const dir = join(workspaceRoots[0]!, 'confirm-bad-step');
    mkdirSync(dir, { recursive: true });
    await seedSessionWithPlan(dir);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/init/steps/not-a-step/confirm`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'team_init_step_not_found' });
    } finally {
      await app.close();
    }
  });

  it('POST confirm 执行 read-project-level1 后步骤标记 done', async () => {
    const dir = join(workspaceRoots[0]!, 'confirm-level1');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await seedSessionWithPlan(dir);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/init/steps/read-project-level1/confirm`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        teamInit: { steps: Array<{ key: string; status: string }> };
      };
      const step = body.teamInit.steps.find((s) => s.key === 'read-project-level1');
      expect(step?.status).toBe('done');
    } finally {
      await app.close();
    }
  });

  it('POST skip 单步 → 标记 skipped', async () => {
    const dir = join(workspaceRoots[0]!, 'skip-step');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"demo"}', 'utf8');
    await seedSessionWithPlan(dir);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/init/steps/extract-project-memory/skip`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        teamInit: { steps: Array<{ key: string; status: string }> };
      };
      const step = body.teamInit.steps.find((s) => s.key === 'extract-project-memory');
      expect(step?.status).toBe('skipped');
    } finally {
      await app.close();
    }
  });

  it('POST /init/skip → 整体 phase 置 skipped', async () => {
    const dir = join(workspaceRoots[0]!, 'skip-all');
    mkdirSync(dir, { recursive: true });
    await seedSessionWithPlan(dir);

    const app = await buildApp();
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/team/sessions/${SESSION_ID}/init/skip`,
        headers: { authorization: bearer(app) },
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { teamInit: { phase: string } }).teamInit.phase).toBe('skipped');
    } finally {
      await app.close();
    }
  });
});
