/**
 * `GET /capabilities/session/:sessionId` —会话概览「注入工具」数据源。
 *
 * 该路由必须:
 *   1. 校验会话归属:缺 sessionId → 400;会话不存在/不属于当前用户 → 404;
 *   2. 返回该会话**实际生效**的 Skill / 工具(复用 buildCapabilitiesForUser);
 *   3. 返回按会话白名单过滤、并带连接状态与工具目录的 MCP 明细
 *      (listMcpToolsForSession)。
 *
 * 这里只 mock `listMcpToolsForSession`(它会真的去连远端 MCP),其余保持真实实现,
 * 以免测试触发网络连接;MCP 字段映射与 builtin 判定均在此断言。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as CapabilitiesModule from '../../routes/capabilities.js';
import type * as DbModule from '../../infra/db.js';
import type * as McpRuntimeModule from '../../mcp/mcp-runtime.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

const mocks = vi.hoisted(() => ({
  listMcpToolsForSessionMock: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', async (importOriginal) => {
  const actual = await importOriginal<typeof McpRuntimeModule>();
  return {
    ...actual,
    listMcpToolsForSession: mocks.listMcpToolsForSessionMock,
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let capabilities: typeof CapabilitiesModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;

const USER_ID = 'u-capabilities-session';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  capabilities = await import('../../routes/capabilities.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  mocks.listMcpToolsForSessionMock.mockReset();
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

function seedSession(sessionId: string, metadata: Record<string, unknown> = {}): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
     VALUES (?, ?, 'cap session', '[]', 'idle', ?)`,
    [sessionId, USER_ID, JSON.stringify(metadata)],
  );
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(capabilities.capabilitiesRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
}

describe('GET /capabilities/session/:sessionId', () => {
  it('缺少会话标识时返回 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/capabilities/session/%20',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: '缺少会话标识。' });
      expect(mocks.listMcpToolsForSessionMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('会话不存在或不属于当前用户时返回 404', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/capabilities/session/does-not-exist',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: '会话不存在。' });
      expect(mocks.listMcpToolsForSessionMock).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('返回生效的 Skill、工具与带连接状态的 MCP 明细', async () => {
    const sessionId = 'session-capabilities-detail';
    seedSession(sessionId, { requestedMcpServers: ['my-mcp', 'websearch'] });
    mocks.listMcpToolsForSessionMock.mockResolvedValue([
      {
        serverId: 'websearch',
        serverName: 'websearch',
        transport: 'sse',
        enabled: true,
        status: 'connected',
        tools: [{ name: 'web_search', description: 'Search the web' }],
      },
      {
        serverId: 'my-mcp',
        serverName: 'My MCP',
        transport: 'stdio',
        enabled: true,
        status: 'error',
        tools: [],
        error: 'command not found',
      },
    ]);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/capabilities/session/${sessionId}`,
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        readonly sessionId: string;
        readonly skills: ReadonlyArray<{ readonly kind: string }>;
        readonly tools: ReadonlyArray<{ readonly kind: string }>;
        readonly mcpServers: ReadonlyArray<{
          readonly id: string;
          readonly name: string;
          readonly transport: string;
          readonly status: string;
          readonly toolCount: number;
          readonly builtin: boolean;
          readonly tools: ReadonlyArray<{ readonly name: string; readonly description?: string }>;
          readonly error?: string;
        }>;
      };

      expect(body.sessionId).toBe(sessionId);
      expect(body.skills.length).toBeGreaterThan(0);
      expect(body.skills.every((entry) => entry.kind === 'skill')).toBe(true);
      expect(body.tools.length).toBeGreaterThan(0);
      expect(body.tools.every((entry) => entry.kind === 'tool')).toBe(true);

      // MCP:白名单透传给 listMcpToolsForSession(含 requestedMcpServers)。
      expect(mocks.listMcpToolsForSessionMock).toHaveBeenCalledTimes(1);
      const [calledSessionId, scope] = mocks.listMcpToolsForSessionMock.mock.calls[0]!;
      expect(calledSessionId).toBe(sessionId);
      expect(scope).toMatchObject({ allowedServerIds: ['my-mcp', 'websearch'] });

      const websearch = body.mcpServers.find((server) => server.id === 'websearch');
      expect(websearch).toMatchObject({
        name: 'websearch',
        transport: 'sse',
        status: 'connected',
        toolCount: 1,
        builtin: true,
      });
      expect(websearch?.tools).toEqual([{ name: 'web_search', description: 'Search the web' }]);

      const custom = body.mcpServers.find((server) => server.id === 'my-mcp');
      expect(custom).toMatchObject({
        name: 'My MCP',
        transport: 'stdio',
        status: 'error',
        toolCount: 0,
        builtin: false,
        error: 'command not found',
      });
    } finally {
      await app.close();
    }
  });
});
