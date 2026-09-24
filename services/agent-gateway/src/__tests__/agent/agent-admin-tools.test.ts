/**
 * `agent_manage` 工具回归（真实内存 SQLite + 真实 agent-catalog）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AdminModule from '../../agent/agent-admin-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let admin: typeof AdminModule;

const USER_ID = 'u-agent-manage';
const SESSION_ID = 's-agent-manage';
const TEAM_SESSION_ID = 's-agent-team';
const CRON_SESSION_ID = 's-agent-cron';
const CHANNEL_SESSION_ID = 's-agent-channel';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  admin = await import('../../agent/agent-admin-tools.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id, handoff_state)
     VALUES (?, ?, 'team', '{}', 'idle', 'executor', 'parent-1', 'running')`,
    [TEAM_SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'cron', '{"source":"cron"}', 'idle')`,
    [CRON_SESSION_ID, USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'channel', '{"source":"channel"}', 'idle')`,
    [CHANNEL_SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

function run(input: Record<string, unknown>, sessionId = SESSION_ID): Promise<string> {
  return admin.runAgentManageTool({
    userId: USER_ID,
    sessionId,
    input: admin.agentManageInputSchema.parse(input),
  });
}

const CREATE_INPUT = {
  action: 'create',
  agent: { label: '代码审查员', systemPrompt: '你是一名严格的代码审查员。' },
};

describe('agent_manage · 契约', () => {
  it('工具名常量与定义一致（防漂移）', () => {
    expect(admin.AGENT_MANAGE_TOOL_NAME).toBe('agent_manage');
    expect(admin.agentManageToolDefinition.name).toBe(admin.AGENT_MANAGE_TOOL_NAME);
  });

  it('输入 schema：create/update 需要 agent；delete/reset 需要 agentId', () => {
    expect(admin.agentManageInputSchema.safeParse({ action: 'list' }).success).toBe(true);
    expect(admin.agentManageInputSchema.safeParse({ action: 'create' }).success).toBe(false);
    expect(admin.agentManageInputSchema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(admin.agentManageInputSchema.safeParse({ action: 'reset', agentId: 'x' }).success).toBe(
      true,
    );
  });
});

describe('agent_manage · list / create / update', () => {
  it('list 返回内置 Agent 列表', async () => {
    const parsed = JSON.parse(await run({ action: 'list' })) as {
      ok: boolean;
      count: number;
      agents: Array<{ id: string; source: string }>;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.count).toBeGreaterThan(0);
    expect(parsed.agents.some((agent) => agent.source === 'builtin')).toBe(true);
  });

  it('create 落库并立即可 list；重复创建报错', async () => {
    const created = JSON.parse(await run(CREATE_INPUT)) as {
      ok: boolean;
      agent: { id: string; label: string; systemPromptPreview: string };
    };
    expect(created.ok).toBe(true);
    expect(created.agent.label).toBe('代码审查员');
    expect(created.agent.systemPromptPreview).toContain('代码审查员');

    const catalogRow = dbModule.sqliteGet<{ value: string }>(
      `SELECT value FROM user_settings WHERE user_id = ? AND key = 'agent_catalog'`,
      [USER_ID],
    );
    expect(catalogRow?.value).toContain(created.agent.id);

    // 显式 id 冲突才报「已存在」；省略 id 时 catalog 会派生唯一 id（-1 后缀）。
    await run({ action: 'create', agent: { id: 'dup-agent', label: 'Dup', systemPrompt: 'x' } });
    await expect(
      run({ action: 'create', agent: { id: 'dup-agent', label: 'Dup 2', systemPrompt: 'x' } }),
    ).rejects.toThrow(/已存在/);
  });

  it('create 缺少 systemPrompt 报错', async () => {
    await expect(run({ action: 'create', agent: { label: 'x' } })).rejects.toThrow(/systemPrompt/);
  });

  it('update 自定义 Agent 字段；内置 Agent 仅允许改模型配置', async () => {
    const created = JSON.parse(await run(CREATE_INPUT)) as { agent: { id: string } };
    const updated = JSON.parse(
      await run({ action: 'update', agentId: created.agent.id, agent: { label: '审查员 v2' } }),
    ) as { agent: { label: string } };
    expect(updated.agent.label).toBe('审查员 v2');

    await expect(
      run({ action: 'update', agentId: 'general', agent: { label: '改名' } }),
    ).rejects.toThrow(/内置 Agent 仅允许修改模型配置/);
  });
});

describe('agent_manage · delete / reset', () => {
  it('delete 删除自定义 Agent；内置 Agent 不允许删除', async () => {
    const created = JSON.parse(await run(CREATE_INPUT)) as { agent: { id: string } };
    const removed = JSON.parse(await run({ action: 'delete', agentId: created.agent.id })) as {
      removed: boolean;
    };
    expect(removed.removed).toBe(true);

    const listAfter = JSON.parse(await run({ action: 'list' })) as {
      agents: Array<{ id: string }>;
    };
    expect(listAfter.agents.some((agent) => agent.id === created.agent.id)).toBe(false);

    await expect(run({ action: 'delete', agentId: 'general' })).rejects.toThrow(
      /内置 Agent 不允许删除/,
    );
  });

  it('reset 自定义 Agent 恢复默认配置', async () => {
    const created = JSON.parse(await run(CREATE_INPUT)) as { agent: { id: string } };
    await run({ action: 'update', agentId: created.agent.id, agent: { label: '改名后' } });

    const reset = JSON.parse(await run({ action: 'reset', agentId: created.agent.id })) as {
      agent: { label: string };
    };
    expect(reset.agent.label).toBe('代码审查员');
  });
});

describe('agent_manage · 会话守卫', () => {
  it('team / cron / channel 会话拒绝所有动作', async () => {
    await expect(run({ action: 'list' }, TEAM_SESSION_ID)).rejects.toThrow(/团队会话/);
    await expect(run({ action: 'list' }, CRON_SESSION_ID)).rejects.toThrow(/定时任务/);
    await expect(run({ action: 'list' }, CHANNEL_SESSION_ID)).rejects.toThrow(/消息渠道/);
  });

  it('resolveAgentManageSessionDenial：team 元数据 / 普通会话 / 缺行', () => {
    expect(
      admin.resolveAgentManageSessionDenial({
        metadata_json: JSON.stringify({ teamRoleInstance: { role: 'executor' } }),
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toContain('团队会话');
    expect(
      admin.resolveAgentManageSessionDenial({
        metadata_json: '{}',
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toBeNull();
    expect(admin.resolveAgentManageSessionDenial(null)).toContain('已拒绝');
  });
});
