import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as TeamAuditStoreModule from '../../team/team-audit-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let auditStore: typeof TeamAuditStoreModule;

const USER_A = 'u-audit-a';
const USER_B = 'u-audit-b';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(id: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, state_status, messages_json, created_at, updated_at)
     VALUES (?, ?, ?, 'idle', '[]', datetime('now'), datetime('now'))`,
    [id, userId, id],
  );
}

function countAuditRows(userId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    `SELECT COUNT(1) AS count FROM team_audit_logs WHERE user_id = ?`,
    [userId],
  );
  return row?.count ?? 0;
}

function logRouteDecision(userId: string, index: number): void {
  auditStore.logTeamAudit({
    action: 'route_decision',
    detail: JSON.stringify({ index }),
    entityId: `entity-${index}`,
    entityType: 'session',
    summary: `decision ${index}`,
    userId,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  auditStore = await import('../../team/team-audit-store.js');
});

beforeEach(() => {
  auditStore.__resetTeamAuditPruneStateForTesting();
  auditStore.__setTeamAuditRetentionForTesting(null);
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  seedUser(USER_A, 'audit-a@example.com');
  seedUser(USER_B, 'audit-b@example.com');
});

afterEach(() => {
  auditStore.__setTeamAuditRetentionForTesting(null);
  auditStore.__resetTeamAuditPruneStateForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('team-audit-store 保留裁剪', () => {
  it('每用户行数被裁剪到保留上限附近（不会无界增长）', () => {
    const limit = 5;
    auditStore.__setTeamAuditRetentionForTesting(limit);

    const total = auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL * 3 + 7;
    for (let i = 0; i < total; i += 1) {
      logRouteDecision(USER_A, i);
    }

    const count = countAuditRows(USER_A);
    // 摊销裁剪：行数最多比上限多出一个检查间隔的过冲，但绝不会随插入次数线性增长。
    expect(count).toBeLessThanOrEqual(limit + auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL);
    expect(count).toBeLessThan(total);

    // 保留的是最新的若干条：最后一条 index 必须仍在。
    const newest = dbModule.sqliteGet<{ detail: string | null }>(
      `SELECT detail FROM team_audit_logs WHERE user_id = ? ORDER BY id DESC LIMIT 1`,
      [USER_A],
    );
    expect(newest?.detail ?? '').toContain(`"index":${total - 1}`);
  });

  it('裁剪后稳定收敛到保留上限（连续触发多轮）', () => {
    const limit = 10;
    auditStore.__setTeamAuditRetentionForTesting(limit);

    for (let i = 0; i < auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL * 5; i += 1) {
      logRouteDecision(USER_A, i);
    }
    // 触发点上的裁剪把行数精确收敛到 limit；此后的少量插入仍在下一个检查间隔内累积。
    expect(countAuditRows(USER_A)).toBeLessThanOrEqual(
      limit + auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL,
    );
  });

  it('裁剪按 user 隔离，不影响其它用户的审计行', () => {
    auditStore.__setTeamAuditRetentionForTesting(3);

    for (let i = 0; i < auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL + 5; i += 1) {
      logRouteDecision(USER_A, i);
    }
    // USER_B 只有少量行，远低于检查间隔，不应被触碰。
    logRouteDecision(USER_B, 0);
    logRouteDecision(USER_B, 1);

    expect(countAuditRows(USER_B)).toBe(2);
    expect(countAuditRows(USER_A)).toBeLessThanOrEqual(
      3 + auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL,
    );
  });

  it('保留上限设为非正数时关闭裁剪（行数随插入线性增长）', () => {
    auditStore.__setTeamAuditRetentionForTesting(0);

    const total = auditStore.TEAM_AUDIT_PRUNE_CHECK_INTERVAL * 2 + 13;
    for (let i = 0; i < total; i += 1) {
      logRouteDecision(USER_A, i);
    }

    expect(countAuditRows(USER_A)).toBe(total);
  });

  it('审计记录会保留可选 sessionId 归属字段', () => {
    seedSession('session-123', USER_A);
    auditStore.__insertTeamAuditLogForTesting({
      action: 'route_decision',
      entityId: 'entity-session',
      entityType: 'session',
      sessionId: 'session-123',
      summary: 'decision with session scope',
      userId: USER_A,
    });

    const latest = auditStore.listTeamAuditLogs({ userId: USER_A, limit: 1 })[0];
    expect(latest?.sessionId).toBe('session-123');
  });
});
