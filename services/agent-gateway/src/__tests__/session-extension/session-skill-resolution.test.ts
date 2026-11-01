/**
 * 会话级技能解析回归（真实内存 SQLite）。
 *
 * 锁定三条语义：
 *   1. `inherit`（老会话默认）在既有集合之上追加会话级技能；
 *   2. `explicit` 只保留会话级技能 + 内置技能，不继承用户级安装；
 *   3. 用户级硬撤权（`installed_skills.enabled = 0`）优先于会话级启用。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SkillManifest } from '@openAwork/skill-types';
import type * as DbModule from '../../infra/db.js';
import type * as SelectionModule from '../../skill/skill-selection.js';
import type * as StoreModule from '../../session-extension/session-extension-store.js';
import type * as LayerModule from '../../session-extension/session-skill-resolution.js';
import { createSkillTool } from '../../skill/skill-tools.js';
import { runSkillMcpTool } from '../../skill/skill-mcp-tools.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let selection: typeof SelectionModule;
let store: typeof StoreModule;
let layer: typeof LayerModule;

const USER = 'u-skill-layer';
const SESSION = 's-skill-layer';

function manifestFor(skillId: string): string {
  return JSON.stringify({
    apiVersion: 'agent-skill/v1',
    id: skillId,
    name: skillId,
    displayName: skillId,
    version: '1.0.0',
    description: skillId,
    capabilities: [],
    permissions: [],
  });
}

function seedInstalledSkill(skillId: string, enabled = true): void {
  const now = Date.now();
  db.sqliteRun(
    `INSERT INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'builtin', ?, '[]', ?, ?, ?)`,
    [skillId, USER, manifestFor(skillId), enabled ? 1 : 0, now, now],
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  selection = await import('../../skill/skill-selection.js');
  store = await import('../../session-extension/session-extension-store.js');
  layer = await import('../../session-extension/session-skill-resolution.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM session_skill_installations', []);
  db.sqliteRun('DELETE FROM session_extension_settings', []);
  db.sqliteRun('DELETE FROM chat_workspace_skill_selections', []);
  db.sqliteRun('DELETE FROM chat_workspace_skill_configured', []);
  db.sqliteRun('DELETE FROM chat_session_skill_overrides', []);
  db.sqliteRun('DELETE FROM installed_skills', []);
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);

  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER,
    `${USER}@example.com`,
  ]);
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [SESSION, USER],
  );
});

function installSessionSkill(skillId: string, expectedRevision: number, enabled = true) {
  return store.upsertSessionSkill({
    sessionId: SESSION,
    ownerUserId: USER,
    resourceRef: `skill:session:${skillId}`,
    skillId,
    sourceId: 'builtin',
    version: '1.0.0',
    manifest: JSON.parse(manifestFor(skillId)) as unknown,
    contentDigest: `digest-${skillId}`,
    enabled,
    expectedRevision,
  });
}

function resolveIds(): string[] {
  return selection
    .resolveEffectiveSkills({
      userId: USER,
      workspacePath: null,
      sessionId: SESSION,
    })
    .filter((entry) => entry.enabled && !isBuiltin(entry.skillId))
    .map((entry) => entry.skillId);
}

/** 通过 origin 判定内置技能，避免直接依赖 `@openAwork/skills` 的内部结构。 */
function isBuiltin(skillId: string): boolean {
  return selection
    .resolveEffectiveSkills({ userId: USER, workspacePath: null, sessionId: null })
    .some((entry) => entry.skillId === skillId && entry.origin === 'builtin');
}

