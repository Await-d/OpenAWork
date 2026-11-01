import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Db from '../../infra/db.js';
import type * as Delivery from '../../handoff/workflow/inbound-delivery-dispatcher.js';
import { submitInboundWithHistory } from '../../handoff/store/inbound-delivery.js';

const mocks = vi.hoisted(() => ({ orchestrate: vi.fn() }));
vi.mock('../../handoff/runner/reception-orchestrator.js', () => ({
  orchestrateReceptionInput: mocks.orchestrate,
}));
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
let db: typeof Db;
let delivery: typeof Delivery;
const userId = 'u-delivery';
const sessionId = 's-delivery';

function seedSession(id = sessionId, status = 'idle') {
  db.sqliteRun(
    "INSERT INTO sessions(id,user_id,title,role_layer,state_status,metadata_json) VALUES (?,?,'reception','reception',?,'{}')",
    [id, userId, status],
  );
}
function submit(id = sessionId, key = 'delivery-1') {
  return submitInboundWithHistory({
    userId,
    toSessionId: id,
    roleLayer: 'reception',
    fromRoleLayer: 'user',
    messageType: 'user_input',
    payload: { text: '你好' },
    clientIdempotencyKey: key,
    requestId: key,
  });
}
function read(id: string) {
  return db.sqliteGet<{ state: string; attempt_count: number; last_error: string | null }>(
    'SELECT state, attempt_count, last_error FROM team_inbound_outbox WHERE inbound_id = ?',
    [id],
  );
}
beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.migrate();
  delivery = await import('../../handoff/workflow/inbound-delivery-dispatcher.js');
});
beforeEach(() => {
  db.sqliteRun('DELETE FROM users');
  db.sqliteRun("INSERT INTO users(id,email,password_hash) VALUES (?,'delivery@example.test','x')", [
    userId,
  ]);
  seedSession();
  mocks.orchestrate.mockReset().mockResolvedValue({ triggered: false, reason: 'direct-answer' });
});
afterAll(async () => {
  await db.closeDb();
});

