/**
 * verify-team-inbound-fault-injection — T-19 故障注入验收脚本。
 *
 * 覆盖三个「崩溃点」的恢复语义（真实 DB + 源码导入，走生产 seam）：
 *
 *   ① inbound 入库后、编排前崩溃：`team_inbound_outbox` 已留投递责任，
 *      下一次启动扫描必须**领取并完成**它，而不是静默搁置
 *      （历史 bug：pending 永远 pending、attempt_count 保持 0）。
 *   ② 子代理运行中崩溃：心跳过期的 handoff 被回收后必须是「重试」或
 *      「显式失败」，**绝不能**被标成 completed（即不能把中断当成功）。
 *   ③ 取件后崩溃：`processing` + 过期租约的投递必须可被重投并完成；
 *      超过尝试上限时转为**可见死信**，并且只提示一次。
 *
 * 幂等判据（计划 T-19）：本脚本连续两次运行结果一致。所有断言只依赖确定性
 * 状态转移；每个场景末尾都会再跑一次恢复扫描，断言终态行不会被二次处理。
 *
 * 为了让脚本**不依赖真实模型**且可重复：
 *   - 场景①/③ 用「重构整个系统架构」这类确定性澄清（grill）输入，投递会真的完成；
 *   - 场景③ 的死信用「实现订单接口」这类编排输入，在无辅助模型配置时确定性失败
 *     （`no-llm-config`），因此能稳定走到重试上限。
 *   两者都在毫秒级完成，不发起真实上游调用。
 *
 * 覆盖边界（不要在报告里当成已验证）：
 *   - 这里是**状态级**故障注入（构造崩溃后遗留的 DB 状态），不是真实 kill 进程；
 *     真实跨进程 kill/restart 仍属 T-19 的剩余验收项。
 *   - 断言针对「投递责任 + 可见收口」，不是端到端模型成功（后者属 T-20）。
 */

import { closeDb, connectDb, migrate, sqliteGet, sqliteRun } from '../infra/db.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { submitInboundWithHistory } from '../handoff/store/inbound-delivery.js';
import {
  dispatchInboundDeliveries,
  stopInboundDeliveries,
} from '../handoff/workflow/inbound-delivery-dispatcher.js';
import {
  claimHandoff,
  createHandoff,
  getHandoffById,
  reclaimAbandonedHandoffs,
  startHandoff,
} from '../handoff/store/handoff-store.js';

const USER_ID = 'u-fault-injection';
/** 每个场景用独立接待会话：投递按会话 FIFO，共用会话会互相遮挡。 */
const GRILL_SESSION_ID = 's-fault-grill';
const LEASE_SESSION_ID = 's-fault-lease';
const DEAD_SESSION_ID = 's-fault-dead';
const EXECUTOR_SESSION_ID = 's-fault-executor';

const GRILL_INTENT = '重构整个系统架构';
const NO_LLM_INTENT = '实现订单接口';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`故障注入断言失败：${message}`);
}

function seed(): void {
  sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  sqliteRun('DELETE FROM sessions WHERE user_id = ?', [USER_ID]);
  sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'fault-injection@example.test',
  ]);
  for (const [sessionId, roleLayer] of [
    [GRILL_SESSION_ID, 'reception'],
    [LEASE_SESSION_ID, 'reception'],
    [DEAD_SESSION_ID, 'reception'],
    [EXECUTOR_SESSION_ID, 'executor'],
  ] as const) {
    sqliteRun(
      `INSERT INTO sessions (id, user_id, title, metadata_json, role_layer, state_status)
       VALUES (?, ?, ?, '{}', ?, 'idle')`,
      [sessionId, USER_ID, roleLayer, roleLayer],
    );
  }
}

interface OutboxRow {
  state: string;
  attempt_count: number;
  last_error: string | null;
}

function readOutbox(inboundId: string): OutboxRow | undefined {
  return sqliteGet<OutboxRow>(
    `SELECT state, attempt_count, last_error FROM team_inbound_outbox WHERE inbound_id = ?`,
    [inboundId],
  );
}

