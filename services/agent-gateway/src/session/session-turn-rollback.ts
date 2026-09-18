/**
 * session-turn-rollback — 回合级回退编排器（计划 §3 回退契约 / Phase 2）。
 *
 * 「回退到消息 M」= 撤销 M（含）之后的一切 S2 产物，并删除归属该回合的 S3 团队记录：
 *   1. 取消运行中派生链（**先取消再删除**，否则 in-flight runner 可能在切割点之后回写消息）；
 *   2. 单事务删除：message/part（含 legacy search mirror）→ S1 pending 交互置终态 →
 *      S2 派生物（run events / session entries / file diffs / snapshots）→ S3 团队记录。
 *      事务内任一步失败整体回滚，绝不部分生效。
 *
 * 幂等：同一 `cutoffMessageId` 重复调用时，truncate 找不到目标消息 → 不删除，返回
 * `applied: false` 的 no-op receipt（cutoff/tombstone 均为 0，窗口为空），生产调用方
 * 不得广播该 receipt。
 *
 * 为何是 async：取消原语（`stopAllInFlightStreamRequestsForSession` /
 * `cancelDescendantSessionStreams` / `cascadeCancelDownstream`）必须 await 完成后再进入删除事务，
 * 同步函数无法表达该顺序；DB 删除阶段仍由 `sqliteTransaction` 保证原子性。
 */

import type { Message } from '@openAwork/shared';
import { sqliteAll, sqliteTransaction } from '../infra/db.js';
import { chunkSqliteBindValues } from '../infra/sqlite-batch.js';
import { truncateSessionMessagesAfterV2 } from '../message/message-v2-adapter.js';
import { deleteSessionRunEventsByRequest } from './session-run-events.js';
import { deleteSessionEventsByRequestScope } from './session-entry-store.js';
import { deleteRequestFileDiffs } from './session-file-diff-store.js';
import { deleteRequestSnapshots } from './session-snapshot-store.js';
import { collectDescendantSessionIds, type SessionTreeRow } from './session-descendant-tree.js';
import { cancelDescendantSessionStreams } from './cancel-descendant-streams.js';
import { cascadeCancelDownstream } from './cascade-cancel-downstream.js';
import {
  cancelTeamRuntimeTree,
  TEAM_RUNTIME_CONTROL_SESSION_LIMIT,
} from '../team/team-runtime-control-store.js';
import { stopAllInFlightStreamRequestsForSession } from '../routes/stream-cancellation.js';
import { cancelPendingPermissionRequestsByClientRequest } from '../routes/permissions.js';
import { cancelPendingQuestionRequestsByClientRequest } from '../routes/questions.js';
import { deleteHandoffsByClientRequest } from '../handoff/store/handoff-store.js';
import { deleteTeamAuditLogsByClientRequest, logTeamAudit } from '../team/team-audit-store.js';
import {
  deleteTeamToolCallRecordsByClientRequest,
  deleteTeamUsageRecordsByClientRequest,
} from '../team/team-usage-records-store.js';
import { deleteTeamConvergeResultsByClientRequest } from '../team/team-converge.js';
import { deleteTeamMessagesByClientRequest } from '../team/team-message-store.js';
import { purgeRolledBackTurnTaskGraphNodes } from './session-turn-rollback-task-graph.js';

export interface RollbackReceipt {
  sessionId: string;
  cutoffMessageId: string;
  /**
   * 作废窗口左端点 = 第一条被删消息的 `time_created`。
   * no-op（`applied === false`）时为 0：没有被删的消息就没有有意义的左端点，
   * 恒为 0 也保证 `[0, 0)` 是空窗口，任何消费方都不会因此过滤掉新数据。
   */
  cutoffTimeMs: number;
  /**
   * 作废窗口右端点：在任何删除动作之前冻结的 `Date.now()`。
   * no-op（`applied === false`）时为 0（空窗口），**绝不**用 `Date.now()` 伪造右端点——
   * 否则多标签页里重复提交同一个已删除消息时，伪造的「现在」会与已有窗口合并、
   * 把右边界推到当前时刻，误伤随后重发的新回合。
   */
  tombstoneAtMs: number;
  removedMessageIds: string[];
  invalidatedClientRequestIds: string[];
  affectedSessionIds: string[];
  /**
   * 回退是否真的删除了东西（幂等重放 / `inclusive: false` 命中末条时为 `false`）。
   * 语义：`false` ⇒ 「什么都没删」，receipt 是 no-op，调用方不得广播失效事件；
   * 真实回退保持缺席（或显式 `true`）。
   */
  applied?: boolean;
}

