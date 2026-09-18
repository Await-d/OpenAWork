/**
 * 回合键解析契约验收：`resolveSessionTurnClientRequestId` 只认活跃父 handoff。
 *
 * 计划 C9.1/C9.2 —— 新回合的 handoff 还在 pending/claimed（`to_session_id` 尚未写入）时，
 * 终态（completed / failed / cancelled）父 handoff 属于上一回合，绝不能把它的回合键继承
 * 给新回合；否则新回合的用量 / 审计 / 子孙 handoff 会被错误归属，并被旧回合的回退误删。
 */

import { randomUUID } from 'node:crypto';
import { sqliteRun } from '../infra/db.js';
import { resolveSessionTurnClientRequestId } from '../handoff/store/handoff-store.js';
import { assert } from './task-verification-helpers.js';

export function verifyActiveOnlyResolverTurnInheritance(input: {
  userId: string;
  fromSessionId: string;
}): void {
  const { userId, fromSessionId } = input;
  const activeSessionId = randomUUID();
  const terminalOnlySessionId = randomUUID();
  for (const sessionId of [activeSessionId, terminalOnlySessionId]) {
    sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json)
       VALUES (?, ?, '[]', 'idle', '{}')`,
      [sessionId, userId],
    );
  }

  // 活跃父 handoff 先插入；终态父 handoff 后插入并带 2099 的 started_at「毒化」排序，
  // 旧实现（不筛 state）会返回终态回合键，加固后必须仍返回活跃回合键。
  insertParentHandoff({
    userId,
    fromSessionId,
    toSessionId: activeSessionId,
    state: 'running',
    clientRequestId: 'turn-active',
    startedAt: null,
  });
  insertParentHandoff({
    userId,
    fromSessionId,
    toSessionId: activeSessionId,
    state: 'completed',
    clientRequestId: 'turn-terminal',
    startedAt: '2099-01-01 00:00:00',
  });
  assert(
    resolveSessionTurnClientRequestId(activeSessionId) === 'turn-active',
    `active parent handoff must win over a newer terminal one (expected turn-active, got ${String(
      resolveSessionTurnClientRequestId(activeSessionId),
    )})`,
  );

  insertParentHandoff({
    userId,
    fromSessionId,
    toSessionId: terminalOnlySessionId,
    state: 'completed',
    clientRequestId: 'turn-terminal-only',
    startedAt: '2099-01-01 00:00:00',
  });
  assert(
    resolveSessionTurnClientRequestId(terminalOnlySessionId) === null,
    `terminal-only parent handoff must not be inherited (got ${String(
      resolveSessionTurnClientRequestId(terminalOnlySessionId),
    )})`,
  );
}

/**
 * H4：会话自身回合键的严格优先序验收。
 *   1. 非内部命名空间的显式键（用户直发子会话的回合键）→ 优先于活跃父 handoff 继承；
 *   2. handoff 内部运行键（`handoff:` / `pm1:` / `pm2:`）→ 不当作回合键，继续继承；
 *   3. 无活跃父 handoff 时，显式键（含内部键）仍是该会话自己的请求键兜底。
 */
export function verifyTurnKeyOwnershipPrecedence(input: { userId: string }): void {
  const fromSessionId = randomUUID();
  const childSessionId = randomUUID();
  for (const sessionId of [fromSessionId, childSessionId]) {
    sqliteRun(
      `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json)
       VALUES (?, ?, '[]', 'idle', '{}')`,
      [sessionId, input.userId],
    );
  }
  insertParentHandoff({
    userId: input.userId,
    fromSessionId,
    toSessionId: childSessionId,
    state: 'running',
    clientRequestId: 'turn-parent-active',
    startedAt: null,
  });

  assert(
    resolveSessionTurnClientRequestId(childSessionId, 'turn-direct-send') === 'turn-direct-send',
    `direct-send turn key must win over the active parent handoff (got ${String(
      resolveSessionTurnClientRequestId(childSessionId, 'turn-direct-send'),
    )})`,
  );
  assert(
    resolveSessionTurnClientRequestId(childSessionId, '  turn-direct-trimmed  ') ===
      'turn-direct-trimmed',
    'direct-send turn key must be trimmed before use',
  );
  for (const internalKey of ['handoff:abc', 'handoff:abc:r2', 'pm1:abc:step', 'pm2:abc:1']) {
    assert(
      resolveSessionTurnClientRequestId(childSessionId, internalKey) === 'turn-parent-active',
      `internal run key ${internalKey} must keep inheriting the active parent turn (got ${String(
        resolveSessionTurnClientRequestId(childSessionId, internalKey),
      )})`,
    );
  }
  assert(
    resolveSessionTurnClientRequestId(childSessionId) === 'turn-parent-active' &&
      resolveSessionTurnClientRequestId(childSessionId, '   ') === 'turn-parent-active',
    'missing / blank own key must keep inheriting the active parent turn',
  );

  const orphanSessionId = randomUUID();
  sqliteRun(
    `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json)
     VALUES (?, ?, '[]', 'idle', '{}')`,
    [orphanSessionId, input.userId],
  );
  assert(
    resolveSessionTurnClientRequestId(orphanSessionId, 'turn-orphan-direct') ===
      'turn-orphan-direct' &&
      resolveSessionTurnClientRequestId(orphanSessionId, 'handoff:orphan') === 'handoff:orphan' &&
      resolveSessionTurnClientRequestId(orphanSessionId) === null,
    'without an active parent handoff the own key is the last-resort turn key, otherwise null',
  );
}

function insertParentHandoff(input: {
  userId: string;
  fromSessionId: string;
  toSessionId: string;
  state: string;
  clientRequestId: string;
  startedAt: string | null;
}): void {
  sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, state, client_request_id, started_at)
     VALUES (?, ?, ?, 'reception', 'pm1', ?, ?, ?, COALESCE(?, datetime('now')))`,
    [
      randomUUID(),
      input.userId,
      input.fromSessionId,
      input.toSessionId,
      input.state,
      input.clientRequestId,
      input.startedAt,
    ],
  );
}
