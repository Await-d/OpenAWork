/**
 * 会话扩展 HTTP 路由回归（Fastify inject + 真实内存 SQLite）。
 *
 * 重点：归属校验（跨用户一律 404）、提案 → 确认 → 生效的完整链路、
 * 以及「非管理员不能确认」。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as RoutesModule from '../../routes/session-extensions.js';
import type * as SkillsRoutesModule from '../../routes/skills.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const registryMock = vi.hoisted(() => ({ installMock: vi.fn() }));

vi.mock('../../routes/skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SkillsRoutesModule>();
  return {
    ...actual,
    createRegistryClient: () => ({ install: registryMock.installMock, search: async () => [] }),
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionExtensionsRoutes: typeof RoutesModule.sessionExtensionsRoutes;

const OWNER = 'u-xr-owner';
const OTHER = 'u-xr-other';
const CH_SESSION = 's-xr-ch';
const OTHER_SESSION = 's-xr-other';

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(id: string, userId: string, metadata: object): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', ?, 'idle')`,
    [id, userId, JSON.stringify(metadata)],
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionExtensionsRoutes);
  await app.ready();
  return app;
}

/** owner 自己的令牌；测试里 owner 即管理员（隐式）。 */
function bearer(app: FastifyInstance, userId = OWNER): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function resetState(): void {
  dbModule.sqliteRun('DELETE FROM session_extension_operations');
  dbModule.sqliteRun('DELETE FROM session_skill_installations');
  dbModule.sqliteRun('DELETE FROM session_mcp_servers');
  dbModule.sqliteRun('DELETE FROM session_extension_settings');
  dbModule.sqliteRun('DELETE FROM session_extension_admins');
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionExtensionsRoutes = (await import('../../routes/session-extensions.js'))
    .sessionExtensionsRoutes;
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  registryMock.installMock.mockReset();
  registryMock.installMock.mockResolvedValue({
    skillId: 'demo',
    sourceId: 'builtin',
    manifest: {
      apiVersion: 'agent-skill/v1',
      id: 'demo',
      name: 'demo',
      displayName: 'demo',
      version: '1.0.0',
      description: 'd',
      capabilities: [],
      permissions: [],
    },
    grantedPermissions: [],
    installedAt: Date.now(),
    updatedAt: Date.now(),
  });

  resetState();
  seedUser(OWNER);
  seedUser(OTHER);
  seedSession(CH_SESSION, OWNER, {
    source: 'channel',
    channelId: 'ch-1',
    channelExtensionManagementEnabled: true,
  });
  seedSession(OTHER_SESSION, OTHER, {});
});

describe('GET /sessions/:id/extensions', () => {
  it('未鉴权返回 401', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/sessions/${CH_SESSION}/extensions` });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('非归属会话返回 404（不泄露存在性）', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${OTHER_SESSION}/extensions`,
      headers: { authorization: bearer(app, OWNER) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('返回来源、管理开关、继承模式与 revision', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extensions`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body['source']).toBe('channel');
    expect(body['managementEnabled']).toBe(true);
    // 渠道开启扩展管理、尚未建设置行时，会话的实际策略是 `explicit`（来源感知默认值）。
    // 这个接口必须报**有效策略**，而不是「设置行 ?? inherit」——后者会把 `inherit`
    // 报给面板，而运行时按 `explicit` 执行，用户看到的与实际相反。
    expect(body['inheritance']).toBe('explicit');
    expect(body['revision']).toBe(0);
    await app.close();
  });
});

describe('PATCH /sessions/:id/extensions', () => {
  it('首次写入需要 expectedRevision = 0，随后 revision 自增', async () => {
    const app = await buildApp();
    const first = await app.inject({
      method: 'PATCH',
      url: `/sessions/${CH_SESSION}/extensions`,
      headers: { authorization: bearer(app) },
      payload: { inheritance: 'explicit', expectedRevision: 0 },
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/sessions/${CH_SESSION}/extensions`,
      headers: { authorization: bearer(app) },
      payload: { inheritance: 'explicit', expectedRevision: 0 },
    });
    expect(conflict.statusCode).toBe(409);
    await app.close();
  });
});

