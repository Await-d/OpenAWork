/**
 * `team_workspace_manage` 工具回归（真实内存 SQLite + 真实存储层 / 绑定校验）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AdminModule from '../../team/team-workspace-admin-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let admin: typeof AdminModule;

const USER_ID = 'u-team-ws';
const OTHER_USER_ID = 'u-team-ws-other';
const SESSION_ID = 's-team-ws';
const TEAM_SESSION_ID = 's-team-ws-team';
const CRON_SESSION_ID = 's-team-ws-cron';
const CHANNEL_SESSION_ID = 's-team-ws-channel';

function validSlot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'custom-1',
    layer: 'executor',
    specialty: 'custom',
    displayName: '自定义执行者',
    personaKey: 'custom-1',
    toolsets: [],
    required: true,
    ...overrides,
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  admin = await import('../../team/team-workspace-admin-tools.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_workspaces', []);
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  for (const userId of [USER_ID, OTHER_USER_ID]) {
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
      [userId, `${userId}@example.com`],
    );
  }
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
  return admin.runTeamWorkspaceManageTool({
    userId: USER_ID,
    sessionId,
    input: admin.teamWorkspaceManageInputSchema.parse(input),
  });
}

function seedInstalledSkill(skillId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
      (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'src-a', ?, '[]', 1, 1, 1)`,
    [skillId, USER_ID, JSON.stringify({ id: skillId, name: skillId, version: '1.0.0' })],
  );
}

function countWorkspaces(): number {
  return dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM team_workspaces', [])?.n ?? 0;
}

describe('team_workspace_manage · 契约', () => {
  it('工具名常量与定义一致（防漂移）', () => {
    expect(admin.TEAM_WORKSPACE_MANAGE_TOOL_NAME).toBe('team_workspace_manage');
    expect(admin.teamWorkspaceManageToolDefinition.name).toBe(
      admin.TEAM_WORKSPACE_MANAGE_TOOL_NAME,
    );
  });

  it('输入 schema：create 需要 name；update 需要 workspaceId + workspace；delete 需要 id', () => {
    expect(admin.teamWorkspaceManageInputSchema.safeParse({ action: 'list' }).success).toBe(true);
    expect(admin.teamWorkspaceManageInputSchema.safeParse({ action: 'create' }).success).toBe(
      false,
    );
    expect(admin.teamWorkspaceManageInputSchema.safeParse({ action: 'delete' }).success).toBe(
      false,
    );
    expect(
      admin.teamWorkspaceManageInputSchema.safeParse({ action: 'update', workspaceId: 'w-1' })
        .success,
    ).toBe(false);
    expect(
      admin.teamWorkspaceManageInputSchema.safeParse({
        action: 'create',
        workspace: { name: '研发团队' },
      }).success,
    ).toBe(true);
  });
});

describe('team_workspace_manage · list / create', () => {
  it('list 空库返回 0 条', async () => {
    const parsed = JSON.parse(await run({ action: 'list' })) as { count: number };
    expect(parsed.count).toBe(0);
  });

  it('create 默认 roster 落库并立即可 list', async () => {
    const created = JSON.parse(
      await run({ action: 'create', workspace: { name: '研发团队', visibility: 'closed' } }),
    ) as { ok: boolean; workspace: { id: string; name: string; memberCount: number } };
    expect(created.ok).toBe(true);
    expect(created.workspace.name).toBe('研发团队');
    expect(created.workspace.memberCount).toBeGreaterThan(0);
    expect(countWorkspaces()).toBe(1);

    const listed = JSON.parse(await run({ action: 'list' })) as {
      count: number;
      workspaces: Array<{ id: string; visibility: string }>;
    };
    expect(listed.count).toBe(1);
    expect(listed.workspaces[0]).toMatchObject({ id: created.workspace.id, visibility: 'closed' });
  });

  it('create 携带合法 roster 与能力绑定（已安装技能 + 内置 MCP）', async () => {
    seedInstalledSkill('demo-skill');
    const created = JSON.parse(
      await run({
        action: 'create',
        workspace: {
          name: '带绑定',
          defaultTeamRoster: [validSlot({ skillIds: ['demo-skill'], mcpServerIds: ['websearch'] })],
        },
      }),
    ) as {
      workspace: {
        memberCount: number;
        members: Array<{ skillIds: string[]; mcpServerIds: string[] }>;
      };
    };
    expect(created.workspace.memberCount).toBe(1);
    expect(created.workspace.members[0]).toMatchObject({
      skillIds: ['demo-skill'],
      mcpServerIds: ['websearch'],
    });
  });

  it('create 拒绝未安装技能 / 未配置 MCP 绑定', async () => {
    await expect(
      run({
        action: 'create',
        workspace: {
          name: '坏绑定',
          defaultTeamRoster: [validSlot({ skillIds: ['ghost-skill'] })],
        },
      }),
    ).rejects.toThrow(/未知技能/);
    await expect(
      run({
        action: 'create',
        workspace: {
          name: '坏绑定 2',
          defaultTeamRoster: [validSlot({ mcpServerIds: ['ghost-mcp'] })],
        },
      }),
    ).rejects.toThrow(/未知 MCP server/);
    expect(countWorkspaces()).toBe(0);
  });

  it('create 拒绝字段不完整的 roster（不静默回退默认编制）', async () => {
    await expect(
      run({
        action: 'create',
        workspace: { name: '坏 roster', defaultTeamRoster: [{ id: 'x', layer: 'executor' }] },
      }),
    ).rejects.toThrow(/未通过校验/);
    expect(countWorkspaces()).toBe(0);
  });
});

describe('team_workspace_manage · update / delete', () => {
  it('update 改名 / 改可见性 / 改绑定；未知工作区报错', async () => {
    seedInstalledSkill('demo-skill');
    const created = JSON.parse(await run({ action: 'create', workspace: { name: '原名' } })) as {
      workspace: { id: string };
    };

    const updated = JSON.parse(
      await run({
        action: 'update',
        workspaceId: created.workspace.id,
        workspace: {
          name: '新名',
          visibility: 'open',
          defaultTeamRoster: [validSlot({ skillIds: ['demo-skill'] })],
        },
      }),
    ) as { workspace: { name: string; visibility: string; memberCount: number } };
    expect(updated.workspace).toMatchObject({ name: '新名', visibility: 'open', memberCount: 1 });

    await expect(
      run({ action: 'update', workspaceId: 'missing', workspace: { name: 'x' } }),
    ).rejects.toThrow(/未找到团队工作区/);
  });

  it('update 拒绝非法绑定', async () => {
    const created = JSON.parse(await run({ action: 'create', workspace: { name: '原名' } })) as {
      workspace: { id: string };
    };
    await expect(
      run({
        action: 'update',
        workspaceId: created.workspace.id,
        workspace: { defaultTeamRoster: [validSlot({ mcpServerIds: ['ghost-mcp'] })] },
      }),
    ).rejects.toThrow(/未知 MCP server/);
  });

  it('delete 删除工作区；未知报错', async () => {
    const created = JSON.parse(await run({ action: 'create', workspace: { name: '待删' } })) as {
      workspace: { id: string };
    };
    const removed = JSON.parse(
      await run({ action: 'delete', workspaceId: created.workspace.id }),
    ) as { removed: boolean };
    expect(removed.removed).toBe(true);
    expect(countWorkspaces()).toBe(0);
    await expect(run({ action: 'delete', workspaceId: created.workspace.id })).rejects.toThrow(
      /未找到团队工作区/,
    );
  });

  it('update / delete 拒绝非本人工作区', async () => {
    const { createTeamWorkspace } = await import('../../team/team-workspace-store.js');
    const other = createTeamWorkspace(OTHER_USER_ID, { name: '别人的' });
    await expect(
      run({ action: 'update', workspaceId: other.id, workspace: { name: 'x' } }),
    ).rejects.toThrow(/未找到团队工作区/);
    await expect(run({ action: 'delete', workspaceId: other.id })).rejects.toThrow(
      /未找到团队工作区/,
    );
  });
});

describe('team_workspace_manage · 会话守卫', () => {
  it('team / cron / channel 会话拒绝所有动作', async () => {
    await expect(run({ action: 'list' }, TEAM_SESSION_ID)).rejects.toThrow(/团队会话/);
    await expect(run({ action: 'list' }, CRON_SESSION_ID)).rejects.toThrow(/定时任务/);
    await expect(run({ action: 'list' }, CHANNEL_SESSION_ID)).rejects.toThrow(/消息渠道/);
  });

  it('resolveTeamWorkspaceManageSessionDenial：team 元数据 / 普通会话 / 缺行', () => {
    expect(
      admin.resolveTeamWorkspaceManageSessionDenial({
        metadata_json: JSON.stringify({ teamWorkspaceId: 'ws-1' }),
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toContain('团队会话');
    expect(
      admin.resolveTeamWorkspaceManageSessionDenial({
        metadata_json: '{}',
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toBeNull();
    expect(admin.resolveTeamWorkspaceManageSessionDenial(null)).toContain('已拒绝');
  });
});
