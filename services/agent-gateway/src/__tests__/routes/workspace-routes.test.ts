import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as WorkspaceRoutesModule from '../../routes/workspace.js';
import type * as UserWorkspaceAllowlistModule from '../../workspace/user-workspace-allowlist.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-workspace-routes-'));
const outsideRoot = mkdtempSync(join(tmpdir(), 'openawork-workspace-outside-'));
const projectRoot = join(workspaceRoot, 'demo-project');

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'workspace-route-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let resetUserWorkspaceAllowlistCache: typeof UserWorkspaceAllowlistModule.__resetUserWorkspaceAllowlistCacheForTest;
let workspaceRoutes: typeof WorkspaceRoutesModule.workspaceRoutes;

const USER_ID = 'u-workspace-routes';
const SESSION_ID = 's-workspace-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(workspaceRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'workspace@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedWorkspaceSession(rootPath: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'workspace', ?, 'idle')`,
    [SESSION_ID, USER_ID, JSON.stringify({ workingDirectory: rootPath })],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  workspaceRoutes = (await import('../../routes/workspace.js')).workspaceRoutes;
  resetUserWorkspaceAllowlistCache = (await import('../../workspace/user-workspace-allowlist.js'))
    .__resetUserWorkspaceAllowlistCacheForTest;
});

beforeEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  mkdirSync(projectRoot, { recursive: true });
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  resetUserWorkspaceAllowlistCache();
  seedUser(USER_ID);
  seedWorkspaceSession(projectRoot);
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(outsideRoot, { recursive: true, force: true });
});

describe('workspace routes', () => {
  it('GET /workspace/validate 对全局工作区白名单外路径返回中文 403', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/workspace/validate?path=${encodeURIComponent(outsideRoot)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        valid: false,
        path: outsideRoot,
        error: '工作区路径不在允许范围内。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /workspace/tree 对用户未注册的工作区路径返回中文权限错误', async () => {
    const otherProject = join(workspaceRoot, 'other-project');
    mkdirSync(otherProject, { recursive: true });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/workspace/tree?path=${encodeURIComponent(otherProject)}&depth=1`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: '当前账号无权访问该工作区路径。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /workspace/tree 对文件路径返回中文文件夹错误', async () => {
    const filePath = join(projectRoot, 'README.md');
    writeFileSync(filePath, '# demo\n', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/workspace/tree?path=${encodeURIComponent(filePath)}&depth=1`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        nodes: [],
        error: '目标路径不是文件夹。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /workspace/file 对超出指定 workspaceRoot 的文件返回中文越界错误', async () => {
    const filePath = join(projectRoot, 'notes.txt');
    const nestedRoot = join(projectRoot, 'nested');
    mkdirSync(nestedRoot, { recursive: true });
    writeFileSync(filePath, 'hello', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/file?path=${encodeURIComponent(filePath)}` +
          `&workspaceRoot=${encodeURIComponent(nestedRoot)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: '目标路径超出当前工作区范围。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /workspace/file 对已存在文件返回中文 409', async () => {
    const filePath = join(projectRoot, 'existing.ts');
    writeFileSync(filePath, 'export {};\n', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workspace/file',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          path: filePath,
          content: 'next',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: '目标文件已存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /workspace/review/diff 对非法 filePath 返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url:
          `/workspace/review/diff?path=${encodeURIComponent(projectRoot)}` +
          `&filePath=${encodeURIComponent('../escape.ts')}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        diff: '',
        error: '目标文件路径无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('DELETE /workspace/entry 支持基于 session 工作区解析相对路径', async () => {
    const filePath = join(projectRoot, 'src', 'index.ts');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(filePath, 'export {};\n', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url:
          `/workspace/entry?path=${encodeURIComponent('src/index.ts')}` +
          `&sessionId=${encodeURIComponent(SESSION_ID)}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, path: filePath });
    } finally {
      await app.close();
    }
  });

  it('POST /workspace/rename 支持基于 session 工作区解析相对路径', async () => {
    const sourcePath = join(projectRoot, 'src', 'index.ts');
    const targetPath = join(projectRoot, 'src', 'main.ts');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(sourcePath, 'export {};\n', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workspace/rename',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          oldPath: 'src/index.ts',
          newPath: 'src/main.ts',
          sessionId: SESSION_ID,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        ok: true,
        oldPath: sourcePath,
        newPath: targetPath,
      });
    } finally {
      await app.close();
    }
  });

  it('POST /workspace/rename 在目标已存在时返回中文 409 且不覆盖目标文件', async () => {
    const sourcePath = join(projectRoot, 'src', 'index.ts');
    const targetPath = join(projectRoot, 'src', 'main.ts');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(sourcePath, 'source\n', 'utf8');
    writeFileSync(targetPath, 'target\n', 'utf8');

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/workspace/rename',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          oldPath: 'src/index.ts',
          newPath: 'src/main.ts',
          sessionId: SESSION_ID,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: '目标文件已存在。',
      });
      expect(readFileSync(sourcePath, 'utf8')).toBe('source\n');
      expect(readFileSync(targetPath, 'utf8')).toBe('target\n');
    } finally {
      await app.close();
    }
  });
});
