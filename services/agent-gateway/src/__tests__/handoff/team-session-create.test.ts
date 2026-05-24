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
