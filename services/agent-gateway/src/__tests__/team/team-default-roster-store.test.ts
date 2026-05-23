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
});
