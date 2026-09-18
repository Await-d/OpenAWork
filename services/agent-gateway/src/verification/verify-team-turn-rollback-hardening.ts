/**
 * 回合回退加固项验收（审查 H1 / H2 / H4-publisher）——独立夹具与断言。
 *
 * 从主验收脚本抽出：加固场景各自建用户 / 会话 / 数据，避免污染主脚本的行数期望表，
 * 也让主脚本保持在 1500 行以内（沿用 verify-team-turn-rollback-resolver.ts 的拆分惯例）。
 *
 * 覆盖：
 *   - H1：六个按回合删除 helper 必须按 user_id 收口——另一用户的会话即使拿到相同的
 *     session_id + clientRequestId 调用，也不得删除任何行；
 *   - H2：受影响子树超过 TEAM_RUNTIME_CONTROL_SESSION_LIMIT 时抛结构化错误，
 *     且不发生任何部分删除；
 *   - H4：用户直发团队子会话时，发布器必须用该消息自己的回合键（而非继承活跃父
 *     handoff 的旧回合键），并保证回退这条消息能清掉该回合的团队记录。
 */

import { randomUUID } from 'node:crypto';
import { sqliteGet, sqliteRun } from '../infra/db.js';
import { appendSessionMessageV2 } from '../message/message-v2-adapter.js';
import {
  claimHandoff,
  createHandoff,
  deleteHandoffsByClientRequest,
  resolveSessionTurnClientRequestId,
  startHandoff,
} from '../handoff/store/handoff-store.js';
import { deleteTeamAuditLogsByClientRequest } from '../team/team-audit-store.js';
import {
  deleteTeamToolCallRecordsByClientRequest,
  deleteTeamUsageRecordsByClientRequest,
} from '../team/team-usage-records-store.js';
import {
  deleteTeamConvergeResultsByClientRequest,
  recordConvergeResult,
  type ConvergeResult,
} from '../team/team-converge.js';
import {
  appendTeamMessage,
  deleteTeamMessagesByClientRequest,
} from '../team/team-message-store.js';
import { publishTeamUsageEvent } from '../routes/stream-team-events.js';
import {
  RollbackScopeLimitExceededError,
  rollbackSessionTurn,
} from '../session/session-turn-rollback.js';
import { TEAM_RUNTIME_CONTROL_SESSION_LIMIT } from '../team/team-runtime-control-store.js';
import { assert } from './task-verification-helpers.js';

function createUser(label: string): string {
  const userId = randomUUID();
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    userId,
    `turn-rollback-${label}-${userId}@openawork.local`,
    'hash',
  ]);
  return userId;
}

function createSession(input: {
  userId: string;
  roleLayer?: string;
  teamParentSessionId?: string;
}): string {
  const sessionId = randomUUID();
  sqliteRun(
    `INSERT INTO sessions
       (id, user_id, messages_json, state_status, metadata_json, role_layer, team_parent_session_id)
     VALUES (?, ?, '[]', 'idle', '{}', ?, ?)`,
    [sessionId, input.userId, input.roleLayer ?? null, input.teamParentSessionId ?? null],
  );
  return sessionId;
}

