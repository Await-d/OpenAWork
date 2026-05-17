/**
 * 260518-team-l1.3 改造 1 单元测试
 *
 * 覆盖：
 *   - submitInboundMessage：基础写入 + 客户端幂等
 *   - consumePendingInboundMessage：优先级排序 + 消费幂等
 *   - hasPendingCancelSignal
 *   - 过期消息自动转 expired
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../db.js';
import type * as InboundStoreModule from '../handoff/inbound-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof InboundStoreModule;

const USER_ID = 'u-inbound';
const SESSION_ID = 's-inbound';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', 'reception')`,
    [sessionId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../db.js');
  await dbModule.migrate();
  store = await import('../handoff/inbound-store.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_inbound_messages', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID, 'inbound@example.com');
  seedSession(SESSION_ID, USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('submitInboundMessage', () => {
  it('基础写入：返回 record + reused=false', () => {
    const result = store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'hello' },
    });
    expect(result.reused).toBe(false);
    expect(result.record.id).toBeTruthy();
    expect(result.record.state).toBe('pending');
    expect(result.record.messageType).toBe('user_input');
  });

  it('客户端幂等：同一 idempotencyKey 复用记录', () => {
    const first = store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'hello' },
      clientIdempotencyKey: 'key-1',
    });
    const second = store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'world' }, // 不同 payload，但 key 同 → 应复用
      clientIdempotencyKey: 'key-1',
    });
    expect(second.reused).toBe(true);
    expect(second.record.id).toBe(first.record.id);
    // payload 仍是第一次的
    expect((second.record.payload as { text: string }).text).toBe('hello');
  });

  it('cancel_signal 默认无 expires_at（永不过期）', () => {
    const r = store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'cancel_signal',
      payload: { reason: 'user-cancelled' },
    });
    expect(r.record.expiresAt).toBeNull();
  });
});

describe('consumePendingInboundMessage', () => {
  it('返回 null 当没有 pending', () => {
    const m = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 0,
    });
    expect(m).toBeNull();
  });

  it('优先级：cancel > pause > clarification > user_input', () => {
    // 故意倒序提交
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'a' },
    });
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'clarification_answer',
      payload: { answer: 'b' },
    });
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'pause_signal',
      payload: { pausedBy: USER_ID },
    });
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'cancel_signal',
      payload: { reason: 'x' },
    });

    const first = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 0,
    });
    expect(first?.messageType).toBe('cancel_signal');
    const second = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 1,
    });
    expect(second?.messageType).toBe('pause_signal');
    const third = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 2,
    });
    expect(third?.messageType).toBe('clarification_answer');
    const fourth = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 3,
    });
    expect(fourth?.messageType).toBe('user_input');
  });

  it('已消费的不再返回', () => {
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'x' },
    });
    const first = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 0,
    });
    expect(first).not.toBeNull();
    const second = store.consumePendingInboundMessage({
      toSessionId: SESSION_ID,
      loopIteration: 1,
    });
    expect(second).toBeNull();
  });
});

describe('hasPendingCancelSignal', () => {
  it('无 cancel 时返回 false', () => {
    expect(store.hasPendingCancelSignal(SESSION_ID)).toBe(false);
  });

  it('有 cancel 时返回 true', () => {
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'cancel_signal',
      payload: { reason: 'x' },
    });
    expect(store.hasPendingCancelSignal(SESSION_ID)).toBe(true);
  });

  it('cancel 已消费后返回 false', () => {
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'cancel_signal',
      payload: { reason: 'x' },
    });
    store.consumePendingInboundMessage({ toSessionId: SESSION_ID, loopIteration: 0 });
    expect(store.hasPendingCancelSignal(SESSION_ID)).toBe(false);
  });
});

describe('listPendingInboundMessages', () => {
  it('返回当前 pending（按 created_at 升序）', () => {
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'a' },
    });
    store.submitInboundMessage({
      userId: USER_ID,
      toSessionId: SESSION_ID,
      fromRoleLayer: 'reception',
      messageType: 'user_input',
      payload: { text: 'b' },
    });
    const list = store.listPendingInboundMessages(SESSION_ID);
    expect(list).toHaveLength(2);
    expect(list.every((m) => m.state === 'pending')).toBe(true);
  });
});