/**
 * 回退子树超过上限时抛出。上限与团队运行时控制同源
 * （`TEAM_RUNTIME_CONTROL_SESSION_LIMIT`）：两者都面对「一次操作波及的会话子树」，
 * 复用同一常量避免两套阈值漂移。
 *
 * 失败模式是「整体拒绝」：本错误在任何取消 / 删除动作之前抛出，命中它的请求不会
 * 取消任何流、不会删除任何一行——静默地只删部分子树比可见的失败更糟。
 */
export class RollbackScopeLimitExceededError extends Error {
  readonly code = 'ROLLBACK_SCOPE_LIMIT_EXCEEDED';
  readonly rootSessionId: string;
  readonly affectedSessionCount: number;
  readonly limit: number;

  constructor(input: { rootSessionId: string; affectedSessionCount: number; limit: number }) {
    super(
      `回退受影响会话数 ${input.affectedSessionCount} 超过上限 ${input.limit}（根会话 ${input.rootSessionId}），已中止且未删除任何数据。`,
    );
    this.name = 'RollbackScopeLimitExceededError';
    this.rootSessionId = input.rootSessionId;
    this.affectedSessionCount = input.affectedSessionCount;
    this.limit = input.limit;
  }
}

export async function rollbackSessionTurn(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  inclusive?: boolean;
  messageText?: string;
}): Promise<{ messages: Message[]; rollback: RollbackReceipt }> {
  const affectedSessionIds = resolveAffectedSessionIds(input);
  await cancelTurnDerivedChain(input);
  const outcome = sqliteTransaction(() => applyRollbackDeletes({ ...input, affectedSessionIds }));

  // 文件任务图清理（计划 §3 第 6 步）无法进入上面的同步事务：任务图存储
  // （`AgentTaskStoreImpl`）是 `fs.promises` 异步 API，而 better-sqlite3 事务回调不允许
  // await。因此清理严格发生在 COMMIT 之后，按 receipt 的回合键精确匹配、幂等；
  // 失败只告警——DB 删除已提交，不能把已经生效的回退伪装成失败。
  await purgeRolledBackTurnTaskGraphNodes({
    affectedSessionIds: outcome.rollback.affectedSessionIds,
    invalidatedClientRequestIds: outcome.rollback.invalidatedClientRequestIds,
  });

  return outcome;
}

function resolveAffectedSessionIds(input: { sessionId: string; userId: string }): string[] {
  // 子树语义 = 两棵父子树的并集（计划 §2.4 显式选择）：
  //   - `sessions.team_parent_session_id`：团队分层链（reception → pm1 → pm2 → executor/reviewer）
  //   - `sessions.metadata_json.parentSessionId`：task 子会话链（subagent 消息树）
  // `collectDescendantSessionIds` 同时挂两条父链后 BFS，返回值含 root 自身。
  //
  // 规模上限复用团队运行时控制同一常量：BFS 本身无深度风险（迭代、内存索引），
  // 风险在后续 6 张团队表 × 会话 × 回合键的删除扇出会阻塞事件循环。超过上限直接
  // 抛 RollbackScopeLimitExceededError（在任何取消 / 删除之前），拒绝部分删除。
  //
  // 取舍（刻意保留）：超限意味着整次回退被拒绝（路由映射 409，一行不删、一个流不停），
  // 受影响子树 > 200 的团队因此完全无法回退。选择「不删」而非「只删一部分」：部分删除
  // 会留下无法归因的混合状态（消息已删、团队记录残留），比可见的失败更难修复。
  // 提高上限需要删除扇出的实测证据（事件循环阻塞预算 / 单请求耗时），不得仅因遇到
  // 大团队就上调——上调会把阻塞风险带回每个回退请求。
  const sessions = sqliteAll<SessionTreeRow>(
    'SELECT id, metadata_json, team_parent_session_id FROM sessions WHERE user_id = ?',
    [input.userId],
  );
  const descendants = collectDescendantSessionIds(sessions, input.sessionId);
  if (descendants.size > TEAM_RUNTIME_CONTROL_SESSION_LIMIT) {
    throw new RollbackScopeLimitExceededError({
      rootSessionId: input.sessionId,
      affectedSessionCount: descendants.size,
      limit: TEAM_RUNTIME_CONTROL_SESSION_LIMIT,
    });
  }
  return [...descendants].sort();
}

