/**
 * 会话扩展回执的持久化投递机制（261101，真实内存 SQLite）。
 *
 * 守方案 §5 的「提交后写 durable 结果投递记录，按 operationId 去重，通知失败不重复
 * 安装」：入队幂等、租约互斥、失败退避、上限转终态、启动补偿有窗口。
 *
 * 这些性质靠**单条 UPDATE 的条件与 changes** 实现，所以必须打真实数据库，用 mock
 * 断言不出「两人同时领取」这类问题。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OpStoreModule from '../../session-extension/session-extension-operation-store.js';
import type * as DeliveryStoreModule from '../../session-extension/session-extension-delivery-store.js';
import type * as DeliveryDispatcherModule from '../../session-extension/session-extension-delivery-dispatcher.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-delivery';
const SESSION_ID = 's-delivery';

let db: typeof DbModule;
let opStore: typeof OpStoreModule;
let deliveryStore: typeof DeliveryStoreModule;
let dispatcher: typeof DeliveryDispatcherModule;

/** 建一条 `rejected` 终态操作（走生产状态机，而不是直接改库）。 */
function seedTerminalOperation(now?: number): string {
  const operation = opStore.createSessionExtensionOperation({
    sessionId: SESSION_ID,
    ownerUserId: USER_ID,
    kind: 'skill',
    action: 'install',
    resourceRef: 'skill://demo',
    payload: { skillId: 'demo', displayName: '演示技能' },
    configDigest: null,
    expectedRevision: null,
    ...(now === undefined ? {} : { now }),
  });
  opStore.rejectSessionExtensionOperation({
    sessionId: SESSION_ID,
    operationId: operation.id,
    approverUserId: USER_ID,
    nonce: operation.nonce,
    reason: '来源不可信',
  });
  return operation.id;
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  opStore = await import('../../session-extension/session-extension-operation-store.js');
  deliveryStore = await import('../../session-extension/session-extension-delivery-store.js');
  dispatcher = await import('../../session-extension/session-extension-delivery-dispatcher.js');
});

afterAll(async () => {
  await db.closeDb();
});

function resetTables(): void {
  db.sqliteRun('DELETE FROM session_extension_deliveries', []);
  db.sqliteRun('DELETE FROM session_extension_operations', []);
}

beforeEach(() => {
  resetTables();
  db.sqliteRun('DELETE FROM sessions', []);
  db.sqliteRun('DELETE FROM users', []);
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'demo', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

describe('入队与去重', () => {
  it('同一操作重复入队只留一条，文案在入队时冻结', () => {
    const operationId = seedTerminalOperation();
    expect(
      deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID }),
    ).toBe(true);
    expect(
      deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID }),
    ).toBe(false);

    const delivery = deliveryStore.getSessionExtensionDelivery(operationId);
    expect(delivery?.state).toBe('pending');
    expect(delivery?.attemptCount).toBe(0);
    expect(delivery?.text).toContain('演示技能');
  });

  it('操作不存在时不入队', () => {
    expect(
      deliveryStore.enqueueSessionExtensionDelivery({
        operationId: 'opx_missing',
        sessionId: SESSION_ID,
      }),
    ).toBe(false);
  });
});

describe('租约与并发领取', () => {
  it('同一时刻只有一次领取成功', () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });
    const now = Date.now();

    const first = deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: 'lease-a', now });
    const second = deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: 'lease-b', now });

    expect(first?.operationId).toBe(operationId);
    expect(first?.attemptCount).toBe(1);
    expect(second).toBeNull();
  });

  it('租约过期后被回收，可被重新领取', () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });
    const now = Date.now();
    expect(
      deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: 'lease-a', now }),
    ).not.toBeNull();

    const later = now + deliveryStore.SESSION_EXTENSION_DELIVERY_LEASE_MS + 1;
    expect(deliveryStore.reclaimExpiredSessionExtensionDeliveryLeases(later)).toBe(1);
    expect(
      deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: 'lease-c', now: later })
        ?.operationId,
    ).toBe(operationId);
  });

  it('租约已失时迟到的失败不再改写记录', () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });
    const now = Date.now();
    deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: 'lease-a', now });

    const later = now + deliveryStore.SESSION_EXTENSION_DELIVERY_LEASE_MS + 1;
    deliveryStore.reclaimExpiredSessionExtensionDeliveryLeases(later);

    expect(
      deliveryStore.failSessionExtensionDelivery({
        operationId,
        leaseToken: 'lease-a',
        error: '迟到的失败',
        now: later,
      }),
    ).toBeNull();
    expect(deliveryStore.getSessionExtensionDelivery(operationId)?.state).toBe('pending');
  });
});

