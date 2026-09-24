/**
 * `skill_manage` 工具回归（真实内存 SQLite + 真实 installed_skills 存储层；
 * 仅注册源客户端被 mock，避免网络）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as SkillsRoutesModule from '../../routes/skills.js';
import type * as AdminModule from '../../skill/skill-admin-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const registryMock = vi.hoisted(() => ({
  installMock: vi.fn(),
}));

vi.mock('../../routes/skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SkillsRoutesModule>();
  return {
    ...actual,
    createRegistryClient: () => ({ install: registryMock.installMock }),
  };
});

let dbModule: typeof DbModule;
let admin: typeof AdminModule;

const USER_ID = 'u-skill-manage';
const SESSION_ID = 's-skill-manage';
const TEAM_SESSION_ID = 's-skill-team';
const CRON_SESSION_ID = 's-skill-cron';
const CHANNEL_SESSION_ID = 's-skill-channel';

function manifestFor(skillId: string, overrides: Record<string, unknown> = {}) {
  return {
    apiVersion: 'agent-skill/v1',
    id: skillId,
    name: skillId,
    displayName: skillId,
    version: '1.0.0',
    description: `Skill ${skillId}`,
    capabilities: [],
    permissions: [{ type: 'filesystem', scope: '**', required: true }],
    ...overrides,
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  admin = await import('../../skill/skill-admin-tools.js');
});

beforeEach(() => {
  registryMock.installMock.mockReset();
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM chat_workspace_skill_selections', []);
  dbModule.sqliteRun('DELETE FROM chat_session_skill_overrides', []);
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
  return admin.runSkillManageTool({
    userId: USER_ID,
    sessionId,
    input: admin.skillManageInputSchema.parse(input),
  });
}

function seedInstalledSkill(skillId: string, enabled: 0 | 1 = 1): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT INTO installed_skills
      (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'src-a', ?, '[]', ?, ?, ?)`,
    [skillId, USER_ID, JSON.stringify(manifestFor(skillId)), enabled, now, now],
  );
}

function readEnabled(skillId: string): number | undefined {
  return dbModule.sqliteGet<{ enabled: number }>(
    'SELECT enabled FROM installed_skills WHERE skill_id = ? AND user_id = ?',
    [skillId, USER_ID],
  )?.enabled;
}

describe('skill_manage · 契约', () => {
  it('工具名常量与定义一致（防漂移）', () => {
    expect(admin.SKILL_MANAGE_TOOL_NAME).toBe('skill_manage');
    expect(admin.skillManageToolDefinition.name).toBe(admin.SKILL_MANAGE_TOOL_NAME);
  });

  it('输入 schema：list 免参；其余动作需要 skillId', () => {
    expect(admin.skillManageInputSchema.safeParse({ action: 'list' }).success).toBe(true);
    expect(admin.skillManageInputSchema.safeParse({ action: 'install' }).success).toBe(false);
    expect(admin.skillManageInputSchema.safeParse({ action: 'uninstall' }).success).toBe(false);
    expect(
      admin.skillManageInputSchema.safeParse({ action: 'install', skillId: 'demo' }).success,
    ).toBe(true);
  });
});

describe('skill_manage · list / install', () => {
  it('list 空库返回 0 条', async () => {
    const output = await run({ action: 'list' });
    expect(JSON.parse(output)).toMatchObject({ ok: true, action: 'list', count: 0 });
  });

  it('install 走注册源客户端并落库，结果含声明权限与内嵌 MCP 标记', async () => {
    registryMock.installMock.mockResolvedValue({
      skillId: 'demo',
      sourceId: 'src-a',
      manifest: manifestFor('demo', {
        mcp: { id: 'demo-mcp', transport: 'stdio', command: 'npx', args: ['-y', 'demo-mcp'] },
      }),
    });

    const output = await run({ action: 'install', skillId: 'demo', sourceId: 'src-a' });
    const parsed = JSON.parse(output) as {
      ok: boolean;
      skill: {
        skillId: string;
        sourceId: string;
        enabled: boolean;
        hasMcp: boolean;
        declaredPermissions: unknown[];
      };
    };
    expect(parsed).toMatchObject({ ok: true });
    expect(parsed.skill).toMatchObject({
      skillId: 'demo',
      sourceId: 'src-a',
      enabled: true,
      hasMcp: true,
    });
    expect(parsed.skill.declaredPermissions).toHaveLength(1);
    expect(registryMock.installMock).toHaveBeenCalledWith('demo', {
      sourceId: 'src-a',
      skipSignatureVerification: true,
    });
    expect(readEnabled('demo')).toBe(1);
  });

  it('install 拒绝 github: / claude-marketplace: 前缀（v1 引导设置页）', async () => {
    await expect(run({ action: 'install', skillId: 'github:owner/repo/skill' })).rejects.toThrow(
      /设置页/,
    );
    await expect(run({ action: 'install', skillId: 'claude-marketplace:foo/bar' })).rejects.toThrow(
      /设置页/,
    );
    expect(registryMock.installMock).not.toHaveBeenCalled();
  });

  it('list 展示已安装技能摘要（含 hasMcp）', async () => {
    seedInstalledSkill('plain');
    dbModule.sqliteRun(
      `INSERT INTO installed_skills
        (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
       VALUES ('with-mcp', ?, 'src-a', ?, '[]', 1, 1, 1)`,
      [
        USER_ID,
        JSON.stringify(
          manifestFor('with-mcp', { mcp: { id: 'x', transport: 'sse', url: 'https://x.dev' } }),
        ),
      ],
    );

    const parsed = JSON.parse(await run({ action: 'list' })) as {
      count: number;
      skills: Array<{ skillId: string; hasMcp: boolean }>;
    };
    expect(parsed.count).toBe(2);
    const byId = new Map(parsed.skills.map((skill) => [skill.skillId, skill]));
    expect(byId.get('with-mcp')?.hasMcp).toBe(true);
    expect(byId.get('plain')?.hasMcp).toBe(false);
  });
});

describe('skill_manage · uninstall / enable / disable', () => {
  it('uninstall 删除技能；未安装报错', async () => {
    seedInstalledSkill('demo');
    const output = await run({ action: 'uninstall', skillId: 'demo' });
    expect(JSON.parse(output)).toMatchObject({ ok: true, action: 'uninstall', removed: true });
    expect(readEnabled('demo')).toBeUndefined();
    await expect(run({ action: 'uninstall', skillId: 'demo' })).rejects.toThrow(/尚未安装/);
  });

  it('disable / enable 切换启用态；未安装报错', async () => {
    seedInstalledSkill('demo', 1);

    const disabled = JSON.parse(await run({ action: 'disable', skillId: 'demo' })) as {
      skill: { enabled: boolean };
    };
    expect(disabled.skill.enabled).toBe(false);
    expect(readEnabled('demo')).toBe(0);

    const enabled = JSON.parse(await run({ action: 'enable', skillId: 'demo' })) as {
      skill: { enabled: boolean };
    };
    expect(enabled.skill.enabled).toBe(true);
    expect(readEnabled('demo')).toBe(1);

    await expect(run({ action: 'disable', skillId: 'missing' })).rejects.toThrow(/尚未安装/);
  });
});

describe('skill_manage · 会话守卫', () => {
  it('team / cron / channel 会话拒绝所有动作', async () => {
    await expect(run({ action: 'list' }, TEAM_SESSION_ID)).rejects.toThrow(/团队会话/);
    await expect(run({ action: 'list' }, CRON_SESSION_ID)).rejects.toThrow(/定时任务/);
    await expect(run({ action: 'list' }, CHANNEL_SESSION_ID)).rejects.toThrow(/消息渠道/);
  });

  it('resolveSkillManageSessionDenial：team 元数据 / 普通会话 / 缺行', () => {
    expect(
      admin.resolveSkillManageSessionDenial({
        metadata_json: JSON.stringify({ teamWorkspaceId: 'ws-1' }),
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toContain('团队会话');
    expect(
      admin.resolveSkillManageSessionDenial({
        metadata_json: '{}',
        role_layer: null,
        team_parent_session_id: null,
        handoff_state: null,
      }),
    ).toBeNull();
    expect(admin.resolveSkillManageSessionDenial(null)).toContain('已拒绝');
  });
});