describe('提案 → 确认 链路', () => {
  async function createProposal(app: FastifyInstance): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations`,
      headers: { authorization: bearer(app) },
      payload: { kind: 'skill', skillId: 'demo' },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as Record<string, unknown>)['operationId'] as string;
  }

  async function nonceFor(
    app: FastifyInstance,
    operationId: string,
    userId = OWNER,
  ): Promise<string> {
    const detail = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}`,
      headers: { authorization: bearer(app, userId) },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.headers['cache-control']).toBe('no-store');
    return detail.json<{ operation: { nonce: string } }>().operation.nonce;
  }

  it('MCP 提案的详情带端点主机名，且不泄露完整 URL', async () => {
    // 确认页要让人看清「这次请求会发到哪里」——它读的正是 `preview.endpointHost`。
    // 此前预览根本没这个字段，那一行永远是空的，等于确认远程 MCP 时看不到端点。
    const app = await buildApp();
    const created = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations`,
      headers: { authorization: bearer(app) },
      payload: {
        kind: 'mcp',
        config: {
          id: 'e2e-remote',
          name: 'e2e-remote',
          transport: 'sse',
          url: 'https://mcp.example.com:8443/secret-path',
        },
      },
    });
    expect(created.statusCode).toBe(201);
    const operationId = created.json<{ operationId: string }>().operationId;

    const detail = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}`,
      headers: { authorization: bearer(app) },
    });
    expect(detail.statusCode).toBe(200);
    const preview = detail.json<{ operation: { preview: Record<string, unknown> } }>().operation
      .preview;
    expect(preview['endpointHost']).toBe('mcp.example.com:8443');
    // 路径不进预览：它既不是用户需要看的信息，也可能夹带实现细节。
    expect(detail.body).not.toContain('secret-path');
    await app.close();
  });

  it('缺失或错误 nonce 拒绝决策，正确 nonce 仍可使用且终态不回显', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);
    const url = `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`;
    const headers = { authorization: bearer(app) };
    expect(
      (await app.inject({ method: 'POST', url, headers, payload: { decision: 'approve' } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { decision: 'approve', nonce: '00000000-0000-4000-8000-000000000000' },
        })
      ).statusCode,
    ).toBe(403);
    const response = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { decision: 'reject', nonce },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(nonce);
    const terminal = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}`,
      headers,
    });
    expect(terminal.json<{ operation: { nonce?: string } }>().operation.nonce).toBeUndefined();
    await app.close();
  });

  it('委托管理员能读详情和确认，但不能修改会话配置', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    await app.inject({
      method: 'POST',
      url: '/settings/session-extension-admins',
      headers: { authorization: bearer(app) },
      payload: { adminUserId: OTHER },
    });
    const nonce = await nonceFor(app, operationId, OTHER);
    const headers = { authorization: bearer(app, OTHER) };
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/sessions/${CH_SESSION}/extensions`,
          headers,
          payload: { inheritance: 'explicit', expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
          headers,
          payload: { decision: 'approve', nonce },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
  });

  it('提案本身不安装；确认后才写入会话', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);

    // 提案后：会话技能表仍为空。
    const afterProposal = dbModule.sqliteGet<{ c: number }>(
      'SELECT COUNT(*) AS c FROM session_skill_installations',
    );
    expect(afterProposal?.c).toBe(0);

    const decision = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app) },
      payload: { decision: 'approve', nonce },
    });
    expect(decision.statusCode).toBe(200);
    const body = decision.json() as Record<string, unknown>;
    expect(body['ok']).toBe(true);
    expect(body['decision']).toBe('approved');

    const applied = dbModule.sqliteGet<{ c: number }>(
      'SELECT COUNT(*) AS c FROM session_skill_installations',
    );
    expect(applied?.c).toBe(1);
    await app.close();
  });

  it('重复确认返回 409，不产生第二次写入', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);
    await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app) },
      payload: { decision: 'approve', nonce },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app) },
      payload: { decision: 'approve', nonce },
    });
    expect(second.statusCode).toBe(409);
    await app.close();
  });

  it('拒绝后状态为 rejected，且不写入', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);
    const rejected = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app) },
      payload: { decision: 'reject', nonce, reason: '来源不可信' },
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as Record<string, unknown>)['decision']).toBe('rejected');

    const count = dbModule.sqliteGet<{ c: number }>(
      'SELECT COUNT(*) AS c FROM session_skill_installations',
    );
    expect(count?.c).toBe(0);
    await app.close();
  });

  it('详情不回显密钥字段', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations`,
      headers: { authorization: bearer(app) },
      payload: {
        kind: 'mcp',
        config: {
          id: 'local',
          name: 'local',
          transport: 'sse',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer SECRET' },
        },
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).not.toContain('Bearer SECRET');
    expect(
      dbModule.sqliteGet<{ c: number }>('SELECT COUNT(*) AS c FROM session_extension_operations')
        ?.c,
    ).toBe(0);
    await app.close();
  });

  it('取消后不可再确认', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);
    const cancelled = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/cancel`,
      headers: { authorization: bearer(app) },
    });
    expect(cancelled.statusCode).toBe(200);

    const decision = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app) },
      payload: { decision: 'approve', nonce },
    });
    expect(decision.statusCode).toBe(409);
    await app.close();
  });

  it('非归属用户访问他人会话的提案与确认一律 404', async () => {
    const app = await buildApp();
    const operationId = await createProposal(app);
    const nonce = await nonceFor(app, operationId);

    const detail = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}`,
      headers: { authorization: bearer(app, OTHER) },
    });
    expect(detail.statusCode).toBe(404);

    const decision = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extension-operations/${operationId}/decision`,
      headers: { authorization: bearer(app, OTHER) },
      payload: { decision: 'approve', nonce },
    });
    expect(decision.statusCode).toBe(404);
    await app.close();
  });
});