describe('失败退避与终态', () => {
  it('失败按指数退避重排，超上限置 dead 且不再领取', () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });

    let now = Date.now();
    const states: Array<string | null> = [];
    for (
      let attempt = 1;
      attempt <= deliveryStore.SESSION_EXTENSION_DELIVERY_MAX_ATTEMPTS;
      attempt += 1
    ) {
      const leaseToken = `lease-${attempt}`;
      const claim = deliveryStore.claimDueSessionExtensionDelivery({ leaseToken, now });
      expect(claim?.attemptCount).toBe(attempt);
      states.push(
        deliveryStore.failSessionExtensionDelivery({
          operationId,
          leaseToken,
          error: 'boom',
          now,
        }),
      );
      if (attempt < deliveryStore.SESSION_EXTENSION_DELIVERY_MAX_ATTEMPTS) {
        // 退避窗口内不可被再次领取。
        expect(
          deliveryStore.claimDueSessionExtensionDelivery({ leaseToken: `early-${attempt}`, now }),
        ).toBeNull();
        now += 60_001;
      }
    }

    expect(states).toEqual(['pending', 'pending', 'pending', 'pending', 'dead']);
    expect(deliveryStore.getSessionExtensionDelivery(operationId)?.state).toBe('dead');
    expect(
      deliveryStore.claimDueSessionExtensionDelivery({
        leaseToken: 'after-dead',
        now: now + 600_000,
      }),
    ).toBeNull();
  });
});

describe('非渠道会话', () => {
  it('回执标记 skipped 终态，不再反复重试', async () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });

    const first = await dispatcher.dispatchSessionExtensionDeliveries();
    expect(first.skipped).toBe(1);
    expect(deliveryStore.getSessionExtensionDelivery(operationId)?.state).toBe('skipped');

    // 终态：下一轮不该再被领取（否则每次轮询都白跑一次渠道解析）。
    const second = await dispatcher.dispatchSessionExtensionDeliveries();
    expect(second).toEqual({ delivered: 0, skipped: 0, retried: 0, dead: 0 });
  });
});

describe('启动补偿', () => {
  it('只补窗口内缺记录的已结算操作', () => {
    const recent = seedTerminalOperation();
    const stale = seedTerminalOperation(
      Date.now() - deliveryStore.SESSION_EXTENSION_DELIVERY_RECONCILE_WINDOW_MS - 60_000,
    );

    expect(deliveryStore.reconcileSessionExtensionDeliveries()).toBe(1);
    expect(deliveryStore.getSessionExtensionDelivery(recent)).toBeDefined();
    expect(deliveryStore.getSessionExtensionDelivery(stale)).toBeUndefined();
  });

  it('早建晚结算的操作仍能补偿（按结算时刻而非创建时刻）', () => {
    // 提案 2 小时前创建、5 分钟前才结算。修复前补偿按 `created_at` 只回看 30 分钟，
    // 这条会被漏掉：进程在结算与入队之间崩溃，回执就永远补不回来。
    const createdAt = Date.now() - 2 * 60 * 60 * 1000;
    const settledAt = Date.now() - 5 * 60 * 1000;
    const operation = opStore.createSessionExtensionOperation({
      sessionId: SESSION_ID,
      ownerUserId: USER_ID,
      kind: 'skill',
      action: 'install',
      resourceRef: 'skill://late-settle',
      payload: { skillId: 'late-settle', displayName: '迟到结算' },
      configDigest: null,
      expectedRevision: null,
      // 长 TTL：创建时间早，但结算那一刻仍未过期。
      ttlMs: 4 * 60 * 60 * 1000,
      now: createdAt,
    });
    opStore.rejectSessionExtensionOperation({
      sessionId: SESSION_ID,
      operationId: operation.id,
      approverUserId: USER_ID,
      nonce: operation.nonce,
      reason: '迟到结算',
      now: settledAt,
    });

    // 显式给「30 分钟」窗口把它钉死：窗口表达的是**可容忍的停机时长**，结算落在
    // 窗口内就该补，不该因为提案建得早而被丢掉。用默认窗口测不出这一点——放宽到
    // 24h 后 `created_at` 也照样覆盖，两个改动会互相掩盖。
    expect(deliveryStore.reconcileSessionExtensionDeliveries({ windowMs: 30 * 60 * 1000 })).toBe(1);
    expect(deliveryStore.getSessionExtensionDelivery(operation.id)).toBeDefined();
  });

  it('已入队的操作不会被补偿重复插入', () => {
    const operationId = seedTerminalOperation();
    deliveryStore.enqueueSessionExtensionDelivery({ operationId, sessionId: SESSION_ID });
    expect(deliveryStore.reconcileSessionExtensionDeliveries()).toBe(0);
    expect(deliveryStore.getSessionExtensionDelivery(operationId)?.attemptCount).toBe(0);
  });

  it('非终态操作永不被补偿（等待用户确认的不该有回执）', () => {
    opStore.createSessionExtensionOperation({
      sessionId: SESSION_ID,
      ownerUserId: USER_ID,
      kind: 'skill',
      action: 'install',
      resourceRef: 'skill://pending',
      payload: { skillId: 'pending' },
      configDigest: null,
      expectedRevision: null,
    });
    expect(deliveryStore.reconcileSessionExtensionDeliveries()).toBe(0);
  });
});
