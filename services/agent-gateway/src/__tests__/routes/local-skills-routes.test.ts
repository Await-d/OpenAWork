import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as LocalSkillsRoutesModule from '../../routes/local-skills.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-local-skills-'));
const outsideRoot = mkdtempSync(join(tmpdir(), 'openawork-local-skills-outside-'));
const installDir = join(workspaceRoot, 'demo-skill');
const USER_ID = 'u-local-skills-routes';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'local-skills-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let localSkillsRoutes: typeof LocalSkillsRoutesModule.localSkillsRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(localSkillsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'local-skills@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  localSkillsRoutes = (await import('../../routes/local-skills.js')).localSkillsRoutes;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
});

beforeEach(() => {
  rmSync(installDir, { recursive: true, force: true });
  mkdirSync(installDir, { recursive: true });
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe('local skills routes', () => {
  it('POST /skills/local/install 在缺少目录参数时返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/local/install',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '本地技能目录参数无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /skills/local/install 对工作区范围外目录返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/local/install',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          dirPath: outsideRoot,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '本地技能目录必须位于已配置的工作区范围内。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /skills/local/install 对缺少 skill.yaml 的目录返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/local/install',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          dirPath: installDir,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '指定目录下未找到 skill.yaml。',
      });
    } finally {
      await app.close();
    }
  });
});