describe('会话凭据', () => {
  const SECRET_PATH = (name: string): string => `/sessions/${CH_SESSION}/extension-secrets/${name}`;

  it('owner 可录入与删除，响应和状态都不回显明文；委托管理员无权写入', async () => {
    const app = await buildApp();
    const headers = { authorization: bearer(app) };

    const put = await app.inject({
      method: 'PUT',
      url: SECRET_PATH('api-key'),
      headers,
      payload: { value: 'super-secret-value' },
    });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain('super-secret-value');
    expect(
      put.json<{ secrets: Array<{ name: string }> }>().secrets.map((entry) => entry.name),
    ).toEqual(['api-key']);

    const state = await app.inject({
      method: 'GET',
      url: `/sessions/${CH_SESSION}/extensions`,
      headers,
    });
    expect(state.body).not.toContain('super-secret-value');
    expect(
      state.json<{ secrets: Array<{ name: string }> }>().secrets.map((entry) => entry.name),
    ).toEqual(['api-key']);

    // 决策权不等于写入权：委托管理员不能把凭据写进别人的会话。
    await app.inject({
      method: 'POST',
      url: '/settings/session-extension-admins',
      headers,
      payload: { adminUserId: OTHER },
    });
    const asAdmin = await app.inject({
      method: 'PUT',
      url: SECRET_PATH('admin-key'),
      headers: { authorization: bearer(app, OTHER) },
      payload: { value: 'x' },
    });
    expect(asAdmin.statusCode).toBe(404);

    const removed = await app.inject({ method: 'DELETE', url: SECRET_PATH('api-key'), headers });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ ok: boolean; secrets: unknown[] }>().ok).toBe(true);
    expect(removed.json<{ secrets: unknown[] }>().secrets).toEqual([]);
    await app.close();
  });

  it('非法凭据名与空值被拒绝', async () => {
    const app = await buildApp();
    const headers = { authorization: bearer(app) };
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: SECRET_PATH('bad:name'),
          headers,
          payload: { value: 'x' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: SECRET_PATH('api-key'),
          headers,
          payload: { value: '' },
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});

describe('禁用 / 移除会话条目', () => {
  function seedSessionSkill(): void {
    dbModule.sqliteRun(
      `INSERT INTO session_skill_installations
         (resource_ref, session_id, user_id, skill_id, source_id, version, manifest_json,
          content_digest, enabled, pinned, revision, installed_at, updated_at)
       VALUES (?, ?, ?, 'demo', 'builtin', '1.0.0', '{}', 'd1', 1, 0, 1, 1, 1)`,
      ['skill:session:demo', CH_SESSION, OWNER],
    );
  }

  it('禁用保留条目，移除后条目消失', async () => {
    const app = await buildApp();
    const headers = { authorization: bearer(app) };
    seedSessionSkill();

    const disabled = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extensions/revoke`,
      headers,
      payload: { kind: 'skill', resourceRef: 'skill:session:demo', remove: false },
    });
    expect(disabled.statusCode).toBe(200);
    const afterDisable = disabled.json<{ skills: Array<{ enabled: boolean }> }>().skills;
    expect(afterDisable).toHaveLength(1);
    expect(afterDisable[0]?.enabled).toBe(false);

    const removed = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extensions/revoke`,
      headers,
      payload: { kind: 'skill', resourceRef: 'skill:session:demo', remove: true },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json<{ skills: unknown[] }>().skills).toEqual([]);
    await app.close();
  });

  it('不存在的条目返回 404', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${CH_SESSION}/extensions/revoke`,
      headers: { authorization: bearer(app) },
      payload: { kind: 'mcp', resourceRef: 'mcp:session:missing', remove: true },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('管理员清单', () => {
  it('owner 不能把自己重复加进清单', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/settings/session-extension-admins',
      headers: { authorization: bearer(app) },
      payload: { adminUserId: OWNER },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('可以添加与移除管理员', async () => {
    const app = await buildApp();
    const added = await app.inject({
      method: 'POST',
      url: '/settings/session-extension-admins',
      headers: { authorization: bearer(app) },
      payload: { adminUserId: OTHER },
    });
    expect(added.statusCode).toBe(201);
    expect((added.json() as Record<string, unknown>)['admins']).toEqual([OTHER]);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/settings/session-extension-admins/${OTHER}`,
      headers: { authorization: bearer(app) },
    });
    expect(removed.statusCode).toBe(200);
    expect((removed.json() as Record<string, unknown>)['admins']).toEqual([]);
    await app.close();
  });
});
