/**
 * 渠道通知幂等出站与规则存储回归（真实内存 SQLite）。
 *
 * 覆盖：同 dedupeKey 幂等入队、脱敏断言、领取租约互斥、失败上限与回收、
 * 规则 upsert 版本递增、注入白名单过滤。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OutboxModule from '../../memory/governance/memory-notification-outbox.js';
import type * as RuleStoreModule from '../../memory/governance/memory-rule-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let outbox: typeof OutboxModule;
let rules: typeof RuleStoreModule;

const USER_ID = 'u-memory-outbox';
const OWNER_A = 'delivery-a';
const OWNER_B = 'delivery-b';

const BASE_TIME = new Date('2026-11-01T00:00:00.000Z');
/** 故意层层包裹的敏感样例：任何一条都不得出现在通知正文里。 */
const SECRET_KEY = 'private-db-password';
const SECRET_VALUE = 'hunter2-super-secret';
const SECRET_SENDER = '张三的私聊真实姓名';

function at(offsetMs: number): Date {
  return new Date(BASE_TIME.getTime() + offsetMs);
}

function userScope(): { type: 'user'; id: string } {
  return { type: 'user', id: USER_ID };
}

function countDeliveries(): number {
  return (
    dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM memory_deliveries', [])?.n ?? 0
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  outbox = await import('../../memory/governance/memory-notification-outbox.js');
  rules = await import('../../memory/governance/memory-rule-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_deliveries', []);
  dbModule.sqliteRun('DELETE FROM memory_rule_entries', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function enqueue(dedupeKey = 'report:1'): void {
  outbox.enqueueMemoryNotification({
    userId: USER_ID,
    channelInstanceId: 'chan-1',
    chatId: 'chat-1',
    dedupeKey,
    body: outbox.buildMemoryDeliveryBody({
      pendingProposalCount: 2,
      reportCount: 1,
      confirmPath: '/memory/confirm',
    }),
    now: at(0),
  });
}

describe('memory-notification-outbox · 幂等入队', () => {
  it('同 dedupeKey 重复 enqueue 只有一行', () => {
    enqueue('report:1');
    enqueue('report:1');
    enqueue('report:1');
    expect(countDeliveries()).toBe(1);

    enqueue('report:2');
    expect(countDeliveries()).toBe(2);
  });

  it('claim 后 body 不含任何记忆正文 / key / value / 发送者名称', () => {
    // 模拟上游误传正文：把敏感样例塞进 lines。
    outbox.enqueueMemoryNotification({
      userId: USER_ID,
      channelInstanceId: 'chan-1',
      chatId: 'chat-1',
      dedupeKey: 'report:secret',
      body: {
        title: '误传标题',
        lines: [
          `记忆 key: ${SECRET_KEY}`,
          `记忆 value: ${SECRET_VALUE}`,
          `来源发送者: ${SECRET_SENDER}`,
        ],
        href: '/memory/confirm',
      },
      now: at(0),
    });

    const claimed = outbox.claimPendingMemoryDeliveries({
      owner: OWNER_A,
      limit: 10,
      now: at(1),
    });
    expect(claimed).toHaveLength(1);

    const serialized = JSON.stringify(claimed[0]?.body);
    expect(serialized).not.toContain(SECRET_KEY);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain(SECRET_SENDER);

    // buildMemoryDeliveryBody 产出的默认正文同样不含这些样例。
    const built = outbox.buildMemoryDeliveryBody({
      pendingProposalCount: 1,
      reportCount: 0,
      confirmPath: '/memory/confirm',
    });
    expect(JSON.stringify(built)).not.toContain(SECRET_VALUE);
    expect(built.title).toBe('有新的记忆待确认');
  });

  it('超长行与超长正文被截断', () => {
    outbox.enqueueMemoryNotification({
      userId: USER_ID,
      channelInstanceId: 'chan-1',
      chatId: 'chat-1',
      dedupeKey: 'report:long',
      body: { title: 'x', lines: ['y'.repeat(5000), 'z'.repeat(5000)], href: null },
      now: at(0),
    });
    const claimed = outbox.claimPendingMemoryDeliveries({
      owner: OWNER_A,
      limit: 10,
      now: at(1),
    });
    expect(claimed).toHaveLength(1);
    for (const line of claimed[0]?.body.lines ?? []) {
      expect(line.length).toBeLessThanOrEqual(200);
    }
    const total = (claimed[0]?.body.lines ?? []).join('').length;
    expect(total).toBeLessThanOrEqual(500);
  });
});

describe('memory-notification-outbox · 领取与租约', () => {
  it('两方 claim：只有一方拿到，另一个返回空', () => {
    enqueue('report:race');
    const first = outbox.claimPendingMemoryDeliveries({ owner: OWNER_A, limit: 10, now: at(1) });
    const second = outbox.claimPendingMemoryDeliveries({ owner: OWNER_B, limit: 10, now: at(1) });
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    const status = dbModule.sqliteGet<{ status: string; lease_owner: string | null }>(
      'SELECT status, lease_owner FROM memory_deliveries WHERE dedupe_key = ?',
      ['report:race'],
    );
    expect(status?.status).toBe('sending');
    expect(status?.lease_owner).toBe(OWNER_A);
  });

  it('completeMemoryDelivery 只有持租约的 owner 能完成', () => {
    enqueue('report:complete');
    const [row] = outbox.claimPendingMemoryDeliveries({ owner: OWNER_A, limit: 10, now: at(1) });
    expect(row).toBeDefined();
    expect(outbox.completeMemoryDelivery(row!.id, OWNER_B)).toBe(false);
    expect(outbox.completeMemoryDelivery(row!.id, OWNER_A)).toBe(true);

    const status = dbModule.sqliteGet<{ status: string }>(
      'SELECT status FROM memory_deliveries WHERE id = ?',
      [row!.id],
    );
    expect(status?.status).toBe('sent');
  });

  it('failMemoryDelivery 达上限置 failed；未达则回 pending 且退避', () => {
    enqueue('report:fail');
    let deliveryId = '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const now = at(1_000_000 * (attempt + 1));
      // 首次领取用 pending；失败退避后把 next_attempt_at 拉回以便继续尝试。
      const claimed = outbox.claimPendingMemoryDeliveries({ owner: OWNER_A, limit: 10, now });
      if (claimed.length === 0) {
        dbModule.sqliteRun(
          "UPDATE memory_deliveries SET next_attempt_at = ? WHERE dedupe_key = 'report:fail'",
          [now.toISOString()],
        );
        const retried = outbox.claimPendingMemoryDeliveries({
          owner: OWNER_A,
          limit: 10,
          now: at(now.getTime() + 1),
        });
        expect(retried).toHaveLength(1);
        deliveryId = retried[0]!.id;
        expect(outbox.failMemoryDelivery(deliveryId, OWNER_A, 'net', at(now.getTime() + 2))).toBe(
          true,
        );
        continue;
      }
      deliveryId = claimed[0]!.id;
      expect(outbox.failMemoryDelivery(deliveryId, OWNER_A, 'net', at(now.getTime() + 2))).toBe(
        true,
      );
    }

    const row = dbModule.sqliteGet<{ status: string; attempts: number }>(
      'SELECT status, attempts FROM memory_deliveries WHERE id = ?',
      [deliveryId],
    );
    expect(row?.attempts).toBe(5);
    expect(row?.status).toBe('failed');
  });

  it('failMemoryDelivery 用错误 owner 调用返回 false', () => {
    enqueue('report:owner');
    const [row] = outbox.claimPendingMemoryDeliveries({ owner: OWNER_A, limit: 10, now: at(1) });
    expect(outbox.failMemoryDelivery(row!.id, OWNER_B, 'net', at(2))).toBe(false);
  });

  it('recoverExpiredMemoryDeliveryLeases 回收过期 sending', () => {
    enqueue('report:recover');
    outbox.claimPendingMemoryDeliveries({ owner: OWNER_A, limit: 10, now: at(1) });

    expect(outbox.recoverExpiredMemoryDeliveryLeases(at(60_000))).toBe(0);
    expect(outbox.recoverExpiredMemoryDeliveryLeases(at(6 * 60 * 1000))).toBe(1);

    const row = dbModule.sqliteGet<{ status: string; lease_owner: string | null }>(
      'SELECT status, lease_owner FROM memory_deliveries WHERE dedupe_key = ?',
      ['report:recover'],
    );
    expect(row?.status).toBe('pending');
    expect(row?.lease_owner).toBeNull();

    expect(
      outbox.claimPendingMemoryDeliveries({
        owner: OWNER_B,
        limit: 10,
        now: at(6 * 60 * 1000 + 1),
      }),
    ).toHaveLength(1);
  });
});

describe('memory-rule-store · 版本与白名单', () => {
  it('同 scope+name 第二次 upsert 走更新且 revision=2', () => {
    const created = rules.upsertMemoryRule({
      userId: USER_ID,
      scope: userScope(),
      name: '回答风格',
      body: '简洁',
      now: at(0),
    });
    expect(created.revision).toBe(1);
    expect(created.enabled).toBe(true);
    expect(created.scope).toEqual(userScope());

    const updated = rules.upsertMemoryRule({
      userId: USER_ID,
      scope: userScope(),
      name: '回答风格',
      body: '简洁、中文',
      now: at(1),
    });
    expect(updated.id).toBe(created.id);
    expect(updated.revision).toBe(2);
    expect(updated.body).toBe('简洁、中文');

    expect(rules.listMemoryRules(USER_ID)).toHaveLength(1);
    expect(rules.listMemoryRules(USER_ID, userScope())).toHaveLength(1);
    expect(rules.listMemoryRules(USER_ID, { type: 'team', id: 't-1' })).toHaveLength(0);
  });

  it('listMemoryRulesForInjection 对不在白名单的 scope 返回空', () => {
    rules.upsertMemoryRule({
      userId: USER_ID,
      scope: userScope(),
      name: 'r-user',
      body: 'body-user',
      now: at(0),
    });
    rules.upsertMemoryRule({
      userId: USER_ID,
      scope: { type: 'workspace', id: '/tmp/ws' },
      name: 'r-ws',
      body: 'body-ws',
      now: at(0),
    });

    // 空白名单 = 不返回任何规则。
    expect(rules.listMemoryRulesForInjection(USER_ID, [])).toHaveLength(0);

    const onlyUser = rules.listMemoryRulesForInjection(USER_ID, [`user:${USER_ID}`]);
    expect(onlyUser).toHaveLength(1);
    expect(onlyUser[0]?.name).toBe('r-user');

    const none = rules.listMemoryRulesForInjection(USER_ID, ['team:t-1']);
    expect(none).toHaveLength(0);
  });

  it('setMemoryRuleEnabled 后停用规则不再进入注入白名单', () => {
    const rule = rules.upsertMemoryRule({
      userId: USER_ID,
      scope: userScope(),
      name: 'toggle',
      body: 'body',
      now: at(0),
    });
    expect(rules.setMemoryRuleEnabled({ userId: USER_ID, ruleId: rule.id, enabled: false })).toBe(
      true,
    );
    expect(rules.listMemoryRulesForInjection(USER_ID, [`user:${USER_ID}`])).toHaveLength(0);

    expect(rules.deleteMemoryRule(USER_ID, rule.id)).toBe(true);
    expect(rules.listMemoryRules(USER_ID)).toHaveLength(0);
  });
});