function textMessages(sessionId: string, role: 'user' | 'assistant'): string[] {
  return listSessionMessagesV2({ sessionId, userId: USER_ID })
    .filter((message) => message.role === role)
    .flatMap((message) =>
      message.content
        .filter((content): content is { type: 'text'; text: string } => content.type === 'text')
        .map((content) => content.text),
    );
}

function submit(sessionId: string, text: string, key: string) {
  return submitInboundWithHistory({
    clientIdempotencyKey: key,
    fromRoleLayer: 'user',
    messageType: 'user_input',
    payload: { text },
    requestId: key,
    roleLayer: 'reception',
    toSessionId: sessionId,
    userId: USER_ID,
  });
}

/** ① 入库后、编排前崩溃 → 重启扫描必须领取并完成，不能静默搁置。 */
async function scenarioInboundBeforeOrchestration(): Promise<void> {
  const item = submit(GRILL_SESSION_ID, GRILL_INTENT, 'fault-1');
  assert(
    readOutbox(item.record.id)?.state === 'pending',
    '入库后未投递前必须保留 pending 投递责任',
  );

  // 崩溃模拟：入库后没有任何 dispatch 就「重启」。重启后的第一次扫描：
  await dispatchInboundDeliveries({ waitForCompletion: true });
  const afterRestart = readOutbox(item.record.id);
  assert(afterRestart?.state === 'delivered', `重启扫描应完成该投递，实际 ${afterRestart?.state}`);
  assert(
    afterRestart.attempt_count === 1,
    `领取应恰好记录一次尝试，实际 ${afterRestart.attempt_count}`,
  );

  // 幂等：再次扫描不得重复执行已完成的投递，也不得重复写用户历史。
  const userMessagesBefore = textMessages(GRILL_SESSION_ID, 'user').length;
  await dispatchInboundDeliveries({ waitForCompletion: true });
  assert(
    readOutbox(item.record.id)?.state === 'delivered' &&
      readOutbox(item.record.id)?.attempt_count === 1,
    '已投递的输入不应在后续扫描中重复领取或改写状态',
  );
  assert(
    textMessages(GRILL_SESSION_ID, 'user').length === userMessagesBefore,
    '重复扫描不得重复写入用户历史',
  );
}

/** ② 子代理运行中崩溃 → 回收后必须是重试或显式失败，绝不能是 completed。 */
async function scenarioSubAgentInterrupted(): Promise<void> {
  const handoff = createHandoff({
    fromRoleLayer: 'pm2',
    fromSessionId: GRILL_SESSION_ID,
    toRoleLayer: 'executor',
    userId: USER_ID,
  });
  const token = 'fault-crash-token';
  assert(claimHandoff({ claimToken: token, handoffId: handoff.id }) !== null, 'handoff 应能领取');
  assert(
    startHandoff({ handoffId: handoff.id, claimToken: token, toSessionId: EXECUTOR_SESSION_ID }),
    'handoff 应能进入 running',
  );
  // 崩溃模拟：执行中的子会话心跳停止（早于回收阈值）。
  sqliteRun(`UPDATE sessions SET last_heartbeat = datetime('now', '-10 minutes') WHERE id = ?`, [
    EXECUTOR_SESSION_ID,
  ]);

  const staleBeforeIso = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').slice(0, 19);
  const first = reclaimAbandonedHandoffs({ maxRetry: 3, staleHeartbeatBeforeIso: staleBeforeIso });
  const afterReclaim = getHandoffById(handoff.id);
  assert(afterReclaim !== undefined, '回收后 handoff 仍应存在');
  assert(afterReclaim.state !== 'completed', '中断的运行不能被当作完成');
  assert(
    afterReclaim.state === 'pending' || afterReclaim.state === 'failed',
    `中断的运行应收敛为重试或失败，实际 ${afterReclaim.state}`,
  );
  assert(
    first.reclaimedIds.includes(handoff.id) || first.failedIds.includes(handoff.id),
    '回收结果必须显式记录该 handoff',
  );

  // 幂等：再次回收不得重复处理已离开 running/claimed 的行。
  const second = reclaimAbandonedHandoffs({ maxRetry: 3, staleHeartbeatBeforeIso: staleBeforeIso });
  assert(
    !second.reclaimedIds.includes(handoff.id) && !second.failedIds.includes(handoff.id),
    '已收敛的 handoff 不应被第二次回收重复处理',
  );

  // 超过重试上限时显式失败并留下可读原因（供上层通知用户是中断而非完成）。
  const exhausted = createHandoff({
    fromRoleLayer: 'pm2',
    fromSessionId: GRILL_SESSION_ID,
    toRoleLayer: 'executor',
    userId: USER_ID,
  });
  const exhaustedToken = 'fault-crash-token-2';
  claimHandoff({ claimToken: exhaustedToken, handoffId: exhausted.id });
  startHandoff({
    claimToken: exhaustedToken,
    handoffId: exhausted.id,
    toSessionId: EXECUTOR_SESSION_ID,
  });
  sqliteRun('UPDATE handoff_records SET retry_count = 5 WHERE id = ?', [exhausted.id]);
  reclaimAbandonedHandoffs({ maxRetry: 3, staleHeartbeatBeforeIso: staleBeforeIso });
  const failed = getHandoffById(exhausted.id);
  assert(failed?.state === 'failed', `超次中断应显式失败，实际 ${failed?.state}`);
  assert(
    (failed?.failureReason ?? '').length > 0,
    '显式失败必须留下原因，否则无法向用户说明是中断而非完成',
  );
}

