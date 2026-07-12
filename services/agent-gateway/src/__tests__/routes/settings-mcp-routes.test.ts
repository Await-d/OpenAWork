import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: vi.fn(() => false),
  listMcpToolsForUser: vi.fn(),
  loadConfiguredMcpServersForUser: vi.fn(() => []),
  retryMcpConnectionForUser: vi.fn(),
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
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('settings MCP route contracts', () => {
  it('GET /settings/mcp-servers 返回同源 builtin、virtual 与 OMO adapter 元数据', async () => {
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
        'omo',
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

      const omo = body.builtinServers.find((server) => server.id === 'omo');
      expect(omo).toMatchObject({
        builtinKind: 'adapter',
        source: 'system',
      });
      expect(omo).not.toHaveProperty('command');
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/mcp-servers 只保存 OMO adapter 的管理字段', async () => {
    const app = await buildApp();
    try {
      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/mcp-servers',
        headers: { authorization: bearer(app) },
        payload: {
          servers: [
            {
              id: 'omo',
              name: 'omo',
              transport: 'stdio',
              builtin: true,
              builtinKind: 'adapter',
              source: 'system',
              enabled: true,
              command: 'malicious-fake-command',
              url: 'https://fake.invalid/sse',
              disabledTools: ['omo_list_agents', 'omo_list_agents'],
            },
          ],
        },
      });

      expect(putResponse.statusCode).toBe(200);
      const putBody = putResponse.json<SettingsMcpServersResponse>();
      expect(putBody.servers).toEqual([
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: true,
          disabledTools: ['omo_list_agents'],
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
            id: 'omo',
            name: 'stale-omo',
            type: 'stdio',
            command: 'malicious-omo-command',
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
      expect(response.json<SettingsMcpServersResponse>().servers).toEqual([
        {
          id: 'codegraph',
          name: 'codegraph',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'virtual',
          source: 'user',
          enabled: false,
          disabledTools: ['codegraph_status'],
        },
        {
          id: 'omo',
          name: 'omo',
          transport: 'stdio',
          builtin: true,
          builtinKind: 'adapter',
          source: 'system',
          enabled: true,
        },
        {
          id: 'local-user-stdio',
          name: 'Local user stdio',
          transport: 'stdio',
          command: 'node',
          args: ['server.js'],
          source: 'user',
          enabled: true,
        },
        {
          id: 'remote-user-sse',
          name: 'Remote user sse',
          transport: 'sse',
          url: 'https://example.com/mcp',
          source: 'user',
          enabled: true,
        },
      ]);
    } finally {
      await app.close();
    }
  });
});
