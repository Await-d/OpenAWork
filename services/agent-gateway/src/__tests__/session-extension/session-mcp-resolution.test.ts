/**
 * 会话级 MCP 解析回归（真实内存 SQLite）。
 *
 * 核心断言：**explicit 空集合 = 不继承用户 MCP**，且同一用户的两个会话互不影响。
 * 这正是「渠道里加 MCP 会污染其他会话」的修复点。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as McpRuntimeModule from '../../mcp/mcp-runtime.js';
import type * as StoreModule from '../../session-extension/session-extension-store.js';
import type * as LayerModule from '../../session-extension/session-mcp-resolution.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let runtime: typeof McpRuntimeModule;
let store: typeof StoreModule;
let layer: typeof LayerModule;

const USER = 'u-mcp-layer';
const SESSION_A = 's-mcp-a';
const SESSION_B = 's-mcp-b';

function seedUserAndSessions(): void {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER,
    `${USER}@example.com`,
  ]);
  for (const id of [SESSION_A, SESSION_B]) {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES (?, ?, 'demo', '{}', 'idle')`,
      [id, USER],
    );
  }
}

function setIdUserMcpServers(servers: unknown): void {
  db.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'mcp_servers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
    [USER, JSON.stringify(servers)],
  );
}

function idsForSession(sessionId: string): string[] {
  return runtime.getConfiguredMcpServersForSession(sessionId).map((server) => server.id);
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  runtime = await import('../../mcp/mcp-runtime.js');
  store = await import('../../session-extension/session-extension-store.js');
  layer = await import('../../session-extension/session-mcp-resolution.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM session_mcp_servers', []);
  db.sqliteRun('DELETE FROM session_extension_settings', []);
  db.sqliteRun('DELETE FROM user_settings', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  seedUserAndSessions();
});

describe('会话 MCP 层', () => {
  it('无 sessionId 时为空层且 inherit', () => {
    const resolved = layer.resolveSessionMcpLayer(null);
    expect(resolved.sessionId).toBeNull();
    expect(resolved.inheritance).toBe('inherit');
    expect(layer.shouldInheritUserMcpServers(resolved)).toBe(true);
  });

  it('inherit：用户配置照常可见；explicit：用户配置被阻断', () => {
    setIdUserMcpServers([
      { id: 'user-mcp', name: 'user-mcp', transport: 'sse', url: 'https://u.example/mcp' },
    ]);

    expect(idsForSession(SESSION_A)).toContain('user-mcp');

    store.ensureSessionExtensionSettings(SESSION_B, USER);
    store.setSessionExtensionInheritance({
      sessionId: SESSION_B,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });

    expect(idsForSession(SESSION_B)).not.toContain('user-mcp');
    // 会话 A 不受影响。
    expect(idsForSession(SESSION_A)).toContain('user-mcp');
  });

  it('explicit 下会话自带 MCP 可见，用户 MCP 不可见', () => {
    setIdUserMcpServers([{ id: 'user-mcp', name: 'user-mcp', url: 'https://u.example/mcp' }]);
    store.ensureSessionExtensionSettings(SESSION_A, USER);
    store.setSessionExtensionInheritance({
      sessionId: SESSION_A,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:local',
      displayId: 'local-session-mcp',
      config: {
        id: 'local-session-mcp',
        name: 'local-session-mcp',
        transport: 'sse',
        url: 'https://local.example/mcp',
      },
      expectedRevision: 2,
    });

    const ids = idsForSession(SESSION_A);
    expect(ids).toContain('local-session-mcp');
    expect(ids).not.toContain('user-mcp');
  });

  it('会话 MCP 的启停是立即生效的拒绝屏障', () => {
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:x',
      displayId: 'x',
      config: { id: 'x', name: 'x', transport: 'sse', url: 'https://x.example/mcp' },
      expectedRevision: 0,
    });
    expect(
      runtime.getConfiguredMcpServersForSession(SESSION_A).find((s) => s.id === 'x')?.enabled,
    ).toBe(true);

    store.setSessionMcpEnabled({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:x',
      enabled: false,
      expectedRevision: 1,
    });

    expect(
      runtime.getConfiguredMcpServersForSession(SESSION_A).find((s) => s.id === 'x')?.enabled,
    ).toBe(false);
  });

  it('实际查询入口必须返回会话配置而不是同名用户配置', () => {
    setIdUserMcpServers([
      { id: 'shared-call', name: 'shared-call', transport: 'sse', url: 'https://user.example/mcp' },
    ]);
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:shared-call',
      displayId: 'shared-call',
      config: {
        id: 'shared-call',
        name: 'shared-call',
        transport: 'sse',
        url: 'https://session.example/mcp',
      },
      expectedRevision: 0,
    });
    const server = runtime.getConfiguredMcpServerForSession(SESSION_A, 'shared-call');
    expect(server.url).toBe('https://session.example/mcp');
    expect(server.sessionScope?.sessionId).toBe(SESSION_A);
  });

  it('实际查询入口不能访问 explicit 会话之外的用户 MCP', () => {
    setIdUserMcpServers([
      {
        id: 'private-user',
        name: 'private-user',
        transport: 'sse',
        url: 'https://user.example/mcp',
      },
    ]);
    store.setSessionExtensionInheritance({
      sessionId: SESSION_A,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 0,
    });
    expect(() => runtime.getConfiguredMcpServerForSession(SESSION_A, 'private-user')).toThrow();
  });

  it('会话实际目录入口使用会话配置的禁用状态且不联网', async () => {
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:disabled-catalog',
      displayId: 'disabled-catalog',
      config: {
        id: 'disabled-catalog',
        name: 'disabled-catalog',
        transport: 'sse',
        url: 'https://session.example/mcp',
      },
      enabled: false,
      expectedRevision: 0,
    });
    const catalog = await runtime.listMcpToolsForSession(SESSION_A, {
      serverId: 'disabled-catalog',
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.status).toBe('disabled');
    expect(
      await runtime.listMcpToolsForSession(SESSION_B, { serverId: 'disabled-catalog' }),
    ).toEqual([]);
  });

  it('系统内置 MCP 在两种模式下都保留（会话不能移除内置）', () => {
    store.ensureSessionExtensionSettings(SESSION_A, USER);
    store.setSessionExtensionInheritance({
      sessionId: SESSION_A,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });

    const builtins = runtime
      .getConfiguredMcpServersForSession(SESSION_A)
      .filter((server) => server.source === 'system' || server.builtin === true);
    expect(builtins.length).toBeGreaterThan(0);
  });

  it('同 id 时会话条目在本会话内优先，且不改写用户配置', () => {
    setIdUserMcpServers([
      { id: 'shared', name: 'shared', transport: 'sse', url: 'https://user.example/mcp' },
    ]);
    store.upsertSessionMcpServer({
      sessionId: SESSION_A,
      ownerUserId: USER,
      resourceRef: 'mcp:session:shared',
      displayId: 'shared',
      config: {
        id: 'shared',
        name: 'shared',
        transport: 'sse',
        url: 'https://session.example/mcp',
      },
      expectedRevision: 0,
    });

    const inSessionA = runtime
      .getConfiguredMcpServersForSession(SESSION_A)
      .find((server) => server.id === 'shared');
    expect(inSessionA?.url).toBe('https://session.example/mcp');

    // 用户配置与会话 B 未受影响。
    expect(
      runtime.getConfiguredMcpServersForSession(SESSION_B).find((server) => server.id === 'shared')
        ?.url,
    ).toBe('https://user.example/mcp');
    const persisted = db.sqliteGet<{ value: string }>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = 'mcp_servers'`,
      [USER],
    );
    expect(persisted?.value).toContain('user.example');
  });
});