function countTurnRows(table: string, sessionId: string, clientRequestId: string): number {
  // handoff_records 无 session_id 列，归属判定与删除 helper 一致：from/to 任一命中。
  const sessionClause =
    table === 'handoff_records'
      ? { sql: '(from_session_id = ? OR to_session_id = ?)', params: [sessionId, sessionId] }
      : { sql: 'session_id = ?', params: [sessionId] };
  return Number(
    sqliteGet<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${table} WHERE ${sessionClause.sql} AND client_request_id = ?`,
      [...sessionClause.params, clientRequestId],
    )?.count ?? 0,
  );
}

function seedTurnRows(input: { userId: string; sessionId: string; clientRequestId: string }): void {
  const { userId, sessionId, clientRequestId } = input;
  sqliteRun(
    `INSERT INTO handoff_records
       (id, user_id, from_session_id, from_role_layer, to_role_layer, state, client_request_id)
     VALUES (?, ?, ?, 'reception', 'pm1', 'running', ?)`,
    [randomUUID(), userId, sessionId, clientRequestId],
  );
  sqliteRun(
    `INSERT INTO team_messages (id, user_id, session_id, content, type, client_request_id)
     VALUES (?, ?, ?, 'scoped team message', 'update', ?)`,
    [randomUUID(), userId, sessionId, clientRequestId],
  );
  sqliteRun(
    `INSERT INTO team_audit_logs
       (user_id, action, entity_type, entity_id, summary, session_id, client_request_id)
     VALUES (?, 'route_decision', 'session', ?, 'scoped audit', ?, ?)`,
    [userId, randomUUID(), sessionId, clientRequestId],
  );
  sqliteRun(
    `INSERT INTO team_usage_records
       (user_id, session_id, layer, provider, model, client_request_id, input_tokens, output_tokens)
     VALUES (?, ?, 'executor', 'openai', 'gpt-scope', ?, 1, 2)`,
    [userId, sessionId, clientRequestId],
  );
  sqliteRun(
    `INSERT INTO team_tool_call_records
       (user_id, session_id, layer, tool_name, duration_ms, success, client_request_id)
     VALUES (?, ?, 'executor', 'write', 5, 1, ?)`,
    [userId, sessionId, clientRequestId],
  );
  sqliteRun(
    `INSERT INTO team_converge_results
       (id, team_workspace_id, session_id, result_json, client_request_id)
     VALUES (?, ?, ?, '{}', ?)`,
    [randomUUID(), randomUUID(), sessionId, clientRequestId],
  );
}

const SCOPED_TABLES = [
  'handoff_records',
  'team_messages',
  'team_audit_logs',
  'team_usage_records',
  'team_tool_call_records',
  'team_converge_results',
] as const;

/** H1：六个删除 helper 都必须按 userId 收口。 */
export function verifyDeleteHelpersAreUserScoped(): void {
  const actingUserId = createUser('scope-acting');
  const foreignUserId = createUser('scope-foreign');
  const foreignSessionId = createSession({ userId: foreignUserId });
  const foreignTurnId = `turn-foreign-${randomUUID()}`;
  seedTurnRows({
    userId: foreignUserId,
    sessionId: foreignSessionId,
    clientRequestId: foreignTurnId,
  });

  const wrongUserScope = {
    userId: actingUserId,
    sessionIds: [foreignSessionId],
    clientRequestIds: [foreignTurnId],
  };
  assert(
    deleteHandoffsByClientRequest(wrongUserScope) === 0 &&
      deleteTeamMessagesByClientRequest(wrongUserScope) === 0 &&
      deleteTeamAuditLogsByClientRequest(wrongUserScope) === 0 &&
      deleteTeamUsageRecordsByClientRequest(wrongUserScope) === 0 &&
      deleteTeamToolCallRecordsByClientRequest(wrongUserScope) === 0 &&
      deleteTeamConvergeResultsByClientRequest(wrongUserScope) === 0,
    'delete helpers must delete 0 rows when invoked with another user id',
  );
  for (const table of SCOPED_TABLES) {
    assert(
      countTurnRows(table, foreignSessionId, foreignTurnId) === 1,
      `another user's row must survive a cross-user delete attempt (table=${table})`,
    );
  }

  const ownerScope = {
    userId: foreignUserId,
    sessionIds: [foreignSessionId],
    clientRequestIds: [foreignTurnId],
  };
  assert(
    deleteHandoffsByClientRequest(ownerScope) === 1 &&
      deleteTeamMessagesByClientRequest(ownerScope) === 1 &&
      deleteTeamAuditLogsByClientRequest(ownerScope) === 1 &&
      deleteTeamUsageRecordsByClientRequest(ownerScope) === 1 &&
      deleteTeamToolCallRecordsByClientRequest(ownerScope) === 1 &&
      deleteTeamConvergeResultsByClientRequest(ownerScope) === 1,
    'delete helpers must delete the owner rows exactly once each',
  );
  for (const table of SCOPED_TABLES) {
    assert(
      countTurnRows(table, foreignSessionId, foreignTurnId) === 0,
      `owner-scoped delete must remove the turn row (table=${table})`,
    );
  }
}

