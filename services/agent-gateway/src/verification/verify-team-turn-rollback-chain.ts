/**
 * W1 链式派发回合键验收：pm1 完成 / 失败降级后的 pm1→pm2 handoff 必须携带父回合键。
 *
 * 生产顺序：pm1 handoff 先完成（终态），watcher 随后才执行链式派发——
 * `resolveSessionTurnClientRequestId` 只继承 pending/claimed/running 的父 handoff，
 * 终态父不再成立。因此链式 `createHandoff` 若不显式携带 `input.handoff.clientRequestId`，
 * pm2 及其下游记录会落 NULL，回退用户回合就清不掉它们。这里用真实的
 * `HandoffWatcher.tickOnce()`（注入 taskRunner 复刻 runner 完成 / 抛错）驱动两条链分支，
 * 断言链式 handoff 的 `client_request_id` 等于原始用户回合键。
 */

import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { createHandoff, type HandoffRecord } from '../handoff/store/handoff-store.js';
import { InProcessScheduler } from '../handoff/runner/scheduler.js';
import { HandoffWatcher } from '../handoff/runner/watcher.js';
import { assert, waitFor } from './task-verification-helpers.js';

interface ChainedHandoffRow {
  client_request_id: string | null;
  state: string;
  to_role_layer: string;
}

function seedChainFixture(label: string): { userId: string; receptionSessionId: string } {
  const userId = randomUUID();
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    userId,
    `turn-rollback-chain-${label}-${userId}@openawork.local`,
    'hash',
  ]);
  const receptionSessionId = randomUUID();
  sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, role_layer)
     VALUES (?, ?, '[]', 'idle', '{}', 'reception')`,
    [receptionSessionId, userId],
  );
  return { userId, receptionSessionId };
}

function seedParentPm1Handoff(input: {
  userId: string;
  receptionSessionId: string;
  turnKey: string;
}): HandoffRecord {
  return createHandoff({
    userId: input.userId,
    fromSessionId: input.receptionSessionId,
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    clientRequestId: input.turnKey,
    payload: { sourceIntent: 'chained dispatch fixture' },
  });
}

function readChainedHandoff(idempotencyKey: string): ChainedHandoffRow | undefined {
  return sqliteGet<ChainedHandoffRow>(
    `SELECT client_request_id, state, to_role_layer FROM handoff_records
      WHERE idempotency_key = ? LIMIT 1`,
    [idempotencyKey],
  );
}

function readHandoffState(handoffId: string): string | undefined {
  return sqliteGet<{ state: string }>('SELECT state FROM handoff_records WHERE id = ? LIMIT 1', [
    handoffId,
  ])?.state;
}

function assertChainedTurnKey(input: {
  chained: ChainedHandoffRow | undefined;
  idempotencyKey: string;
  turnKey: string;
}): void {
  assert(
    input.chained !== undefined,
    `chain dispatch must create the pm1→pm2 handoff (idempotencyKey=${input.idempotencyKey})`,
  );
  assert(
    input.chained.to_role_layer === 'pm2',
    `chained handoff must target pm2 (got ${input.chained.to_role_layer})`,
  );
  // 等值断言同时排除 NULL 与内部运行键（handoff: 等）：链式记录必须归到用户回合。
  assert(
    input.chained.client_request_id === input.turnKey,
    `chained pm1→pm2 handoff must carry the original user turn key (expected ${input.turnKey}, got ${String(
      input.chained.client_request_id,
    )})`,
  );
}

/** 正常 auto-chain：runner 完成 pm1 → 父 handoff 终态 → watcher 派发 pm1→pm2。 */
export async function verifyChainedDispatchCarriesTurnKey(): Promise<void> {
  const { userId, receptionSessionId } = seedChainFixture('auto');
  const turnKey = `turn-chain-${randomUUID()}`;
  const parent = seedParentPm1Handoff({ userId, receptionSessionId, turnKey });

  const watcher = new HandoffWatcher({
    scheduler: new InProcessScheduler(),
    // 生产 runner（artifact-chain）不自行 completeHandoff：它写产物 + substate，
    // 由 watcher 兜底 complete（见 pm1-runner 的「让 watcher completeHandoff」注释）。
    // 保持同一顺序：runner 返回 → watcher completeHandoff → 父 handoff 终态 →
    // watcher 链式派发 pm1→pm2。
    taskRunner: async () => {
      await Promise.resolve();
    },
  });

  await watcher.tickOnce();
  const idempotencyKey = `auto-chain:pm1-pm2:${parent.id}`;
  await waitFor(
    () => readChainedHandoff(idempotencyKey) !== undefined,
    `completing pm1 through the watcher must create the chained pm1→pm2 handoff (${idempotencyKey})`,
  );

  assert(
    readHandoffState(parent.id) === 'completed',
    `fixture parent must be terminal before the chain assertion (got ${String(
      readHandoffState(parent.id),
    )})`,
  );
  assertChainedTurnKey({
    chained: readChainedHandoff(idempotencyKey),
    idempotencyKey,
    turnKey,
  });
}

/** 失败降级链：runner 抛错 → 父 handoff failed → 有 spec 产物时降级派发 pm1→pm2。 */
export async function verifyDegradedChainCarriesTurnKey(): Promise<void> {
  const { userId, receptionSessionId } = seedChainFixture('degraded');
  const turnKey = `turn-chain-degraded-${randomUUID()}`;
  const parent = seedParentPm1Handoff({ userId, receptionSessionId, turnKey });

  const watcher = new HandoffWatcher({
    scheduler: new InProcessScheduler(),
    taskRunner: async ({ toSessionId }) => {
      sqliteRun(
        `INSERT INTO artifacts (id, session_id, user_id, type, title, content, phase)
         VALUES (?, ?, ?, 'spec', 'degraded fixture spec', '# spec', 'spec')`,
        [randomUUID(), toSessionId, userId],
      );
      throw new Error('degraded fixture failure');
    },
  });

  await watcher.tickOnce();
  const idempotencyKey = `auto-chain-degraded:pm1-pm2:${parent.id}`;
  await waitFor(
    () => readChainedHandoff(idempotencyKey) !== undefined,
    `failing pm1 with existing artifacts must create the degraded pm1→pm2 handoff (${idempotencyKey})`,
  );

  assert(
    readHandoffState(parent.id) === 'failed',
    `fixture parent must be terminal before the degraded chain assertion (got ${String(
      readHandoffState(parent.id),
    )})`,
  );
  assertChainedTurnKey({
    chained: readChainedHandoff(idempotencyKey),
    idempotencyKey,
    turnKey,
  });
}
