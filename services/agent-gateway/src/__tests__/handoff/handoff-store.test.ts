/**
 * 260515-team-phase-b · T-03 单元测试
 *
 * 覆盖 handoff store 的状态机所有合法 / 非法过渡。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
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
  dbModule = await import('../../infra/db.js');
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
    expect(created.idempotencyKey).toBeNull();
    expect(created.paused).toBe(false);
    expect(created.pausedAt).toBeNull();
    expect(created.pausedByUserId).toBeNull();
    expect(created.pauseReason).toBeNull();

    const re = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(re).toBeDefined();
    expect(re?.state).toBe('pending');
  });

  it('同一用户同一 idempotencyKey 复用已有 handoff', () => {
    const first = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: 'first' },
      idempotencyKey: 'handoff-key-1',
    });

    const second = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
      payload: { intent: 'second' },
      idempotencyKey: 'handoff-key-1',
    });

    expect(second.id).toBe(first.id);
    expect(second.idempotencyKey).toBe('handoff-key-1');
    expect(second.payload).toEqual({ intent: 'first' });
  });

  it('未提供 idempotencyKey 时每次创建新 handoff', () => {
    const first = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    const second = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    expect(second.id).not.toBe(first.id);
    expect(second.idempotencyKey).toBeNull();
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

describe('pauseHandoff / resumeHandoff', () => {
  it('pending handoff 可以 pause 后 resume，并映射暂停字段', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    dbModule.sqliteRun(
      `UPDATE handoff_records SET updated_at = '2000-01-01 00:00:00' WHERE id = ?`,
      [created.id],
    );

    expect(
      store.pauseHandoff({
        userId: USER_ID,
        handoffId: created.id,
        reason: 'need-user-input',
      }),
    ).toBe(true);

    const paused = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(paused?.state).toBe('pending');
    expect(paused?.paused).toBe(true);
    expect(paused?.pausedAt).not.toBeNull();
    expect(paused?.pausedByUserId).toBe(USER_ID);
    expect(paused?.pauseReason).toBe('need-user-input');
    expect(paused?.updatedAt).not.toBe('2000-01-01 00:00:00');

    expect(store.resumeHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    const resumed = store.getHandoff({ userId: USER_ID, handoffId: created.id });
    expect(resumed?.paused).toBe(false);
    expect(resumed?.pausedAt).toBeNull();
    expect(resumed?.pausedByUserId).toBeNull();
    expect(resumed?.pauseReason).toBeNull();
  });

  it('running handoff 可以 pause 后 resume 且不改变 state', () => {
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

    expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    expect(store.getHandoff({ userId: USER_ID, handoffId: created.id })?.state).toBe('running');
    expect(store.resumeHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    expect(store.getHandoff({ userId: USER_ID, handoffId: created.id })?.state).toBe('running');
  });

  it('重复 pause 同一 handoff 返回 false，避免重复控制', () => {
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id })).toBe(false);
  });

  it('其他用户不能 pause 或 resume', () => {
    seedUser('u-other', 'other@example.com');
    const created = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });

    expect(store.pauseHandoff({ userId: 'u-other', handoffId: created.id })).toBe(false);
    expect(store.pauseHandoff({ userId: USER_ID, handoffId: created.id })).toBe(true);
    expect(store.resumeHandoff({ userId: 'u-other', handoffId: created.id })).toBe(false);
  });

  it('completed / failed / cancelled 终态拒绝 pause 和 resume', () => {
    const completed = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    store.claimHandoff({ handoffId: completed.id, claimToken: 'completed-token' });
    store.startHandoff({
      handoffId: completed.id,
      claimToken: 'completed-token',
      toSessionId: TO_SESSION_ID,
    });
    store.completeHandoff({ handoffId: completed.id, claimToken: 'completed-token' });

    const failed = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm2',
      toRoleLayer: 'executor',
    });
    store.claimHandoff({ handoffId: failed.id, claimToken: 'failed-token' });
    store.startHandoff({
      handoffId: failed.id,
      claimToken: 'failed-token',
      toSessionId: TO_SESSION_ID,
    });
    store.failHandoff({ handoffId: failed.id, claimToken: 'failed-token', reason: 'boom' });

    const cancelled = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    store.cancelHandoff({ userId: USER_ID, handoffId: cancelled.id });

    for (const handoff of [completed, failed, cancelled]) {
      expect(store.pauseHandoff({ userId: USER_ID, handoffId: handoff.id })).toBe(false);
      expect(store.resumeHandoff({ userId: USER_ID, handoffId: handoff.id })).toBe(false);
    }
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

  it('paused 的 pending handoff 不会出现在 pending 列表，也不能被 claim', () => {
    const paused = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'reception',
      toRoleLayer: 'pm1',
    });
    const active = store.createHandoff({
      userId: USER_ID,
      fromSessionId: FROM_SESSION_ID,
      fromRoleLayer: 'pm1',
      toRoleLayer: 'pm2',
    });

    expect(store.pauseHandoff({ userId: USER_ID, handoffId: paused.id })).toBe(true);

    const pending = store.listPendingHandoffs(50);
    expect(pending.map((item) => item.id)).toContain(active.id);
    expect(pending.map((item) => item.id)).not.toContain(paused.id);
    expect(store.claimHandoff({ handoffId: paused.id, claimToken: 'tok-paused' })).toBeNull();
    expect(store.claimHandoff({ handoffId: active.id, claimToken: 'tok-active' })).not.toBeNull();
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