/**
 * W2：turn-less 写入（工作区级团队消息 / 手工 converge）必须原样存活回合回退。
 *
 * 这两类记录的生产写入点（`routes/team-crud.ts` 的 POST /team/messages、
 * `routes/team-phase-a.ts` 的手工 converge）没有聊天回合上下文，落 NULL 回合键 =
 * 「不可归因」；本断言把「按回合删除对它们是无操作」从口头约定变成回归约束：
 * 同会话同一条回退里，带键行必须被删、NULL 行必须原样存活。
 */
export async function verifyTurnLessWritesSurviveRollback(): Promise<void> {
  const userId = createUser('turn-less');
  const sessionId = createSession({ userId, roleLayer: 'reception' });
  const turnKey = `turn-less-${randomUUID()}`;

  const workspaceMessageId = randomUUID();
  appendTeamMessage({
    id: workspaceMessageId,
    userId,
    sessionId,
    content: 'workspace-level team message',
    type: 'update',
  });
  const convergeResult: ConvergeResult = {
    deviations: [],
    evaluatedArtifacts: [],
    timestamp: Date.now(),
    durationMs: 1,
    hasCriticalDeviations: false,
    report: 'manual converge',
  };
  recordConvergeResult(randomUUID(), sessionId, convergeResult);

  const turnMessageId = randomUUID();
  appendTeamMessage({
    id: turnMessageId,
    userId,
    sessionId,
    content: 'turn-derived team message',
    type: 'update',
    clientRequestId: turnKey,
  });
  const userMessage = appendSessionMessageV2({
    sessionId,
    userId,
    role: 'user',
    clientRequestId: turnKey,
    content: [{ type: 'text', text: 'turn-less fixture' }],
  });

  const result = await rollbackSessionTurn({
    sessionId,
    userId,
    messageId: userMessage.id,
    messageText: 'turn-less fixture',
  });
  assert(
    result.rollback.invalidatedClientRequestIds.includes(turnKey),
    `turn-less fixture rollback must invalidate its own turn key (got [${result.rollback.invalidatedClientRequestIds.join(
      ', ',
    )}])`,
  );
  assert(
    countTurnRows('team_messages', sessionId, turnKey) === 0,
    'turn-derived team message must be deleted by the rollback',
  );
  assert(
    sqliteGet<{ count: number }>('SELECT COUNT(*) as count FROM team_messages WHERE id = ?', [
      workspaceMessageId,
    ])?.count === 1,
    'NULL-keyed workspace team message must survive the rollback',
  );
  assert(
    countTurnRows('team_converge_results', sessionId, turnKey) === 0,
    'turn-derived converge row must be deleted by the rollback',
  );
  assert(
    sqliteGet<{ count: number }>(
      `SELECT COUNT(*) as count FROM team_converge_results
        WHERE session_id = ? AND (client_request_id IS NULL OR client_request_id = '')`,
      [sessionId],
    )?.count === 1,
    'NULL-keyed manual converge row must survive the rollback',
  );
}