describe('持久入站投递', () => {
  it('提交后尚未执行仍保留责任，新dispatcher扫描后确认且幂等', async () => {
    const item = submit();
    expect(read(item.record.id)?.state).toBe('pending');
    expect(mocks.orchestrate).not.toHaveBeenCalled();
    await delivery.dispatchInboundDeliveries();
    await delivery.dispatchInboundDeliveries();
    expect(mocks.orchestrate).toHaveBeenCalledTimes(1);
    expect(read(item.record.id)).toMatchObject({ state: 'delivered', attempt_count: 1 });
  });

  it('业务失败保留投递责任，重试后不重复用户历史', async () => {
    const item = submit();
    mocks.orchestrate.mockRejectedValueOnce(new Error('temporary'));
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)).toMatchObject({ state: 'pending', attempt_count: 1 });
    db.sqliteRun('UPDATE team_inbound_outbox SET available_at_ms = 0');
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)?.state).toBe('delivered');
    const { listSessionMessagesV2 } = await import('../../message/message-v2-adapter.js');
    expect(
      listSessionMessagesV2({ sessionId, userId }).filter((m) => m.role === 'user'),
    ).toHaveLength(1);
  });

  it('取件进程消失后过期租约可恢复，已持久化业务收据不重跑', async () => {
    const item = submit();
    db.sqliteRun(
      "UPDATE team_inbound_outbox SET state='processing', lease_token='crashed', lease_until_ms=1, attempt_count=1, outcome_json=?",
      [JSON.stringify({ triggered: false, reason: 'grill-question' })],
    );
    await delivery.dispatchInboundDeliveries();
    expect(mocks.orchestrate).not.toHaveBeenCalled();
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('忙时等待而非消费，空闲后无需再次提交即可处理', async () => {
    const { upsertSessionRuntimeThread, clearSessionRuntimeThread } =
      await import('../../session/session-runtime-thread-store.js');
    upsertSessionRuntimeThread({ sessionId, userId, clientRequestId: 'live-stream' });
    db.sqliteRun("UPDATE sessions SET state_status='running' WHERE id=?", [sessionId]);
    const item = submit();
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)).toMatchObject({ state: 'pending', attempt_count: 0 });
    clearSessionRuntimeThread({ sessionId, userId });
    db.sqliteRun("UPDATE sessions SET state_status='idle' WHERE id=?", [sessionId]);
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('快重启旧心跳过期后，pending输入不需访问前端即可恢复', async () => {
    const item = submit();
    const { upsertSessionRuntimeThread } =
      await import('../../session/session-runtime-thread-store.js');
    const now = Date.now();
    upsertSessionRuntimeThread({
      sessionId,
      userId,
      clientRequestId: 'crashed-stream',
      heartbeatAtMs: now,
    });
    db.sqliteRun("UPDATE sessions SET state_status='running' WHERE id=?", [sessionId]);
    await delivery.dispatchInboundDeliveries({ nowMs: now });
    expect(read(item.record.id)).toMatchObject({ state: 'pending', attempt_count: 0 });
    await delivery.dispatchInboundDeliveries({ nowMs: now + 21_000 });
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('崩溃遗留running且无活跃线程时，过期投递自动恢复', async () => {
    const item = submit();
    db.sqliteRun("UPDATE sessions SET state_status='running' WHERE id=?", [sessionId]);
    db.sqliteRun(
      "UPDATE team_inbound_outbox SET state='processing', lease_token='crashed', lease_until_ms=1, attempt_count=1",
    );
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('队首16个忙会话不会遮住后方空闲会话', async () => {
    const { upsertSessionRuntimeThread } =
      await import('../../session/session-runtime-thread-store.js');
    for (let i = 0; i < 16; i++) {
      const id = `busy-${i}`;
      seedSession(id, 'running');
      upsertSessionRuntimeThread({ sessionId: id, userId, clientRequestId: `live-${i}` });
      submit(id, id);
    }
    const item = submit();
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('长请求未结束时扫描及时返回，下一会话仍可领取', async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.orchestrate.mockImplementationOnce(async () => {
      await slow;
      return { triggered: false, reason: 'direct-answer' };
    });
    const first = submit();
    try {
      await delivery.dispatchInboundDeliveries({ waitForCompletion: false });
      expect(read(first.record.id)?.state).toBe('processing');
      seedSession('next-idle');
      const next = submit('next-idle', 'next-idle');
      await delivery.dispatchInboundDeliveries();
      expect(read(next.record.id)?.state).toBe('delivered');
      expect(read(first.record.id)?.state).toBe('processing');
    } finally {
      finish();
      await vi.waitFor(() => expect(read(first.record.id)?.state).toBe('delivered'));
    }
  });

  it('租约超时达到上限后显式死信，不无限重投', async () => {
    const item = submit();
    db.sqliteRun(
      "UPDATE team_inbound_outbox SET state='processing', lease_token='crashed', lease_until_ms=1, attempt_count=5",
    );
    await delivery.dispatchInboundDeliveries();
    expect(mocks.orchestrate).not.toHaveBeenCalled();
    expect(read(item.record.id)?.state).toBe('dead');
  });

  it('取消信号待处理时不得先运行新的业务输入', async () => {
    const item = submit();
    const { submitInboundMessage } = await import('../../handoff/store/inbound-store.js');
    submitInboundMessage({
      userId,
      toSessionId: sessionId,
      fromRoleLayer: 'user',
      messageType: 'cancel_signal',
      payload: {},
    });
    await delivery.dispatchInboundDeliveries();
    expect(mocks.orchestrate).not.toHaveBeenCalled();
    expect(read(item.record.id)?.state).toBe('pending');
  });

  it('心跳写库异常不逃逸，旧worker不确认已失去的租约', async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.orchestrate.mockImplementationOnce(async () => {
      await slow;
      return { triggered: false, reason: 'direct-answer' };
    });
    const item = submit();
    vi.useFakeTimers();
    try {
      await delivery.dispatchInboundDeliveries({ waitForCompletion: false });
      db.sqliteRun(
        "CREATE TRIGGER reject_delivery_heartbeat BEFORE UPDATE OF lease_until_ms ON team_inbound_outbox BEGIN SELECT RAISE(ABORT, 'heartbeat unavailable'); END",
      );
      await vi.advanceTimersByTimeAsync(20_000);
      expect(read(item.record.id)?.state).toBe('processing');
    } finally {
      db.sqliteRun('DROP TRIGGER IF EXISTS reject_delivery_heartbeat');
      finish();
      await vi.advanceTimersByTimeAsync(0);
      vi.useRealTimers();
    }
    expect(read(item.record.id)?.state).toBe('processing');
    db.sqliteRun('UPDATE team_inbound_outbox SET lease_until_ms = 1');
    await delivery.dispatchInboundDeliveries();
    expect(read(item.record.id)?.state).toBe('delivered');
  });

  it('过期输入不再执行且不能永久遮住下一个输入', async () => {
    const old = submit();
    db.sqliteRun(
      "UPDATE session_inbound_messages SET expires_at='2000-01-01 00:00:00' WHERE id=?",
      [old.record.id],
    );
    const next = submit(sessionId, 'next');
    await delivery.dispatchInboundDeliveries();
    expect(read(old.record.id)?.state).toBe('dead');
    await delivery.dispatchInboundDeliveries();
    expect(read(next.record.id)?.state).toBe('delivered');
  });

  it('关闭时停止新领取并等待已启动worker完成', async () => {
    let finish!: () => void;
    const slow = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.orchestrate.mockImplementationOnce(async () => {
      await slow;
      return { triggered: false, reason: 'direct-answer' };
    });
    const first = submit();
    await delivery.dispatchInboundDeliveries({ waitForCompletion: false });
    let stopped = false;
    const closing = delivery.stopInboundDeliveries().then(() => {
      stopped = true;
    });
    try {
      await Promise.resolve();
      expect(stopped).toBe(false);
      seedSession('after-stop');
      const next = submit('after-stop', 'after-stop');
      await delivery.dispatchInboundDeliveries();
      expect(read(next.record.id)?.state).toBe('pending');
    } finally {
      finish();
      await closing;
    }
    expect(read(first.record.id)?.state).toBe('delivered');
    expect(stopped).toBe(true);
  });
});
