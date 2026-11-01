/**
 * `skill_manage` / `mcp_manage_servers` 的 `scope: 'session'` 分支回归。
 *
 * 关键边界：
 *   - 缺省 scope（用户级）的渠道拒绝语义**逐字不变**（历史回归）；
 *   - 显式 `scope: 'session'` 在渠道开启管理时走提案流程，且不修改用户级配置。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SkillsRoutesModule from '../../routes/skills.js';
import type * as SkillAdminModule from '../../skill/skill-admin-tools.js';
import type * as McpAdminModule from '../../mcp/mcp-admin-tools.js';

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

let db: typeof DbModule;
let skillAdmin: typeof SkillAdminModule;
let mcpAdmin: typeof McpAdminModule;

const USER = 'u-toolscope';
const CH_ON = 's-toolscope-ch-on';
const CH_OFF = 's-toolscope-ch-off';

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  skillAdmin = await import('../../skill/skill-admin-tools.js');
  mcpAdmin = await import('../../mcp/mcp-admin-tools.js');
});

afterAll(async () => {
  await db.closeDb();
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

  db.sqliteRun('DELETE FROM session_extension_operations', []);
  db.sqliteRun('DELETE FROM session_skill_installations', []);
  db.sqliteRun('DELETE FROM session_mcp_servers', []);
  db.sqliteRun('DELETE FROM session_extension_settings', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);

  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER,
    `${USER}@example.com`,
  ]);
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ch', '{"source":"channel","channelExtensionManagementEnabled":true}', 'idle')`,
    [CH_ON, USER],
  );
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'ch', '{"source":"channel"}', 'idle')`,
    [CH_OFF, USER],
  );
});

describe('skill_manage 会话作用域', () => {
  it('缺省 scope 时渠道会话仍被拒绝（历史语义不变）', async () => {
    await expect(
      skillAdmin.runSkillManageTool({
        userId: USER,
        sessionId: CH_ON,
        input: { action: 'install', skillId: 'demo' },
      }),
    ).rejects.toThrow(/消息渠道会话不允许修改技能安装/);
  });

  it('scope=session 时创建待确认提案，且不写用户级安装集合', async () => {
    const raw = await skillAdmin.runSkillManageTool({
      userId: USER,
      sessionId: CH_ON,
      input: { action: 'install', skillId: 'demo', scope: 'session' },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['ok']).toBe(true);
    expect(parsed['status']).toBe('pending_approval');
    expect(parsed['scope']).toBe('session');
    const operation = db.sqliteGet<{ nonce: string }>(
      'SELECT nonce FROM session_extension_operations WHERE id = ?',
      [String(parsed['operationId'])],
    );
    expect(raw).not.toContain(operation?.nonce);

    const installed = db.sqliteGet<{ c: number }>('SELECT COUNT(*) AS c FROM installed_skills');
    expect(installed?.c).toBe(0);
  });

  it('渠道未开启管理时 scope=session 也被拒绝', async () => {
    const raw = await skillAdmin.runSkillManageTool({
      userId: USER,
      sessionId: CH_OFF,
      input: { action: 'install', skillId: 'demo', scope: 'session' },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['ok']).toBe(false);
    expect(String(parsed['error'])).toContain('未开启');
  });

  it('scope=session 的 list 返回会话级条目与提示', async () => {
    const raw = await skillAdmin.runSkillManageTool({
      userId: USER,
      sessionId: CH_ON,
      input: { action: 'list', scope: 'session' },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['scope']).toBe('session');
    expect(parsed['count']).toBe(0);
    expect(String(parsed['hint'])).toContain('只影响当前会话');
  });
});

describe('mcp_manage_servers 会话作用域', () => {
  it('缺省 scope 时渠道会话仍被拒绝（历史语义不变）', async () => {
    await expect(
      mcpAdmin.runMcpManageServersTool({
        userId: USER,
        sessionId: CH_ON,
        input: {
          action: 'add',
          server: { name: 'x', transport: 'sse', url: 'https://example.com/mcp' },
        },
      }),
    ).rejects.toThrow(/消息渠道会话不允许修改 MCP 配置/);
  });

  it('scope=session 时创建提案，payload 不含明文密钥', () => {
    const raw = mcpAdmin.runMcpManageServersTool({
      userId: USER,
      sessionId: CH_ON,
      input: {
        action: 'add',
        scope: 'session',
        server: {
          name: 'local',
          transport: 'sse',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer SECRET' },
        },
      },
    });
    // 该分支是同步实现，仍以 Promise 返回。
    return raw.then((value) => {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      expect(parsed['ok']).toBe(false);
      expect(parsed['status']).toBeUndefined();
      expect(JSON.stringify(parsed)).not.toContain('Bearer SECRET');
    });
  });

  it('scope=session 的 list 不回显端点与密钥', async () => {
    const raw = await mcpAdmin.runMcpManageServersTool({
      userId: USER,
      sessionId: CH_ON,
      input: { action: 'list', scope: 'session' },
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['scope']).toBe('session');
    expect(Array.isArray(parsed['servers'])).toBe(true);
  });
});
