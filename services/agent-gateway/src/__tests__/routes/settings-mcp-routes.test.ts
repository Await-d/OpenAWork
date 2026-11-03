import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';

const mcpRuntimeMock = vi.hoisted(() => ({
  isMcpServerConnectedForUserMock: vi.fn(() => false),
  listMcpToolsForUserMock: vi.fn(),
  loadConfiguredMcpServersForUserMock: vi.fn(() => [] as unknown[]),
  retryMcpConnectionForUserMock: vi.fn(),
  getMcpPoolKeyMock: vi.fn((server: { id?: string }) => `pool-${server.id ?? 'unknown'}`),
  invalidateMcpServerConnectionForUserMock: vi.fn(async () => undefined),
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: mcpRuntimeMock.isMcpServerConnectedForUserMock,
  listMcpToolsForUser: mcpRuntimeMock.listMcpToolsForUserMock,
  loadConfiguredMcpServersForUser: mcpRuntimeMock.loadConfiguredMcpServersForUserMock,
  retryMcpConnectionForUser: mcpRuntimeMock.retryMcpConnectionForUserMock,
  getMcpPoolKey: mcpRuntimeMock.getMcpPoolKeyMock,
  invalidateMcpServerConnectionForUser: mcpRuntimeMock.invalidateMcpServerConnectionForUserMock,
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: vi.fn(async () => null),
  resolveAuxiliaryLlmConfigCandidates: vi.fn(async () => []),
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: vi.fn(),
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'settings-mcp-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

type SettingsMcpServer = {
  readonly id: string;
};

type SettingsMcpServersResponse = {
  readonly servers: readonly SettingsMcpServer[];
  readonly builtinServers: readonly SettingsMcpServer[];
};

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-settings-mcp-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'settings-mcp@example.com' })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  mcpRuntimeMock.loadConfiguredMcpServersForUserMock.mockReset();
  mcpRuntimeMock.loadConfiguredMcpServersForUserMock.mockReturnValue([]);
  mcpRuntimeMock.invalidateMcpServerConnectionForUserMock.mockClear();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('settings MCP route contracts', () => {
  it('GET /settings/mcp-servers 返回同源 builtin、virtual 与 protected adapter 元数据', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json<SettingsMcpServersResponse>();
      expect(body.builtinServers.map((server) => server.id)).toEqual([
        'open_websearch',
        'websearch',
        'grep_app',
        'codegraph',
        'git_bash',
        'lsp',
      ]);
      const openWebsearch = body.builtinServers.find((server) => server.id === 'open_websearch');
      expect(openWebsearch).toMatchObject({
        builtinKind: 'adapter',
        source: 'system',
      });
      expect(openWebsearch).not.toHaveProperty('command');

      const codegraph = body.builtinServers.find((server) => server.id === 'codegraph');
      expect(codegraph).toMatchObject({
        builtinKind: 'virtual',
        source: 'system',
      });
      expect(codegraph).not.toHaveProperty('command');

      const lsp = body.builtinServers.find((server) => server.id === 'lsp');
      expect(lsp).toMatchObject({
        builtinKind: 'virtual',
        source: 'system',
      });
      expect(lsp).not.toHaveProperty('command');

      // `omo` adapter 已下线：内置清单里不再出现。
      expect(body.builtinServers.find((server) => server.id === 'omo')).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/mcp-servers 只保存 lsp 虚拟内置的管理字段', async () => {
    const app = await buildApp();
    try {
      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
        payload: {
          servers: [
            {
              id: 'lsp',
              name: 'lsp',
              transport: 'stdio',
              builtin: true,
              builtinKind: 'virtual',
              source: 'system',
              enabled: true,
              command: 'malicious-fake-command',
              url: 'https://fake.invalid/sse',
              disabledTools: ['lsp_rename', 'lsp_rename'],
            },
          ],
        },
      });

      expect(putResponse.statusCode).toBe(200);
      const putBody = putResponse.json<SettingsMcpServersResponse>();
      expect(putBody.servers).toEqual([
        {
          id: 'lsp',
          name: 'lsp',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source: 'system',
          enabled: true,
          disabledTools: ['lsp_rename'],
        },
      ]);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
      });
      expect(getResponse.json<SettingsMcpServersResponse>().servers).toEqual(putBody.servers);
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/mcp-servers 保存后会失效旧的 MCP 连接与工具目录缓存', async () => {
    mcpRuntimeMock.loadConfiguredMcpServersForUserMock.mockReturnValue([
      {
        id: 'remote-user-sse',
        name: 'Remote user sse',
        transport: 'sse',
        url: 'https://example.com/mcp',
        enabled: true,
      },
    ]);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
        payload: {
          servers: [
            {
              id: 'remote-user-sse',
              name: 'Remote user sse',
              transport: 'sse',
              url: 'https://example.com/mcp',
              headers: { authorization: 'Bearer fixed' },
              enabled: true,
            },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      // Saved + pre-save configs share the same id in this mock, so the
      // dedupe-by-pool-key loop still invalidates exactly once.
      expect(mcpRuntimeMock.invalidateMcpServerConnectionForUserMock).toHaveBeenCalledTimes(1);
      expect(mcpRuntimeMock.invalidateMcpServerConnectionForUserMock).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ id: 'remote-user-sse' }),
      );
    } finally {
      await app.close();
    }
  });

  it('GET /settings/mcp-servers 会先清洗旧 protected builtin 持久化行', async () => {
    dbModule.sqliteRun(
      `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)`,
      [
        USER_ID,
        JSON.stringify([
          {
            id: 'codegraph',
            name: 'stale-codegraph',
            transport: 'stdio',
            source: 'user',
            command: 'malicious-fake-command',
            url: 'https://fake.invalid/codegraph',
            enabled: false,
            disabledTools: ['codegraph_status', 'codegraph_status'],
          },
          {
            // D5：已下线的 protected builtin。设置页 GET 只镜像用户原始配置
            // （经 sanitize，不采信伪造端点），D5 的「丢弃」发生在运行时合并层
            // （`loadConfiguredMcpServersForUser`），二者分工见下。
            id: 'omo',
            name: 'stale-omo',
            type: 'stdio',
            command: 'openawork-virtual-omo',
            url: 'https://fake.invalid/omo',
            enabled: true,
          },
          {
            id: 'local-user-stdio',
            name: 'Local user stdio',
            transport: 'stdio',
            source: 'user',
            command: 'node',
            args: ['server.js'],
            enabled: true,
          },
          {
            id: 'remote-user-sse',
            name: 'Remote user sse',
            transport: 'sse',
            source: 'user',
            url: 'https://example.com/mcp',
            enabled: true,
          },
        ]),
      ],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const servers = response.json<SettingsMcpServersResponse>().servers;

      // 设置页镜像：codegraph 被清洗为 canonical protected 形态；已下线的
      // protected builtin 行（此处为 `omo`）仍原样回显（配置保真），但其端点
      // 不可伪造——这是既有 sanitize 语义；D5 的运行时丢弃发生在合并层。
      expect(servers[0]).toEqual({
        id: 'codegraph',
        name: 'codegraph',
        transport: 'stdio',
        builtin: true,
        builtinKind: 'virtual',
        source: 'user',
        enabled: false,
        disabledTools: ['codegraph_status'],
      });
      expect(servers.map((server) => server.id)).toEqual([
        'codegraph',
        'omo',
        'local-user-stdio',
        'remote-user-sse',
      ]);
      // 设置页镜像保留原始行（配置保真）；D5 的「运行时丢弃」不在本路由、
      // 而由 `loadConfiguredMcpServersForUser` 的合并层承担。
      // 该路由不直连 runtime 合并层（mcp-runtime 在此文件被整体 mock），
      // D5 行为由 `builtin-mcps.test.ts` / `mcp-settings-sanitizer.test.ts` /
      // `mcp-runtime-retry.test.ts` 覆盖。
      expect(mcpRuntimeMock.loadConfiguredMcpServersForUserMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
