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
import type * as DbModule from '../../infra/db.js';
import type * as InboundStoreModule from '../../handoff/store/inbound-store.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let store: typeof InboundStoreModule;
let teamEventsBus: typeof TeamEventsBusModule;

const USER_ID = 'u-inbound';
const SESSION_ID = 's-inbound';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  // 用 pm1 role_layer 是因为本测试覆盖所有 inbound 类型（包括 clarification_answer
  // 只对 pm1 / pm2 合法）。layer-capabilities 矩阵会按 to_session.role_layer 校验。
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, role_layer)
     VALUES (?, ?, 'demo', '{}', 'pm1')`,
    [sessionId, userId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  store = await import('../../handoff/store/inbound-store.js');
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
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

  it('内部层 submitInbound 也会发布 session.inbound.submitted 实时事件', () => {
    dbModule.sqliteRun(`UPDATE sessions SET role_layer = 'reception' WHERE id = ?`, [SESSION_ID]);
    const events: TeamEventsBusModule.TeamEventEnvelope[] = [];
    const unsubscribe = teamEventsBus.subscribeToTeamEvents((event) => {
      events.push(event);
    });
    try {
      store.submitInboundMessage({
        userId: USER_ID,
        toSessionId: SESSION_ID,
        fromRoleLayer: 'pm2',
        messageType: 'escalation_request',
        payload: {
          fromLayer: 'pm2',
          fromSessionId: 'pm2-session',
          pm2HandoffId: 'handoff-pm2-review',
          reason: 'review_failed_threshold',
          context: '评审连续失败，等待用户决策',
        },
      });

      expect(events).toEqual([
        expect.objectContaining({
          type: 'session.inbound.submitted',
          sessionId: SESSION_ID,
          layer: 'pm2',
          userId: USER_ID,
          payload: expect.objectContaining({
            blocking: true,
            fromSessionId: 'pm2-session',
            handoffId: 'handoff-pm2-review',
            messageType: 'escalation_request',
            reason: 'review_failed_threshold',
            summary: '评审连续失败，等待用户决策',
          }),
        }),
      ]);
    } finally {
      unsubscribe();
    }
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

describe('resolveClarificationEscalationRequest', () => {
  it('回答单条澄清会更新 escalation_request payload，并在全部解决后转 consumed', () => {
    dbModule.sqliteRun(
      `INSERT INTO session_inbound_messages
        (id, user_id, to_session_id, from_role_layer, message_type, payload_json, state)
       VALUES ('clarify-inbound-store', ?, ?, 'pm1', 'escalation_request', ?, 'pending')`,
      [
        USER_ID,
        SESSION_ID,
        JSON.stringify({
          fromLayer: 'pm1',
          fromSessionId: 'pm1-session',
          reason: 'needs_clarification',
          escalationRound: 0,
          context: '需要补充信息',
          suggestedActions: [{ label: '回答', action: 'answer' }],
          questions: [
            { id: 'q-1', question: '认证方式？', context: '登录模块' },
            { id: 'q-2', question: '部署方式？', context: '运维模块' },
          ],
        }),
      ],
    );

    const first = store.resolveClarificationEscalationRequest({
      answer: 'OAuth',
      answeredAt: 123,
      questionId: 'q-1',
      status: 'answered',
      userId: USER_ID,
    });
    expect(first?.state).toBe('pending');
    expect((first?.payload as { questions: Array<Record<string, unknown>> }).questions[0]).toMatchObject({
      id: 'q-1',
      answer: 'OAuth',
      answeredAt: 123,
      status: 'answered',
    });

    const second = store.resolveClarificationEscalationRequest({
      answeredAt: 456,
      questionId: 'q-2',
      status: 'dismissed',
      userId: USER_ID,
    });
    expect(second?.state).toBe('consumed');
    expect((second?.payload as { questions: Array<Record<string, unknown>> }).questions[1]).toMatchObject({
      id: 'q-2',
      answeredAt: 456,
      status: 'dismissed',
    });

    const row = dbModule.sqliteGet<{ state: string }>(
      `SELECT state FROM session_inbound_messages WHERE id = ? LIMIT 1`,
      ['clarify-inbound-store'],
    );
    expect(row?.state).toBe('consumed');
  });
});