async function cancelTurnDerivedChain(input: { sessionId: string; userId: string }): Promise<void> {
  // 团队分层树：先把未终止 handoff 翻成 cancelled（同步、确定性）。
  const teamScope = cancelTeamRuntimeTree({
    rootSessionId: input.sessionId,
    userId: input.userId,
  });

  // 团队树存在时再级联注入 cancel_signal / 停流 / 置 substate / 广播 handoff.cancelled。
  // 纯 chat 会话（无 role_layer 且无团队子会话）跳过级联：避免把 substate 置成
  // cancelled 污染聊天会话恢复态（计划 §3.8：除「回合仍在跑」外不改 substate）。
  if (teamScope && (teamScope.rootRoleLayer !== null || teamScope.treeSessionIds.length > 1)) {
    try {
      await cascadeCancelDownstream({
        rootSessionId: input.sessionId,
        userId: input.userId,
      });
    } catch (error) {
      console.warn(
        `[turn-rollback] 团队树级联取消失败（不阻塞删除）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // 根会话自身的 in-flight 流：必须先于删除完成，否则 runner 可能在切割点之后回写消息。
  try {
    await stopAllInFlightStreamRequestsForSession({
      sessionId: input.sessionId,
      userId: input.userId,
    });
  } catch (error) {
    console.warn(
      `[turn-rollback] 根会话停流失败（不阻塞删除）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // task 子会话树（metadata_json.parentSessionId）的 in-flight 流。
  try {
    await cancelDescendantSessionStreams({
      rootSessionId: input.sessionId,
      userId: input.userId,
      reason: 'ancestor_aborted',
    });
  } catch (error) {
    console.warn(
      `[turn-rollback] task 子会话停流失败（不阻塞删除）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function applyRollbackDeletes(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  inclusive?: boolean;
  messageText?: string;
  affectedSessionIds: string[];
}): { messages: Message[]; rollback: RollbackReceipt } {
  const truncated = truncateSessionMessagesAfterV2({
    sessionId: input.sessionId,
    userId: input.userId,
    messageId: input.messageId,
    inclusive: input.inclusive,
    messageText: input.messageText,
  });
  const clientRequestIds = truncated.invalidatedClientRequestIds;
  const hasDeletions = clientRequestIds.length > 0 || truncated.removedMessageIds.length > 0;

  // no-op：不发明窗口。cutoff/tombstone 恒为 0，窗口 [0, 0) 为空——
  // 重复提交同一个已删除消息时，伪造的「现在」会把已有窗口的右边界推到现在，
  // 让前端过滤掉随后重发的新回合（多标签页场景实测）。
  const cutoffTimeMs = hasDeletions ? truncated.cutoffTimeMs : 0;

  // 作废窗口右端点：必须在任何删除动作之前冻结，否则晚到的 WS 事件可能落在窗口外。
  const tombstoneAtMs = hasDeletions ? Date.now() : 0;

  // 计划 §7「执行前记录 receipt 到日志」：硬删除不可逆，进程若在事务中途崩溃，
  // 这条日志是唯一能还原「谁在何时删除了哪个回合」的痕迹。
  if (hasDeletions) {
    console.info('[turn-rollback] 开始执行回合硬删除', {
      sessionId: input.sessionId,
      cutoffMessageId: input.messageId,
      cutoffTimeMs,
      tombstoneAtMs,
      removedMessageCount: truncated.removedMessageIds.length,
      invalidatedClientRequestIds: clientRequestIds,
      affectedSessionIds: input.affectedSessionIds,
    });
  }

  // S1：pending 交互置终态。必须在按请求删除 run events 之前——置终态会 publish
  // 一条 replied 事件，随后按请求删除会把它与该回合的 asked 一起清掉，满足
  // 「该回合 session_run_events 无残留」的验收口径。
  for (const clientRequestId of clientRequestIds) {
    cancelPendingPermissionRequestsByClientRequest({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId,
    });
    cancelPendingQuestionRequestsByClientRequest({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId,
    });
  }

  // S2：该回合的 run events / session entries / 文件 diff / 快照。
  // 保持逐请求调用：这些 helper 是跨模块共享的单请求原语，且回合键数量 R 通常远小于
  // 会话扇出 S；本轮回退的主要扇出（6 张团队表 × S 会话）已在 S3 收敛为每表单语句。
  for (const clientRequestId of clientRequestIds) {
    deleteSessionRunEventsByRequest({ sessionId: input.sessionId, clientRequestId });
    deleteSessionEventsByRequestScope({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId,
    });
    deleteRequestFileDiffs({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId,
    });
    deleteRequestSnapshots({
      sessionId: input.sessionId,
      userId: input.userId,
      clientRequestId,
    });
  }

  // S3：团队记录硬删。会话集合 × 回合键集合按笛卡尔积删除——等价于逐 (会话, 回合)
  // 对调用，但每张表只发一条语句（回合键超出绑定上限时按分片执行），把 6×S×R 条
  // 语句压到 6×ceil(R/分片)。回合派生记录可能落在子树任一会话（如子会话的用量行），
  // 故会话集合取整个受影响子树；受影响会话数已由 resolveAffectedSessionIds 封顶。
  const s3Chunks = chunkSqliteBindValues(clientRequestIds, 2 * input.affectedSessionIds.length + 1);
  for (const clientRequestIdChunk of s3Chunks) {
    const deleteScope = {
      userId: input.userId,
      sessionIds: input.affectedSessionIds,
      clientRequestIds: clientRequestIdChunk,
    };
    deleteHandoffsByClientRequest(deleteScope);
    deleteTeamAuditLogsByClientRequest(deleteScope);
    deleteTeamUsageRecordsByClientRequest(deleteScope);
    deleteTeamToolCallRecordsByClientRequest(deleteScope);
    deleteTeamConvergeResultsByClientRequest(deleteScope);
    deleteTeamMessagesByClientRequest(deleteScope);
  }

  // 权威痕迹（计划 §7）：与删除同事务写入一条 `turn_rollback` 审计，声明"该回合作废"。
  //
  // 关键不变量：本行必须能在本次回退中存活，因此 `clientRequestId` 恒为 null。
  // 按回合删除的谓词是 `client_request_id = ?`，SQL 中 NULL 永不等于任何绑定值，
  // 所以无论上方的删除循环怎样执行都匹配不到这一行；若把它写成被作废回合的
  // clientRequestId，回退会立刻删掉自己的痕迹。被作废回合的标识改由 summary/detail 携带。
  if (hasDeletions) {
    logTeamAudit({
      action: 'turn_rollback',
      entityType: 'session',
      entityId: input.sessionId,
      sessionId: input.sessionId,
      summary: `回退作废回合：作废 ${clientRequestIds.length} 个请求，删除 ${truncated.removedMessageIds.length} 条消息`,
      detail: JSON.stringify({
        cutoffMessageId: input.messageId,
        invalidatedClientRequestIds: clientRequestIds,
        removedMessageCount: truncated.removedMessageIds.length,
        affectedSessionIds: input.affectedSessionIds,
        tombstoneAtMs,
      }),
      userId: input.userId,
      clientRequestId: null,
    });
  }

  return {
    messages: truncated.messages,
    rollback: {
      sessionId: input.sessionId,
      cutoffMessageId: input.messageId,
      cutoffTimeMs,
      tombstoneAtMs,
      removedMessageIds: truncated.removedMessageIds,
      invalidatedClientRequestIds: clientRequestIds,
      affectedSessionIds: input.affectedSessionIds,
      ...(hasDeletions ? {} : { applied: false }),
    },
  };
}