/** H2：子树超过上限必须整体拒绝，且不产生任何部分删除。 */
export async function verifyRollbackScopeCap(): Promise<void> {
  const userId = createUser('scope-cap');
  const rootSessionId = createSession({ userId, roleLayer: 'reception' });
  for (let index = 0; index < TEAM_RUNTIME_CONTROL_SESSION_LIMIT; index += 1) {
    createSession({ userId, teamParentSessionId: rootSessionId });
  }
  const turnId = `turn-cap-${randomUUID()}`;
  seedTurnRows({ userId, sessionId: rootSessionId, clientRequestId: turnId });
  const sessionCountBefore = Number(
    sqliteGet<{ count: number }>('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [
      userId,
    ])?.count ?? 0,
  );

  let caught: unknown;
  try {
    await rollbackSessionTurn({
      sessionId: rootSessionId,
      userId,
      messageId: randomUUID(),
      messageText: 'cap fixture',
    });
  } catch (error) {
    caught = error;
  }

  assert(
    caught instanceof RollbackScopeLimitExceededError,
    `cap overflow must throw RollbackScopeLimitExceededError (got ${String(caught)})`,
  );
  assert(
    caught.code === 'ROLLBACK_SCOPE_LIMIT_EXCEEDED',
    `cap overflow error must expose the structured code (got ${caught.code})`,
  );
  assert(
    caught.limit === TEAM_RUNTIME_CONTROL_SESSION_LIMIT &&
      caught.affectedSessionCount === TEAM_RUNTIME_CONTROL_SESSION_LIMIT + 1,
    `cap overflow error must report the reused runtime-control limit and actual subtree size (limit=${caught.limit}, affected=${caught.affectedSessionCount})`,
  );
  for (const table of SCOPED_TABLES) {
    assert(
      countTurnRows(table, rootSessionId, turnId) === 1,
      `cap rejection must leave every seeded row untouched (table=${table})`,
    );
  }
  const sessionCountAfter = Number(
    sqliteGet<{ count: number }>('SELECT COUNT(*) as count FROM sessions WHERE user_id = ?', [
      userId,
    ])?.count ?? 0,
  );
  assert(
    sessionCountAfter === sessionCountBefore,
    `cap rejection must not cancel or delete sessions (before=${sessionCountBefore}, after=${sessionCountAfter})`,
  );
}

/** H4：用户直发子会话时，发布器采用该消息自身的回合键，回退可精确清理。 */
export async function verifyDirectSendTurnKeyPrecedence(): Promise<void> {
  const userId = createUser('direct-send');
  const rootSessionId = createSession({ userId, roleLayer: 'reception' });
  const childSessionId = createSession({
    userId,
    roleLayer: 'pm1',
    teamParentSessionId: rootSessionId,
  });
  const parentTurnId = `turn-parent-${randomUUID()}`;
  const parentHandoff = createHandoff({
    userId,
    fromSessionId: rootSessionId,
    fromRoleLayer: 'reception',
    toRoleLayer: 'pm1',
    clientRequestId: parentTurnId,
    payload: { sourceIntent: 'direct send fixture' },
  });
  const claimToken = randomUUID();
  assert(
    claimHandoff({ handoffId: parentHandoff.id, claimToken }) !== null &&
      startHandoff({ handoffId: parentHandoff.id, claimToken, toSessionId: childSessionId }),
    'direct-send fixture requires an active parent handoff bound to the child session',
  );
  assert(
    resolveSessionTurnClientRequestId(childSessionId) === parentTurnId,
    'without an own turn key the child session must still inherit the active parent handoff',
  );

  const directTurnId = `turn-direct-${randomUUID()}`;
  publishTeamUsageEvent({
    userId,
    sessionId: childSessionId,
    sessionContext: { metadataJson: '{}', roleLayer: 'pm1' },
    round: 1,
    provider: 'openai',
    model: 'gpt-direct-send',
    inputTokens: 5,
    outputTokens: 6,
    clientRequestId: directTurnId,
  });
  assert(
    countTurnRows('team_usage_records', childSessionId, directTurnId) === 1,
    'direct send own turn key must win over the active parent handoff inheritance',
  );
  assert(
    countTurnRows('team_usage_records', childSessionId, parentTurnId) === 0,
    'direct send must not be attributed to the older parent turn',
  );

  const directMessage = appendSessionMessageV2({
    sessionId: childSessionId,
    userId,
    role: 'user',
    clientRequestId: directTurnId,
    content: [{ type: 'text', text: 'direct send message' }],
  });
  const rollback = await rollbackSessionTurn({
    sessionId: childSessionId,
    userId,
    messageId: directMessage.id,
    messageText: 'direct send message',
  });
  assert(
    rollback.rollback.invalidatedClientRequestIds.includes(directTurnId),
    `rolling back the direct message must invalidate its own turn key (got [${rollback.rollback.invalidatedClientRequestIds.join(
      ', ',
    )}])`,
  );
  assert(
    countTurnRows('team_usage_records', childSessionId, directTurnId) === 0,
    'rolling back the direct message must remove its team usage rows',
  );
}