describe('会话级技能层', () => {
  it('实际 skill 工具加载批准快照，不要求用户安装，并在撤销后拒绝', async () => {
    const manifest = {
      ...JSON.parse(manifestFor('session-only')),
      descriptionForModel: 'APPROVED SESSION INSTRUCTIONS',
    };
    store.upsertSessionSkill({
      sessionId: SESSION,
      ownerUserId: USER,
      resourceRef: 'skill:session:session-only',
      skillId: 'session-only',
      sourceId: 'registry',
      version: '1.0.0',
      manifest,
      contentDigest: store.computeSessionExtensionDigest(manifest),
      expectedRevision: 0,
    });
    const effective = selection.resolveEffectiveSkills({
      userId: USER,
      sessionId: SESSION,
      workspacePath: null,
    });
    const tool = createSkillTool(SESSION, USER, { effective });
    const signal = new AbortController().signal;
    expect(await tool.execute({ name: 'session-only' }, signal)).toContain(
      'APPROVED SESSION INSTRUCTIONS',
    );
    store.setSessionSkillFlags({
      sessionId: SESSION,
      ownerUserId: USER,
      resourceRef: 'skill:session:session-only',
      enabled: false,
      expectedRevision: 1,
    });
    await expect(tool.execute({ name: 'session-only' }, signal)).rejects.toThrow(/撤销/);
  });

  it('内嵌 MCP 不得回退同名用户安装且撤销后零网络失败', async () => {
    const manifest = {
      ...JSON.parse(manifestFor('session-mcp')),
      mcp: { id: 'embedded', transport: 'sse', url: 'https://example.com/mcp' },
    };
    store.upsertSessionSkill({
      sessionId: SESSION,
      ownerUserId: USER,
      resourceRef: 'skill:session:session-mcp',
      skillId: 'session-mcp',
      sourceId: 'registry',
      version: '1.0.0',
      manifest,
      contentDigest: store.computeSessionExtensionDigest(manifest),
      expectedRevision: 0,
    });
    const effective = selection.resolveEffectiveSkills({
      userId: USER,
      sessionId: SESSION,
      workspacePath: null,
    });
    store.setSessionSkillFlags({
      sessionId: SESSION,
      ownerUserId: USER,
      resourceRef: 'skill:session:session-mcp',
      enabled: false,
      expectedRevision: 1,
    });
    await expect(
      runSkillMcpTool(
        USER,
        { mcp_name: 'embedded', tool_name: 'write' },
        { sessionId: SESSION, effective },
      ),
    ).rejects.toThrow(/撤销/);
  });
  it('无 sessionId 时返回空层且为 inherit', () => {
    const resolved = layer.resolveSessionSkillLayer(null);
    expect(resolved.sessionId).toBeNull();
    expect(resolved.inheritance).toBe('inherit');
    expect(resolved.entries).toEqual([]);
  });

  it('inherit 模式下会话技能与用户级技能并存', () => {
    seedInstalledSkill('user-skill');
    installSessionSkill('session-skill', 0);

    const ids = resolveIds();
    expect(ids).toContain('user-skill');
    expect(ids).toContain('session-skill');
  });

  it('explicit 模式不继承用户级技能，只保留会话技能与内置技能', () => {
    seedInstalledSkill('user-skill');
    installSessionSkill('session-skill', 0);
    store.setSessionExtensionInheritance({
      sessionId: SESSION,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });

    const ids = resolveIds();
    expect(ids).toContain('session-skill');
    expect(ids).not.toContain('user-skill');
  });

  it('explicit 模式下空集合就是「什么都不继承」（内置技能仍在）', () => {
    seedInstalledSkill('user-skill');
    store.ensureSessionExtensionSettings(SESSION, USER);
    store.setSessionExtensionInheritance({
      sessionId: SESSION,
      ownerUserId: USER,
      inheritance: 'explicit',
      expectedRevision: 1,
    });

    const resolved = selection.resolveEffectiveSkills({
      userId: USER,
      workspacePath: null,
      sessionId: SESSION,
    });
    expect(resolved.filter((entry) => entry.enabled && entry.origin !== 'builtin')).toHaveLength(0);
    expect(resolved.some((entry) => entry.origin === 'builtin')).toBe(true);
  });

  it('用户级硬撤权优先于会话级启用', () => {
    seedInstalledSkill('revoked-skill', false);
    installSessionSkill('revoked-skill', 0);

    expect(resolveIds()).not.toContain('revoked-skill');
  });

  it('会话技能被禁用后不再出现在有效集合（撤权立即生效）', () => {
    installSessionSkill('session-skill', 0);
    expect(resolveIds()).toContain('session-skill');

    store.setSessionSkillFlags({
      sessionId: SESSION,
      ownerUserId: USER,
      resourceRef: 'skill:session:session-skill',
      enabled: false,
      expectedRevision: 1,
    });
    expect(resolveIds()).not.toContain('session-skill');
  });

  it('两个会话各自独立：A 的会话技能不影响 B', () => {
    db.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
       VALUES ('s-other', ?, 'other', '{}', 'idle')`,
      [USER],
    );
    installSessionSkill('session-skill', 0);

    const otherIds = selection
      .resolveEffectiveSkills({ userId: USER, workspacePath: null, sessionId: 's-other' })
      .filter((entry) => entry.enabled)
      .map((entry) => entry.skillId);
    expect(otherIds).not.toContain('session-skill');
  });
});

describe('会话技能当前性判定（生产共用实现）', () => {
  // 这是 `skill/skill-tools.ts` 与 `skill/skill-mcp-tools.ts` 共用的唯一决策点：
  // 此前两处各写一份逐字相同的五条件判断且已分叉，测试也就测不到真正在跑的那份。
  const manifest = JSON.parse(manifestFor('pure')) as SkillManifest;

  /** 摘要在用例体内算：`store` 要等 `beforeAll` 才可用，而 describe 体在收集阶段就执行。 */
  function currentInputs(digest: string) {
    return {
      entry: { enabled: true, contentDigest: digest },
      live: { enabled: true, contentDigest: digest },
    };
  }

  it('四条件齐备时返回 manifest 本身', () => {
    const { entry, live } = currentInputs(store.computeSessionExtensionDigest(manifest));
    expect(layer.resolveCurrentSessionSkillManifest({ entry, manifest, current: live })).toBe(
      manifest,
    );
  });

  it('条件任一不成立都拒绝', () => {
    const digest = store.computeSessionExtensionDigest(manifest);
    const { entry, live } = currentInputs(digest);
    const cases: Array<[string, Parameters<typeof layer.resolveCurrentSessionSkillManifest>[0]]> = [
      [
        '条目已被过滤',
        { entry: { enabled: false, contentDigest: digest }, manifest, current: live },
      ],
      ['条目没有 manifest', { entry, manifest: undefined, current: live }],
      ['库里已被移除', { entry, manifest, current: undefined }],
      ['库里为禁用态', { entry, manifest, current: { enabled: false, contentDigest: digest } }],
      [
        '快照摘要与库中不一致（批准 A 执行 B）',
        { entry: { enabled: true, contentDigest: 'stale-digest' }, manifest, current: live },
      ],
    ];

    for (const [label, input] of cases) {
      expect(layer.resolveCurrentSessionSkillManifest(input), label).toBeNull();
    }
  });

  it('manifest 内容被替换后即使摘要字段未变也拒绝', () => {
    const { entry, live } = currentInputs(store.computeSessionExtensionDigest(manifest));
    // 摘要是从 manifest 算出来的：正文被换掉而 `contentDigest` 字段没跟着更新时，
    // 必须由「重算摘要」这一步揭穿，不能只比字段。
    const tampered = { ...manifest, descriptionForModel: '被替换的正文' };
    expect(
      layer.resolveCurrentSessionSkillManifest({ entry, manifest: tampered, current: live }),
    ).toBeNull();
  });
});
