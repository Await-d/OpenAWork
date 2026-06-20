/**
 * 端到端集成测试：模板成员的「初始能力绑定」(skills / mcp / model / systemPrompt)
 * 经 handoff → watcher 创建子 session → 真正落到子 session 运行上下文。
 *
 * 锁死这条链，防止「注入了 metadata 但运行时没消费」这类回归：
 *   1. 根（reception）session 的 teamDefinition.memberSlots 含一个自定义执行层成员，
 *      绑定了已安装 skill + 配置的 mcp server + 模型 + systemPrompt；
 *   2. 从根 session 发起一个 executor handoff，payload.assignedMember.personaKey 指向该成员；
 *   3. watcher.tickOnce() 创建子 session；
 *   4. 断言子 session metadata 携带 requestedSkills / requestedMcpServers / modelId /
 *      delegatedSystemPrompt；
 *   5. 断言 getEffectiveSkillsForSession(子) 真的把绑定 skill 启用（消费侧验证）。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';
import type * as WatcherModule from '../../handoff/runner/watcher.js';
import type * as SkillContextModule from '../../skill/skill-selection-context.js';
import {
  InProcessScheduler,
  __resetBackgroundTaskSchedulerForTesting,
} from '../../handoff/runner/scheduler.js';

// 不让 executor 真去跑 stream（taskRunner 会调它）。
vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;
let watcherModule: typeof WatcherModule;
let skillContext: typeof SkillContextModule;

const USER_ID = 'u-cap-e2e';
const ROOT_SESSION_ID = 's-cap-root';
const SKILL_ID = 'com.example.perf';
const MCP_ID = 'my-mcp';
const PERSONA_KEY = 'executor:custom:perf1';

const skillManifest = {
  apiVersion: 'agent-skill/v1',
  id: SKILL_ID,
  name: 'perf-skill',
  displayName: 'Perf Skill',
  version: '1.0.0',
  description: '性能优化技能',
  capabilities: ['perf.audit'],
  permissions: [],
};

const ROOT_METADATA = {
  teamDefinition: {
    memberSlots: [
      {
        id: 'executor-custom-perf1',
        layer: 'executor',
        specialty: 'custom',
        displayName: '性能优化专家',
        personaKey: PERSONA_KEY,
        toolsets: ['read', 'write', 'shell'],
        required: false,
        custom: true,
        systemPrompt: '你是性能优化专家，定位瓶颈并给出可量化方案。',
        modelId: 'gpt-x',
        providerId: 'openai',
        skillIds: [SKILL_ID],
        mcpServerIds: [MCP_ID],
      },
    ],
  },
};

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'cap-e2e@example.com',
  ]);
}

function seedRootSession(): void {
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'root', ?, 'reception')`,
    [ROOT_SESSION_ID, USER_ID, JSON.stringify(ROOT_METADATA)],
  );
}

function seedInstalledSkill(): void {
  const now = Date.now();
  dbModule.sqliteRun(
    `INSERT OR REPLACE INTO installed_skills
       (skill_id, user_id, source_id, manifest_json, granted_permissions_json, enabled, installed_at, updated_at)
     VALUES (?, ?, 'local', ?, '[]', 1, ?, ?)`,
    [SKILL_ID, USER_ID, JSON.stringify(skillManifest), now, now],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
  watcherModule = await import('../../handoff/runner/watcher.js');
  skillContext = await import('../../skill/skill-selection-context.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM installed_skills', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
  seedRootSession();
  seedInstalledSkill();
  __resetBackgroundTaskSchedulerForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team capability binding · end-to-end', () => {
  it('injects member skills/mcp/model/systemPrompt into the executor child session, and skill becomes effective', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      // taskRunner 留空 noop：我们只验证子 session 创建 + metadata，不跑 stream。
      taskRunner: async () => {},
      scheduler: new InProcessScheduler(),
    });

    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: ROOT_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
      payload: {
        goal: '优化首屏渲染',
        assignedMember: { personaKey: PERSONA_KEY },
      },
    });

    const result = await watcher.tickOnce();
    expect(result.claimed).toBe(1);

    const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    const childId = after?.toSessionId;
    expect(childId).toBeTruthy();

    // 子 session metadata 应携带绑定能力。
    const childRow = dbModule.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
      [childId!],
    );
    expect(childRow).toBeDefined();
    const childMeta = JSON.parse(childRow!.metadata_json) as Record<string, unknown>;

    expect(childMeta['requestedSkills']).toEqual([SKILL_ID]);
    expect(childMeta['requestedMcpServers']).toEqual([MCP_ID]);
    expect(childMeta['toolsets']).toEqual(['read', 'write', 'shell']);
    expect(childMeta['modelId']).toBe('gpt-x');
    expect(childMeta['providerId']).toBe('openai');
    expect(childMeta['delegatedSystemPrompt']).toContain('性能优化专家');

    // 消费侧：effective skills 真的把绑定 skill 启用了。
    const effective = skillContext.getEffectiveSkillsForSession(childId!);
    expect(effective).not.toBeNull();
    const bound = effective!.find((e) => e.skillId === SKILL_ID);
    expect(bound).toBeDefined();
    expect(bound?.enabled).toBe(true);
  });

  it('a non-bound member yields no requested capabilities on the child session', async () => {
    const watcher = new watcherModule.HandoffWatcher({
      taskRunner: async () => {},
      scheduler: new InProcessScheduler(),
    });

    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: ROOT_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'reviewer', // 该层 roster 里没有成员 → 无绑定
      payload: { goal: '评审', assignedMember: { personaKey: 'reviewer:code-review' } },
    });

    await watcher.tickOnce();
    const after = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    const childRow = dbModule.sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1',
      [after!.toSessionId!],
    );
    const childMeta = JSON.parse(childRow!.metadata_json) as Record<string, unknown>;
    expect(childMeta['requestedSkills']).toBeUndefined();
    expect(childMeta['requestedMcpServers']).toBeUndefined();
  });
});
