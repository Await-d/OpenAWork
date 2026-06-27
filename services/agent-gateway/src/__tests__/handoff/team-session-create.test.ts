import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TeamSessionCreateModule from '../../handoff/bus/team-session-create.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let teamSessionCreate: typeof TeamSessionCreateModule;

const USER_ID = 'u-team-session-create';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'team-session-create@example.com',
  ]);
}

function readSessionMetadata(sessionId: string): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    `SELECT metadata_json FROM sessions WHERE id = ? LIMIT 1`,
    [sessionId],
  );
  expect(row).toBeDefined();
  return JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  teamSessionCreate = await import('../../handoff/bus/team-session-create.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM team_role_session_instances', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('createTeamSession metadata defaults', () => {
  it('为 reception session 补齐 clarify 对话默认值和空 provider/model', () => {
    const created = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });

    expect(readSessionMetadata(created.sessionId)).toMatchObject({
      defaultProvider: null,
      defaultModel: null,
      dialogueMode: 'clarify',
    });
  });

  it('为子层 session 补齐 coding 对话默认值', () => {
    const parent = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });
    const child = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: parent.sessionId,
    });

    expect(readSessionMetadata(child.sessionId)).toMatchObject({
      defaultProvider: null,
      defaultModel: null,
      dialogueMode: 'coding',
    });
  });

  it('保留调用方显式提供的 metadata 字段', () => {
    const created = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
      metadataJson: JSON.stringify({
        defaultProvider: 'provider-from-caller',
        defaultModel: 'model-from-caller',
        dialogueMode: 'programmer',
        source: 'test',
      }),
    });

    expect(readSessionMetadata(created.sessionId)).toEqual({
      defaultProvider: 'provider-from-caller',
      defaultModel: 'model-from-caller',
      dialogueMode: 'programmer',
      source: 'test',
    });
  });

  it('metadataJson 非法时回退为空对象并补齐默认值', () => {
    const created = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'pm1',
      metadataJson: '{not-json',
    });

    expect(readSessionMetadata(created.sessionId)).toEqual({
      defaultProvider: null,
      defaultModel: null,
      dialogueMode: 'coding',
    });
  });
});

describe('findOrCreateTeamRoleSession', () => {
  it('同一根会话、层级和 personaKey 会复用同一个角色 session', () => {
    const root = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });

    const first = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
      handoffState: 'running',
    });
    const second = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
      handoffState: 'running',
    });

    expect(second.sessionId).toBe(first.sessionId);
    expect(readSessionMetadata(first.sessionId)).toMatchObject({
      teamRoleInstance: {
        rootSessionId: root.sessionId,
        roleLayer: 'executor',
        personaKey: 'executor:frontend',
        displayName: '前端开发者',
      },
    });
    expect(
      dbModule.sqliteGet<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM team_role_session_instances
          WHERE user_id = ?
            AND root_session_id = ?
            AND parent_session_id = ?
            AND role_layer = 'executor'
            AND persona_key = 'executor:frontend'
            AND session_id = ?`,
        [USER_ID, root.sessionId, root.sessionId, first.sessionId],
      ),
    ).toMatchObject({ count: 1 });
  });

  it('同 personaKey 的角色 session 存在活跃 handoff 时会创建新的 session', () => {
    const root = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });

    const first = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
      handoffState: 'running',
    });
    dbModule.sqliteRun(
      `INSERT INTO handoff_records (
         id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state
       ) VALUES ('active-handoff', ?, ?, 'pm2', 'executor', ?, '{}', 'running')`,
      [USER_ID, root.sessionId, first.sessionId],
    );

    const second = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
      handoffState: 'running',
    });

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(
      dbModule.sqliteGet<{ session_id: string }>(
        `SELECT session_id
           FROM team_role_session_instances
          WHERE user_id = ?
            AND root_session_id = ?
            AND parent_session_id = ?
            AND role_layer = 'executor'
            AND persona_key = 'executor:frontend'`,
        [USER_ID, root.sessionId, root.sessionId],
      ),
    ).toMatchObject({ session_id: second.sessionId });
  });

  it('旧 metadata 中已重复存在的角色 session 会收敛到单个数据库绑定', () => {
    const root = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });
    const firstLegacy = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      teamRoleInstance: {
        rootSessionId: root.sessionId,
        personaKey: 'executor:frontend',
        displayName: '前端开发者',
      },
    });
    const secondLegacy = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      teamRoleInstance: {
        rootSessionId: root.sessionId,
        personaKey: 'executor:frontend',
        displayName: '前端开发者',
      },
    });

    const resolved = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
    });
    const resolvedAgain = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
    });

    expect([firstLegacy.sessionId, secondLegacy.sessionId]).toContain(resolved.sessionId);
    expect(resolvedAgain.sessionId).toBe(resolved.sessionId);
    expect(
      dbModule.sqliteGet<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM team_role_session_instances
          WHERE user_id = ?
            AND root_session_id = ?
            AND parent_session_id = ?
            AND role_layer = 'executor'
            AND persona_key = 'executor:frontend'`,
        [USER_ID, root.sessionId, root.sessionId],
      ),
    ).toMatchObject({ count: 1 });
    expect(() => {
      dbModule.sqliteRun(
        `INSERT INTO team_role_session_instances (
           id, user_id, root_session_id, parent_session_id, role_layer, persona_key, session_id
         ) VALUES ('duplicate-binding', ?, ?, ?, 'executor', 'executor:frontend', ?)`,
        [USER_ID, root.sessionId, root.sessionId, secondLegacy.sessionId],
      );
    }).toThrow();
  });

  it('同根会话但不同父节点时不会复用同一个角色 session', () => {
    const root = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });
    const pm1A = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'pm1',
      teamParentSessionId: root.sessionId,
    });
    const pm1B = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'pm1',
      teamParentSessionId: root.sessionId,
    });

    const childFromA = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: pm1A.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
    });
    const childFromB = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: pm1B.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
    });

    expect(childFromB.sessionId).not.toBe(childFromA.sessionId);
    expect(
      dbModule.sqliteGet<{ count: number }>(
        `SELECT COUNT(*) AS count
           FROM team_role_session_instances
          WHERE user_id = ?
            AND root_session_id = ?
            AND role_layer = 'executor'
            AND persona_key = 'executor:frontend'`,
        [USER_ID, root.sessionId],
      ),
    ).toMatchObject({ count: 2 });
  });

  it('同一层级的不同 personaKey 会创建不同角色 session', () => {
    const root = teamSessionCreate.createTeamSession({
      userId: USER_ID,
      roleLayer: 'reception',
    });

    const frontend = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:frontend',
      displayName: '前端开发者',
    });
    const backend = teamSessionCreate.findOrCreateTeamRoleSession({
      userId: USER_ID,
      roleLayer: 'executor',
      teamParentSessionId: root.sessionId,
      personaKey: 'executor:backend',
      displayName: '后端开发者',
    });

    expect(backend.sessionId).not.toBe(frontend.sessionId);
  });
});
