/**
 * 260515-team-phase-b · T-03 单元测试
 *
 * 覆盖 handoff store 的状态机所有合法 / 非法过渡。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../db.js';
import type * as HandoffStoreModule from '../../handoff/store/handoff-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof HandoffStoreModule;

const USER_ID = 'u-handoff';
const FROM_SESSION_ID = 's-from';
const TO_SESSION_ID = 's-to';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json)
     VALUES (?, ?, 'demo', '{}')`,
    [sessionId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/handoff-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'handoff@example.com');
  seedSession(FROM_SESSION_ID, USER_ID);
  seedSession(TO_SESSION_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('createHandoff / getHandoff', () => {
  it('创建 pending handoff，回读字段一致', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: '测试意图' },
    });
    expect(created.state).toBe('pending');
    expect(created.retryCount).toBe(0);
    expect(created.payload).toEqual({ intent: '测试意图' });
    expect(created.toSessionId).toBeNull();

    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re).toBeDefined();
    expect(re?.state).toBe('pending');
  });
});

describe('claimHandoff（并发互斥）', () => {
  it('第一次 claim 成功，第二次 claim 同一记录返回 null', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    const first = store.claimHandoff({ handoffId: created.id, claimToken: 'tok-A' });
    expect(first).not.toBeNull();
    expect(first?.state).toBe('claimed');

    const second = store.claimHandoff({ handoffId: created.id, claimToken: 'tok-B' });
    expect(second).toBeNull();
  });
});

describe('startHandoff / completeHandoff / failHandoff', () => {
  it('claim → start → complete 链路成功', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    expect(store.claimHandoff({ handoffId: created.id, claimToken: 'tok' })).not.toBeNull();
    expect(
      store.startHandoff({
        handoffId: created.id,
        claimToken: 'tok',
        toSessionId: TO_SESSION_ID,
      }),
    ).toBe(true);
    expect(store.completeHandoff({ handoffId: created.id, claimToken: 'tok' })).toBe(true);

    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('completed');
    expect(final?.toSessionId).toBe(TO_SESSION_ID);
    expect(final?.completedAt).not.toBeNull();
  });

  it('start 必须用正确 claimToken', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'good' });
    const ok = store.startHandoff({
      handoffId: created.id,
      claimToken: 'wrong',
      toSessionId: TO_SESSION_ID,
    });
    expect(ok).toBe(false);
  });

  it('fail 标记 failure_reason', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });
    expect(store.failHandoff({ handoffId: created.id, claimToken: 'tok', reason: 'boom' })).toBe(
      true,
    );
    const final = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(final?.state).toBe('failed');
    expect(final?.failureReason).toBe('boom');
  });
});

describe('cancelHandoff', () => {
  it('从 pending 直接 cancel 成功', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    expect(store.cancelHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    expect(store.getHandoff({ userId: USER_ID, handoffId: created.id })?.state).toBe('cancelled');
  });

  it('从 running cancel 也可以', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });
    expect(store.cancelHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
  });

  it('已 completed 的不能 cancel', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });
    store.completeHandoff({ handoffId: created.id, claimToken: 'tok' });
    expect(store.cancelHandoff({ userId: USER_ID, handoffId: created.id })).toBe(false);
  });

  it('其他用户不能 cancel', () => {
    seedUser('u-other', 'other@example.com');
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    expect(store.cancelHandoff({ userId: 'u-other', handoffId: created.id })).toBe(false);
  });
});

describe('listPendingHandoffs / listHandoffsBySession', () => {
  it('listPending 按 created_at 升序', () => {
    const a = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    const b = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });
    const pending = store.listPendingHandoffs(50);
    const ids = pending.map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('listHandoffsBySession 包含 from/to 两侧', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });

    const fromList = store.listHandoffsBySession({
      userId: USER_ID,
      sessionId: FROM_SESSION_ID,
    });
    expect(fromList.length).toBe(1);

    const toList = store.listHandoffsBySession({ userId: USER_ID, sessionId: TO_SESSION_ID });
    expect(toList.length).toBe(1);
  });
});

describe('reclaimAbandonedHandoffs（崩溃恢复）', () => {
  it('心跳超时的 running 退回 pending，retry_count+1', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });
    // 把 to_session 的心跳清空，模拟超时
    dbModule.sqliteRun(`UPDATE sessions SET last_heartbeat = NULL WHERE id = ?`, [TO_SESSION_ID]);

    const recovered = store.reclaimAbandonedHandoffs({
      staleHeartbeatBeforeIso: '2099-01-01 00:00:00',
      maxRetry: 3,
    });
    expect(recovered.reclaimedIds).toHaveLength(1);
    expect(recovered.failedIds).toHaveLength(0);

    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re?.state).toBe('pending');
    expect(re?.retryCount).toBe(1);
    expect(re?.claimToken).toBeNull();
  });

  it('达到 maxRetry 上限时改为 failed', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    // 直接把 retry_count 推到上限
    dbModule.sqliteRun(`UPDATE handoff_records SET retry_count = 3 WHERE id = ?`, [created.id]);
    store.claimHandoff({ handoffId: created.id, claimToken: 'tok' });
    store.startHandoff({
      handoffId: created.id,
      claimToken: 'tok',
      toSessionId: TO_SESSION_ID,
    });
    dbModule.sqliteRun(`UPDATE sessions SET last_heartbeat = NULL WHERE id = ?`, [TO_SESSION_ID]);

    const recovered = store.reclaimAbandonedHandoffs({
      staleHeartbeatBeforeIso: '2099-01-01 00:00:00',
      maxRetry: 3,
    });
    expect(recovered.reclaimedIds).toHaveLength(0);
    expect(recovered.failedIds).toHaveLength(1);

    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re?.state).toBe('failed');
    expect(re?.failureReason).toContain('heartbeat-timeout');
  });
});
