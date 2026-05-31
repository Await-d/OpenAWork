import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SkillsRoutesModule from '../../routes/skills.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'skills-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let builtinRegistrySourceId: string;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let skillsRoutes: typeof SkillsRoutesModule.skillsRoutes;

const USER_ID = 'u-skills-routes';

const originalFetch = globalThis.fetch;

function installedManifest(skillId: string) {
  return {
    apiVersion: 'agent-skill/v1',
    id: skillId,
    name: skillId,
    displayName: skillId,
    version: '1.0.0',
    description: `Skill ${skillId}`,
    capabilities: [],
    permissions: [],
  };
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(skillsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'skills@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedInstalledSkill(skillId: string, enabled: 0 | 1 = 1): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
      (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', ?, ?, ?)`,
    [skillId, USER_ID, JSON.stringify(installedManifest(skillId)), enabled, now, now],
  );
}

function seedCorruptInstalledSkill(skillId: string): void {
  const now = Date.now();
  // manifest_json is deliberately not valid JSON, simulating a crash
  // mid-write / disk error / hand-edited DB.
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
      (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', 1, ?, ?)`,
    [skillId, USER_ID, '{not valid json', now, now],
  );
}

function seedRegistrySource(sourceId: string): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO registry_sources
      (id, user_id, name, url, type, trust, enabled, priority)
     VALUES (?, ?, ?, 'https://registry.example.com', 'http', 'community', 1, 10)`,
    [sourceId, USER_ID, sourceId],
  );
}

function cachedSkillEntry(skillId: string) {
  return {
    id: skillId,
    name: skillId,
    displayName: skillId,
    version: '1.0.0',
    description: `Cached ${skillId}`,
    category: 'other',
    sourceId: 'src-a',
    tags: [],
  };
}

function seedCachedSkill(sourceId: string, skillId: string, entryJson?: string): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO registry_source_skill_cache
      (source_id, user_id, skill_id, category, search_text, entry_json, updated_at)
     VALUES (?, ?, ?, 'other', ?, ?, ?)`,
    [
      sourceId,
      USER_ID,
      skillId,
      skillId.toLowerCase(),
      entryJson ?? JSON.stringify(cachedSkillEntry(skillId)),
      now,
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  const skillsRouteModule = await import('../../routes/skills.js');
  skillsRoutes = skillsRouteModule.skillsRoutes;
  builtinRegistrySourceId = skillsRouteModule.BUILTIN_REGISTRY_SOURCES[0]?.id ?? 'builtin';
});

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => {
    return new Response(JSON.stringify({ items: [], plugins: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  dbModule.sqliteRun('DELETE FROM registry_source_skill_cache', []);
  dbModule.sqliteRun('DELETE FROM registry_sources', []);
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('skills routes', () => {
  it('POST /skills/install 在缺少 body 时返回中文 400，而不是崩溃成 500', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/install',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '缺少技能标识或请求参数无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /skills/installed/:skillId/enable 兼容前端旧路径并更新启用状态', async () => {
    seedInstalledSkill('skill-demo', 1);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/skills/installed/skill-demo/enable',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        skillId: 'skill-demo',
        enabled: false,
      });

      const row = dbModule.sqliteGet<{ enabled: number }>(
        'SELECT enabled FROM installed_skills WHERE skill_id = ? AND user_id = ?',
        ['skill-demo', USER_ID],
      );
      expect(row?.enabled).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('DELETE /skills/installed/:skillId 对未安装技能返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/skills/installed/missing-skill',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标技能尚未安装。（missing-skill）',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /skills/registry-sources 在参数缺失时返回中文 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/registry-sources',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '注册源参数无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('POST /skills/registry-sources 对系统保留 id 返回中文 409', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/skills/registry-sources',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {
          id: builtinRegistrySourceId,
          name: 'Reserved',
          url: 'https://registry.example.com',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        error: '注册源标识被系统保留，不能使用。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /skills/registry-sources/:sourceId 在缺少 enabled 时返回中文 400，而不是 500', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/skills/registry-sources/source-a',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: '缺少启用状态参数或请求参数无效。',
      });
    } finally {
      await app.close();
    }
  });

  it('DELETE /skills/registry-sources/:sourceId 对不存在的注册源返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/skills/registry-sources/source-missing',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标注册源不存在。',
      });
    } finally {
      await app.close();
    }
  });

  it('PATCH /skills/registry-sources/:sourceId 对内置注册源返回中文 403', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/skills/registry-sources/${encodeURIComponent(builtinRegistrySourceId)}`,
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: { enabled: false },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: '内置注册源不允许切换启用状态。',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /skills/:skillId 对不存在技能返回中文 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/skills/missing-skill',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({
        error: '目标技能不存在。（missing-skill）',
      });
    } finally {
      await app.close();
    }
  });

  it('GET /skills/installed 含一条损坏行时跳过它而不是整列 500', async () => {
    seedInstalledSkill('skill-good', 1);
    seedCorruptInstalledSkill('skill-corrupt');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/skills/installed',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const skills = response.json().skills as Array<{ skillId: string }>;
      const ids = skills.map((s) => s.skillId);
      expect(ids).toContain('skill-good');
      expect(ids).not.toContain('skill-corrupt');
    } finally {
      await app.close();
    }
  });

  it('GET /skills/search 含一条损坏缓存条目时跳过它而不是整列 500', async () => {
    seedRegistrySource('src-a');
    seedCachedSkill('src-a', 'cached-good');
    seedCachedSkill('src-a', 'cached-corrupt', '{broken json');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/skills/search?q=cached',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const skills = response.json().skills as Array<{ id: string }>;
      const ids = skills.map((s) => s.id);
      expect(ids).toContain('cached-good');
      expect(ids).not.toContain('cached-corrupt');
    } finally {
      await app.close();
    }
  });

  it('GET /skills/:skillId 缓存条目 manifestUrl 响应体超内存上限时降级为缓存而非缓冲', async () => {
    // §0.125: a cached skill entry's `manifestUrl` is persisted verbatim from a
    // user-added registry source's search payload, so it is user-controlled. The
    // detail route fetches it and reads the body — without a byte cap a hostile
    // registry could stream gigabytes and OOM the gateway. The read is now
    // bounded; on over-limit it throws, the route catches it and degrades to the
    // cache fallback (readme: '') instead of buffering the oversized body.
    process.env['OPENAWORK_SKILL_MANIFEST_MAX_BYTES'] = '64';
    seedRegistrySource('src-a');
    seedCachedSkill(
      'src-a',
      'cached-huge',
      JSON.stringify({
        id: 'cached-huge',
        name: 'cached-huge',
        displayName: 'cached-huge',
        version: '1.0.0',
        description: 'Cached cached-huge',
        category: 'other',
        sourceId: 'src-a',
        tags: [],
        manifestUrl: 'https://registry.example.com/skills/cached-huge/SKILL.md',
      }),
    );
    // The manifest fetch returns a body far exceeding the 64-byte cap.
    globalThis.fetch = vi.fn(async () => {
      return new Response('x'.repeat(50_000), {
        status: 200,
        headers: { 'content-type': 'text/markdown' },
      });
    }) as typeof fetch;

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/skills/cached-huge',
        headers: { authorization: bearer(app) },
      });

      // Over-limit read is caught → cache fallback, not a 500 and not the body.
      expect(response.statusCode).toBe(200);
      const body = response.json() as { id: string; readme: string };
      expect(body.id).toBe('cached-huge');
      expect(body.readme).toBe('');
    } finally {
      delete process.env['OPENAWORK_SKILL_MANIFEST_MAX_BYTES'];
      await app.close();
    }
  });
});
