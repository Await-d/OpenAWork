/**
 * 子进程 fixture：`verify-team-inbound-cross-process-crash.ts` 的崩落实体。
 *
 * 单独进程运行，通过 `DATABASE_URL` 指向与父进程共享的**文件数据库**，
 * 因此「进程真的死了、数据真的留在磁盘上」是真实发生的，而不是同进程内的状态模拟。
 *
 * 模式（argv[2]）：
 *   - `submit-pending`：提交后正常关闭数据库并退出，验证另一进程能读取待投递责任。
 *   - `submit-while-streaming`：人工写入 running 与心跳，提交后挂起等待 SIGKILL。
 *     这是残留状态恢复用例，没有实际运行 stream、业务 worker 或持有消费租约。
 *   - `recover`：以给定时间偏移运行投递扫描，断言目标输入已被投递，打印结果。
 *
 * 只走生产 seam（submitInboundWithHistory / dispatchInboundDeliveries），不 mock。
 */

import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import { SESSION_RUNTIME_THREAD_STALE_AFTER_MS } from '../session/session-runtime-thread-store.js';
import { submitInboundWithHistory } from '../handoff/store/inbound-delivery.js';
import {
  ackInboundMessage,
  consumePendingInboundMessage,
  submitInboundMessage,
} from '../handoff/store/inbound-store.js';
import {
  dispatchInboundDeliveries,
  stopInboundDeliveries,
} from '../handoff/workflow/inbound-delivery-dispatcher.js';

const USER_ID = 'u-xproc-crash';
/** 确定性澄清路径：不调用模型即可完成投递，适合崩溃恢复验收。 */
const INTENT = '重构整个系统架构';
/**
 * 消费租约测试用的租期。
 *
 * 不能取太小：「有效期内不可抢」那条探测是**真实启动一个新进程**去抢的（bun 启动 + migrate
 * 约 0.5–1s），租期只有 3s 时，负载高或 CI 机器上会合法过期，导致探测抢到而误报失败。
 * 过期路径用的是模拟时间（`Date.now() + LEASE_MS + 1_000`），所以调大租期不会增加等待。
 */
const LEASE_MS = 15_000;

function seedUserAndSession(sessionId: string, stateStatus: string, roleLayer = 'reception'): void {
  sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'xproc-crash@example.test',
  ]);
  sqliteRun(
    `INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
     VALUES (?, ?, ?, '{}', ?, ?)`,
    [sessionId, USER_ID, roleLayer, roleLayer, stateStatus],
  );
}

/**
 * 把用户 provider 指向假上游。
 *
 * 真实 stream 走 agent-core 的 provider 解析，读的是 `user_settings`
 * （key = `providers` / `active_selection`），**不读 `AI_API_*` 环境变量**；
 * 只设环境变量时请求根本到不了假上游（实测假上游 0 命中）。
 */
