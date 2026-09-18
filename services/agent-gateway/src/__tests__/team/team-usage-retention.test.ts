import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TeamUsageRecordsModule from '../../team/team-usage-records-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let usageStore: typeof TeamUsageRecordsModule;

const USER_A = 'u-usage-a';
const USER_B = 'u-usage-b';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function countUsageRows(userId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(1) AS count FROM team_usage_records WHERE user_id = ?',
    [userId],
  );
  return row?.count ?? 0;
}

function countRowsByTurn(userId: string, clientRequestId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(1) AS count FROM team_usage_records WHERE user_id = ? AND client_request_id = ?',
    [userId, clientRequestId],
  );
  return row?.count ?? 0;
}

function writeUsage(userId: string, index: number): void {
  usageStore.persistTeamUsageRecord({
    userId,
    sessionId: `usage-session-${index % 3}`,
    layer: 'executor',
    provider: 'openai',
    model: 'gpt-retention',
    clientRequestId: `turn-usage-${index}`,
    inputTokens: 1,
    outputTokens: 1,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  usageStore = await import('../../team/team-usage-records-store.js');
});

beforeEach(() => {
  usageStore.__resetTeamUsagePruneStateForTesting();
  usageStore.__setTeamUsageRetentionForTesting(null);
  dbModule.sqliteRun('DELETE FROM team_usage_records', []);
  seedUser(USER_A, 'usage-a@example.com');
  seedUser(USER_B, 'usage-b@example.com');
});

afterEach(() => {
  usageStore.__setTeamUsageRetentionForTesting(null);
  usageStore.__resetTeamUsagePruneStateForTesting();
  delete process.env['OPENAWORK_TEAM_USAGE_MAX_ROWS_PER_USER'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team-usage-records-store 保留裁剪', () => {
  it('每用户行数被摊销裁剪到保留上限附近（不会无界增长）', () => {
    const limit = 5;
    usageStore.__setTeamUsageRetentionForTesting(limit, 3);

    const total = 16;
    for (let index = 0; index < total; index += 1) {
      writeUsage(USER_A, index);
    }

    const count = countUsageRows(USER_A);
    expect(count).toBeLessThanOrEqual(limit + 3);
    expect(count).toBeLessThan(total);
    expect(countRowsByTurn(USER_A, `turn-usage-${total - 1}`)).toBe(1);
  });

  it('保留最新 N 行，且刚写入的行永不成为裁剪对象', () => {
    usageStore.__setTeamUsageRetentionForTesting(1, 1);

    writeUsage(USER_A, 0);
    expect(countRowsByTurn(USER_A, 'turn-usage-0')).toBe(1);

    writeUsage(USER_A, 1);
    expect(countUsageRows(USER_A)).toBe(1);
    expect(countRowsByTurn(USER_A, 'turn-usage-0')).toBe(0);
    expect(countRowsByTurn(USER_A, 'turn-usage-1')).toBe(1);
  });

  it('timing 写入与 usage 共用同一摊销裁剪', () => {
    usageStore.__setTeamUsageRetentionForTesting(1, 1);

    usageStore.persistTeamTimingRecord({
      userId: USER_A,
      sessionId: 'usage-session-timing',
      layer: 'executor',
      provider: 'openai',
      model: 'gpt-retention',
      clientRequestId: 'turn-timing-1',
      durationMs: 25,
    });
    usageStore.persistTeamTimingRecord({
      userId: USER_A,
      sessionId: 'usage-session-timing',
      layer: 'executor',
      provider: 'openai',
      model: 'gpt-retention',
      clientRequestId: 'turn-timing-2',
      durationMs: 25,
    });

    expect(countUsageRows(USER_A)).toBe(1);
    expect(countRowsByTurn(USER_A, 'turn-timing-2')).toBe(1);
  });

  it('裁剪按 user 隔离，不影响其它用户的用量行', () => {
    usageStore.__setTeamUsageRetentionForTesting(2, 1);

    for (let index = 0; index < 6; index += 1) {
      writeUsage(USER_A, index);
    }
    writeUsage(USER_B, 0);
    writeUsage(USER_B, 1);

    expect(countUsageRows(USER_A)).toBe(2);
    expect(countUsageRows(USER_B)).toBe(2);
  });

  it('保留上限设为非正数时关闭裁剪（行数随写入线性增长）', () => {
    usageStore.__setTeamUsageRetentionForTesting(0, 1);

    for (let index = 0; index < 7; index += 1) {
      writeUsage(USER_A, index);
    }

    expect(countUsageRows(USER_A)).toBe(7);
  });

  it('env OPENAWORK_TEAM_USAGE_MAX_ROWS_PER_USER 可覆盖默认上限', () => {
    process.env['OPENAWORK_TEAM_USAGE_MAX_ROWS_PER_USER'] = '2';
    usageStore.__setTeamUsageRetentionForTesting(null, 1);

    for (let index = 0; index < 4; index += 1) {
      writeUsage(USER_A, index);
    }

    expect(countUsageRows(USER_A)).toBe(2);
    expect(countRowsByTurn(USER_A, 'turn-usage-3')).toBe(1);
  });
});