/** ③ 取件后崩溃 → 过期租约可重投完成；超上限只提示一次。 */
async function scenarioLeaseExpiryAfterClaim(): Promise<void> {
  // ③a 租约过期后重投应成功完成（证明崩溃不会丢掉这条输入）。
  const recoverable = submit(LEASE_SESSION_ID, GRILL_INTENT, 'fault-3a');
  sqliteRun(
    `UPDATE team_inbound_outbox
        SET state = 'processing', lease_token = 'crashed-worker', lease_until_ms = 1, attempt_count = 1
      WHERE inbound_id = ?`,
    [recoverable.record.id],
  );
  await dispatchInboundDeliveries({ waitForCompletion: true });
  const recovered = readOutbox(recoverable.record.id);
  assert(
    recovered?.state === 'delivered',
    `过期租约应可被重新领取并完成，实际 ${recovered?.state}`,
  );
  assert(
    (recovered.attempt_count ?? 0) >= 2,
    `重投必须累加尝试次数，实际 ${recovered?.attempt_count}`,
  );

  // ③b 已接近上限的崩溃投递应收口为可见死信。
  const doomed = submit(DEAD_SESSION_ID, NO_LLM_INTENT, 'fault-3b');
  sqliteRun(
    `UPDATE team_inbound_outbox
        SET state = 'processing', lease_token = 'crashed-worker-2', lease_until_ms = 1, attempt_count = 4
      WHERE inbound_id = ?`,
    [doomed.record.id],
  );
  await dispatchInboundDeliveries({ waitForCompletion: true });
  const dead = readOutbox(doomed.record.id);
  assert(dead?.state === 'dead', `超过尝试上限的崩溃投递应收口为 dead，实际 ${dead?.state}`);
  assert((dead.last_error ?? '').length > 0, '死信必须留下失败原因，便于用户判断是否重试');

  const noticesAfterFirst = textMessages(DEAD_SESSION_ID, 'assistant').filter((text) =>
    text.includes('多次投递'),
  ).length;
  assert(noticesAfterFirst > 0, '进入死信必须给用户可见的停止重试提示');

  // 幂等：终态行不得再次进入收口，不能重复告警。
  await dispatchInboundDeliveries({ waitForCompletion: true });
  const noticesAfterSecond = textMessages(DEAD_SESSION_ID, 'assistant').filter((text) =>
    text.includes('多次投递'),
  ).length;
  assert(noticesAfterSecond === noticesAfterFirst, '已收口的死信不应在后续扫描中重复提示');
}

async function main(): Promise<void> {
  await connectDb();
  await migrate();
  try {
    seed();

    await scenarioInboundBeforeOrchestration();
    await scenarioSubAgentInterrupted();
    await scenarioLeaseExpiryAfterClaim();

    console.log('verify-team-inbound-fault-injection: ok');
  } finally {
    await stopInboundDeliveries();
    await closeDb();
  }
}

void main().catch((error) => {
  console.error('verify-team-inbound-fault-injection: failed');
  console.error(error);
  process.exitCode = 1;
});