function seedProviderTo(baseUrl: string): void {
  const providerId = 'fixture-upstream';
  const nowIso = new Date().toISOString();
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)`,
    [
      USER_ID,
      JSON.stringify([
        {
          apiKey: 'fixture-key',
          baseUrl,
          createdAt: nowIso,
          defaultModels: [{ enabled: true, id: 'fixture-model', label: 'fixture-model' }],
          enabled: true,
          id: providerId,
          name: 'fixture upstream',
          type: 'custom',
          updatedAt: nowIso,
          upstreamProtocol: 'chat_completions',
        },
      ]),
    ],
  );
  sqliteRun(
    `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)`,
    [
      USER_ID,
      JSON.stringify({
        chat: { modelId: 'fixture-model', providerId },
        fast: { modelId: 'fixture-model', providerId },
      }),
    ],
  );
}

function submit(sessionId: string, key: string, intent = INTENT): string {
  const result = submitInboundWithHistory({
    clientIdempotencyKey: key,
    fromRoleLayer: 'user',
    messageType: 'user_input',
    payload: { text: intent },
    requestId: key,
    roleLayer: 'reception',
    toSessionId: sessionId,
    userId: USER_ID,
  });
  return result.record.id;
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? '';
  const sessionId = process.argv[3] ?? '';
  const key = process.argv[4] ?? '';

  await connectDb();
  await migrate();

  if (mode === 'submit-pending') {
    seedUserAndSession(sessionId, 'idle');
    const inboundId = submit(sessionId, key);
    console.log(`FIXTURE_SUBMITTED ${inboundId}`);
    // 刻意不 dispatch：模拟「入库后、编排前」进程消失。
    await closeDb();
    return;
  }

  if (mode === 'submit-while-streaming') {
    seedUserAndSession(sessionId, 'running');
    // 真实流式执行会写这条运行线程心跳；这里复现同一状态（新鲜心跳 = 看起来还活着）。
    const now = Date.now();
    sqliteRun(
      `INSERT OR REPLACE INTO session_runtime_threads
         (session_id, user_id, client_request_id, started_at_ms, heartbeat_at_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [sessionId, USER_ID, key, now, now],
    );
    const inboundId = submit(sessionId, key);
    console.log(`FIXTURE_SUBMITTED ${inboundId}`);
    // 必须用**真实的活跃句柄**保持进程存活：裸 pending Promise 不会阻止事件循环退出，
    // 进程会自己以 code 0 结束，SIGKILL 就变成竞态（曾导致本验收脚本两次运行结果不一致）。
    setInterval(() => undefined, 1_000);
    await new Promise<never>(() => undefined);
    return;
  }

  if (mode === 'recover') {
    const offsetMs =
      process.argv[5] === 'stale'
        ? SESSION_RUNTIME_THREAD_STALE_AFTER_MS + 1_000
        : Number(process.argv[5] ?? '0');
    await dispatchInboundDeliveries({ nowMs: Date.now() + offsetMs, waitForCompletion: true });
    const row = sqliteGet<{ state: string; attempt_count: number; last_error: string | null }>(
      `SELECT o.state, o.attempt_count, o.last_error
         FROM team_inbound_outbox o JOIN session_inbound_messages i ON i.id = o.inbound_id
        WHERE i.user_id = ? AND i.to_session_id = ? LIMIT 1`,
      [USER_ID, sessionId],
    );
    console.log(`FIXTURE_STATE ${row?.state ?? 'missing'} attempt=${row?.attempt_count ?? -1}`);
    await stopInboundDeliveries();
    await closeDb();
    if (row?.state !== 'delivered') process.exitCode = 1;
    return;
  }

  if (mode === 'claim-lease-and-hang') {
    // 非接待层会话：业务入站走**消费租约**（不是投递 outbox），
    // 领取后由一个真实进程持有租约，随后被父进程 SIGKILL。
    seedUserAndSession(sessionId, 'idle', 'pm1');
    submitInboundMessage({
      fromRoleLayer: 'reception',
      messageType: 'clarification_answer',
      payload: { answeredAt: Date.now(), answer: '先做最小可用版本', questionId: key },
      toSessionId: sessionId,
      userId: USER_ID,
    });
    const claimed = consumePendingInboundMessage({
      leaseMs: LEASE_MS,
      loopIteration: 1,
      toSessionId: sessionId,
    });
    if (!claimed?.leaseToken) {
      throw new Error('未取得消费租约，无法验证持有者崩溃后的重投');
    }
    console.log(`FIXTURE_LEASE ${claimed.id} ${claimed.leaseToken} ${claimed.attemptCount}`);
    setInterval(() => undefined, 1_000);
    await new Promise<never>(() => undefined);
    return;
  }

  if (mode === 'recover-lease') {
    const messageId = process.argv[5] ?? '';
    const staleToken = process.argv[6] ?? '';
    const phase = process.argv[7] ?? '';

    if (phase === 'before-expiry') {
      // 租约仍有效：任何人都不该抢走这条消息。
      const stolen = consumePendingInboundMessage({ loopIteration: 2, toSessionId: sessionId });
      console.log(`FIXTURE_LEASE_PROBE stolen=${stolen?.id ?? 'none'}`);
      await closeDb();
      if (stolen) process.exitCode = 1;
      return;
    }

    // 租约过期后：真实重投，并且崩溃进程的旧令牌必须失效。
    const nowMs = Date.now() + LEASE_MS + 1_000;
    const reclaimed = consumePendingInboundMessage({
      leaseMs: LEASE_MS,
      loopIteration: 3,
      nowMs,
      toSessionId: sessionId,
    });
    const staleAck = ackInboundMessage({ leaseToken: staleToken, messageId });
    const freshAck = reclaimed?.leaseToken
      ? ackInboundMessage({ leaseToken: reclaimed.leaseToken, messageId, nowMs })
      : false;
    console.log(
      `FIXTURE_LEASE_RECLAIMED ${reclaimed?.id ?? 'none'} attempt=${reclaimed?.attemptCount ?? -1} staleAck=${staleAck} freshAck=${freshAck}`,
    );
    await closeDb();
    if (reclaimed?.id !== messageId || staleAck || !freshAck) process.exitCode = 1;
    return;
  }

  if (mode === 'deliver-and-hang') {
    // 真实投递 + 真实流式执行：调度器先同步领取（持投递租约），worker 随后进入
    // 真实 stream 调用；上游由父进程提供的假服务挂住，父进程确认「请求已到达上游」
    // 后再 SIGKILL —— 这才是「真实执行中被杀」，不是人工构造状态。
    seedUserAndSession(sessionId, 'idle');
    submit(sessionId, key);
    await dispatchInboundDeliveries({ waitForCompletion: false });
    const row = sqliteGet<{ state: string; attempt_count: number }>(
      `SELECT o.state, o.attempt_count FROM team_inbound_outbox o
         JOIN session_inbound_messages i ON i.id = o.inbound_id
        WHERE i.user_id = ? AND i.to_session_id = ? LIMIT 1`,
      [USER_ID, sessionId],
    );
    console.log(
      `FIXTURE_DELIVERING ${row?.state ?? 'missing'} attempt=${row?.attempt_count ?? -1}`,
    );
    setInterval(() => undefined, 1_000);
    await new Promise<never>(() => undefined);
    return;
  }

  if (mode === 'stream-to-upstream-and-hang') {
    // 真实流式执行 + **模型请求确实在途**：把用户 provider 指向假上游
    // （只接受连接、永不响应），于是子进程会真的卡在模型请求里，
    // 直到父进程确认「上游已收到连接」后 SIGKILL。
    // 注意：真实 stream 的 provider 来自 `user_settings`，**不是** AI_API_* 环境变量，
    // 所以必须写库才能让请求真的打到假上游。
    const upstreamBaseUrl = process.argv[5] ?? '';
    if (!upstreamBaseUrl) throw new Error('缺少假上游 baseUrl');
    seedProviderTo(upstreamBaseUrl);
    seedUserAndSession(sessionId, 'idle');
    // 必须用会走**直答**的意图：默认的 INTENT 走澄清拷问（确定性、不调用模型），
    // 那样根本不会发起流式请求，假上游也就收不到连接（实测卡到超时）。
    submit(sessionId, key, '解释一下这个模块是怎么工作的');
    await dispatchInboundDeliveries({ waitForCompletion: false });
    console.log('FIXTURE_STREAMING_REQUEST');
    setInterval(() => undefined, 1_000);
    await new Promise<never>(() => undefined);
    return;
  }

  if (mode === 'recover-delivery-lease') {
    // 崩溃进程留下的投递租约：等它过期再重新投递，断言责任没有被搁置。
    const before = sqliteGet<{
      state: string;
      attempt_count: number;
      lease_until_ms: number | null;
    }>(
      `SELECT o.state, o.attempt_count, o.lease_until_ms FROM team_inbound_outbox o
         JOIN session_inbound_messages i ON i.id = o.inbound_id
        WHERE i.user_id = ? AND i.to_session_id = ? LIMIT 1`,
      [USER_ID, sessionId],
    );
    console.log(
      `FIXTURE_BEFORE state=${before?.state ?? 'missing'} attempt=${before?.attempt_count ?? -1}`,
    );
    await dispatchInboundDeliveries({
      nowMs: (before?.lease_until_ms ?? Date.now()) + 1_000,
      waitForCompletion: true,
    });
    const after = sqliteGet<{ state: string; attempt_count: number }>(
      `SELECT o.state, o.attempt_count FROM team_inbound_outbox o
         JOIN session_inbound_messages i ON i.id = o.inbound_id
        WHERE i.user_id = ? AND i.to_session_id = ? LIMIT 1`,
      [USER_ID, sessionId],
    );
    console.log(
      `FIXTURE_AFTER state=${after?.state ?? 'missing'} attempt=${after?.attempt_count ?? -1}`,
    );
    await stopInboundDeliveries();
    await closeDb();
    if ((after?.attempt_count ?? 0) <= (before?.attempt_count ?? 0)) process.exitCode = 1;
    return;
  }

  throw new Error(`未知 fixture 模式：${mode}`);
}

void main().catch((error) => {
  console.error('fixture failed');
  console.error(error);
  process.exitCode = 1;
});
