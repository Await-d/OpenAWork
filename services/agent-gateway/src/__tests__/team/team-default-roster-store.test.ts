import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_FIXED_TEAM_MEMBER_SLOTS } from '@openAwork/shared';
import type * as DbModule from '../../infra/db.js';
import type * as TeamDefaultRosterStoreModule from '../../team/team-default-roster-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof TeamDefaultRosterStoreModule;

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../team/team-default-roster-store.js');
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team-default-roster-store', () => {
  it('会保留合法的自定义固定团队人物', () => {
    const customSlot = {
      id: 'custom-executor-platform-alpha',
      layer: 'executor' as const,
      specialty: 'platform' as const,
      displayName: '平台工程师 Alpha',
      personaKey: 'executor:platform:alpha',
      toolsets: ['read', 'write', 'shell'],
      required: false,
    };

    const roster = store.parseTeamWorkspaceDefaultRosterJson(JSON.stringify([customSlot]));

    expect(roster).toHaveLength(1);
    expect(roster[0]).toEqual(customSlot);
  });

  it('会保留自定义角色的 routingKeywords（动态识别关键词）', () => {
    const customSlot = {
      id: 'executor-custom-perf',
      layer: 'executor' as const,
      specialty: 'custom' as const,
      displayName: '性能优化专家',
      personaKey: 'executor:custom:perf',
      toolsets: ['read', 'write', 'shell'],
      required: false,
      custom: true,
      systemPrompt: '你是性能优化专家。',
      routingKeywords: ['性能', '渲染瓶颈', 'profiling'],
    };

    const roster = store.parseTeamWorkspaceDefaultRosterJson(JSON.stringify([customSlot]));

    expect(roster).toHaveLength(1);
    expect(roster[0]?.routingKeywords).toEqual(['性能', '渲染瓶颈', 'profiling']);
  });

  it('非法 JSON 会回退到系统默认固定团队', () => {
    const roster = store.parseTeamWorkspaceDefaultRosterJson('{bad-json');

    expect(roster).toHaveLength(DEFAULT_FIXED_TEAM_MEMBER_SLOTS.length);
    expect(roster[0]).toEqual(DEFAULT_FIXED_TEAM_MEMBER_SLOTS[0]);
  });

  it('空数组 normalize 后会回退系统默认 roster', () => {
    const roster = store.normalizeTeamWorkspaceDefaultRoster([]);

    expect(roster).toHaveLength(DEFAULT_FIXED_TEAM_MEMBER_SLOTS.length);
    expect(roster.map((slot) => slot.id)).toContain('executor-devops');
  });

  it('超大花名册会被截断到上限（40），防止注入侧 prompt 膨胀', () => {
    const huge = Array.from({ length: 200 }, (_v, i) => ({
      id: `executor-custom-${i}`,
      layer: 'executor' as const,
      specialty: 'custom' as const,
      displayName: `角色 ${i}`,
      personaKey: `executor:custom:${i}`,
      toolsets: ['read'],
      required: false,
      custom: true,
    }));
    const roster = store.normalizeTeamWorkspaceDefaultRoster(huge);
    expect(roster.length).toBeLessThanOrEqual(40);

    const parsed = store.parseTeamWorkspaceDefaultRosterJson(JSON.stringify(huge));
    expect(parsed.length).toBeLessThanOrEqual(40);
  });

  it('resolveSessionMemberSlots 读取会话 teamDefinition 快照（含 routingKeywords）', () => {
    const sessionId = 's-roster-snapshot';
    const slots = [
      {
        id: 'executor-custom-perf',
        layer: 'executor',
        specialty: 'custom',
        displayName: '性能优化专家',
        personaKey: 'executor:custom:perf',
        toolsets: ['read', 'write'],
        required: false,
        custom: true,
        routingKeywords: ['性能', '渲染瓶颈'],
        dispatchPriority: 'high',
      },
    ];
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('u-snap', 'snap@x.com', 'x')",
      [],
    );
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES (?, 'u-snap', 'snap', ?, 'executor')`,
      [sessionId, JSON.stringify({ teamDefinition: { memberSlots: slots } })],
    );

    const resolved = store.resolveSessionMemberSlots(sessionId);
    expect(resolved).toBeDefined();
    expect(resolved).toHaveLength(1);
    expect(resolved![0]?.routingKeywords).toEqual(['性能', '渲染瓶颈']);
    expect(resolved![0]?.dispatchPriority).toBe('high');
  });

  it('resolveSessionMemberSlots 无快照时返回 undefined（调用方回退 workspace 默认）', () => {
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('u-snap2', 'snap2@x.com', 'x')",
      [],
    );
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer)
       VALUES ('s-no-snapshot', 'u-snap2', 'x', '{}', 'executor')`,
      [],
    );
    expect(store.resolveSessionMemberSlots('s-no-snapshot')).toBeUndefined();
    expect(store.resolveSessionMemberSlots('s-does-not-exist')).toBeUndefined();
  });
});
