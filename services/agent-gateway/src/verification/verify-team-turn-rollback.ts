/**
 * verify-team-turn-rollback — 团队回合回退（计划 Phase 5）验收脚本。
 *
 * 覆盖范围（真实 DB + 源码导入）：
 *   - S2 回合/请求：message_v2 / part_v2 / session_messages / session_messages_fts /
 *     session_run_events / session_entry / session_file_diffs / session_snapshots
 *     按 client_request_id 精确删除；
 *   - S1 会话：该回合的 pending 权限 → rejected、待澄清 → dismissed（**置终态不删行**）；
 *   - S3 团队：handoff_records / team_usage_records / team_tool_call_records / team_audit_logs /
 *     team_converge_results / team_messages 按 client_request_id 硬删除（含子树会话归属行）；
 *   - 权威痕迹（计划 §7）：回退必须留下一条 `turn_rollback` 审计（client_request_id 为
 *     NULL，因此不会被自身的按回合删除清掉），且 detail 指认被作废回合的请求键；
 *   - receipt 广播资格：真实回退 `applied !== false`，幂等重放为 `applied: false` 且
 *     cutoff/tombstone 均为 0（空窗口，不伪造「现在」）；
 *   - 文件任务图（计划 §3 第 6 步）：被作废回合的任务节点被摘除、存活回合节点保留、
 *     parentTaskId / blocks / blockedBy 悬挂引用被清理、空图文件被删除、损坏图文件告警；
 *   - 写入链路（Phase 1 回归）：createHandoff 显式回合键与**父 handoff 继承**
 *     （终态父 handoff 不得被继承）、logTeamAudit 回合级带键 / 团队级保持 NULL、
 *     usage/toolcall/timing 发布器落键、recordConvergeResult / appendTeamMessage 落键，
 *     以及真实写入行可被回退清除；
 *   - D2：受影响子树内 running 子会话 / handoff 被级联取消；
 *   - 边界：同 cutoff 重复调用幂等、无关会话零误伤、`PRAGMA foreign_key_check` 无违规。
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { AgentTaskManagerImpl, AgentTaskStoreImpl } from '@openAwork/agent-core';
import { closeDb, connectDb, migrate, sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import type { SqliteBindableValue } from '../infra/sqlite-bind-params.js';
import { appendSessionMessageV2 as appendSessionMessage } from '../message/message-v2-adapter.js';
import {
  claimHandoff,
  createHandoff,
  resolveSessionTurnClientRequestId,
  startHandoff,
} from '../handoff/store/handoff-store.js';
import { logTeamAudit } from '../team/team-audit-store.js';
import { appendTeamMessage } from '../team/team-message-store.js';
import { recordConvergeResult, type ConvergeResult } from '../team/team-converge.js';
import {
  publishTeamTimingEvent,
  publishTeamToolCallEvent,
  publishTeamUsageEvent,
  publishTeamWorkflowUsageEvent,
} from '../routes/stream-team-events.js';
import { rollbackSessionTurn } from '../session/session-turn-rollback.js';
import { createRequestSnapshotRef } from '../session/session-snapshot-store.js';
import { resolveTaskGraphProjectRoot } from '../task/task-graph-root.js';
import {
  verifyActiveOnlyResolverTurnInheritance,
  verifyTurnKeyOwnershipPrecedence,
} from './verify-team-turn-rollback-resolver.js';
import {
  verifyDeleteHelpersAreUserScoped,
  verifyDirectSendTurnKeyPrecedence,
  verifyRollbackScopeCap,
  verifyTurnLessWritesSurviveRollback,
} from './verify-team-turn-rollback-hardening.js';
import {
  verifyChainedDispatchCarriesTurnKey,
  verifyDegradedChainCarriesTurnKey,
} from './verify-team-turn-rollback-chain.js';
import { verifyInternalRequestKeyGuard } from './verify-team-turn-rollback-internal-keys.js';
import { assertTaskGraphPurgeOutcome } from './verify-team-turn-rollback-task-graph.js';
import { assert, withTempEnv } from './task-verification-helpers.js';

interface RowExpectation {
  label: string;
  sql: string;
  params: readonly SqliteBindableValue[];
  /** 回退前的期望行数（证明确实种下了这些行）。 */
  before: number;
  /** 回退后的期望行数（目标回合 0；存活行保持原值）。 */
  after: number;
}

function countRows(sql: string, params: readonly SqliteBindableValue[] = []): number {
  return Number(sqliteGet<{ count: number }>(sql, params)?.count ?? 0);
}

function parseAuditDetail(raw: string | null): Record<string, unknown> {
  if (raw === null) {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

function readStringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function assertRowCount(expectation: RowExpectation, phase: 'seeded' | 'after rollback'): void {
  const expected = phase === 'seeded' ? expectation.before : expectation.after;
  const actual = countRows(expectation.sql, expectation.params);
  assert(actual === expected, `${expectation.label} ${phase}: expected ${expected}, got ${actual}`);
}

async function main(): Promise<void> {
  const workspaceRoot = path.join('/tmp', `openawork-turn-rollback-${randomUUID()}`);
  mkdirSync(workspaceRoot, { recursive: true });

  try {
    await withTempEnv(
      {
        DATABASE_URL: ':memory:',
        WORKSPACE_ROOT: workspaceRoot,
      },
      async () => {
        await connectDb();
        await migrate();

        try {
          // ─── 用户 / 会话夹具：root(reception) ← child(executor) 子树 + 无关会话 ───
          const userId = randomUUID();
          sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
            userId,
            `turn-rollback-${userId}@openawork.local`,
            'hash',
          ]);

          const rootSessionId = randomUUID();
          const childSessionId = randomUUID();
          const unrelatedSessionId = randomUUID();

          sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, role_layer)
           VALUES (?, ?, '[]', 'idle', ?, 'reception')`,
            [rootSessionId, userId, JSON.stringify({ workingDirectory: workspaceRoot })],
          );
          sqliteRun(
            `INSERT INTO sessions
             (id, user_id, messages_json, state_status, metadata_json, role_layer, substate, team_parent_session_id)
           VALUES (?, ?, '[]', 'running', '{}', 'executor', 'executing', ?)`,
            [childSessionId, userId, rootSessionId],
          );
          sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json)
           VALUES (?, ?, '[]', 'idle', '{}')`,
            [unrelatedSessionId, userId],
          );

          // ─── 回合键：EARLIER（必须存活）/ TARGET（必须清除）/ OTHER（无关会话） ───
          const earlierRequestId = `turn-earlier-${randomUUID()}`;
          const targetRequestId = `turn-target-${randomUUID()}`;
          const targetAssistantRequestId = `${targetRequestId}:assistant:1`;
          const otherRequestId = `turn-other-${randomUUID()}`;

          // ─── S2 消息：message_v2 + part_v2 + legacy search mirror ───
          const baseTime = Date.now() - 60_000;
          const targetUserCreatedAt = baseTime + 2_000;
          const earlierUserMessage = appendSessionMessage({
            sessionId: rootSessionId,
            userId,
            role: 'user',
            clientRequestId: earlierRequestId,
            content: [{ type: 'text', text: 'earlier turn user message' }],
            createdAt: baseTime,
          });
          const earlierAssistantMessage = appendSessionMessage({
            sessionId: rootSessionId,
            userId,
            role: 'assistant',
            clientRequestId: `${earlierRequestId}:assistant:1`,
            content: [{ type: 'text', text: 'earlier turn assistant message' }],
            createdAt: baseTime + 1_000,
          });
          const targetUserMessage = appendSessionMessage({
            sessionId: rootSessionId,
            userId,
            role: 'user',
            clientRequestId: targetRequestId,
            content: [{ type: 'text', text: 'target turn user message' }],
            createdAt: targetUserCreatedAt,
          });
          const targetAssistantMessage = appendSessionMessage({
            sessionId: rootSessionId,
            userId,
            role: 'assistant',
            clientRequestId: targetAssistantRequestId,
            content: [{ type: 'text', text: 'target turn assistant message' }],
            createdAt: baseTime + 3_000,
          });
          appendSessionMessage({
            sessionId: unrelatedSessionId,
            userId,
            role: 'user',
            clientRequestId: otherRequestId,
            content: [{ type: 'text', text: 'unrelated turn user message' }],
            createdAt: baseTime,
          });
          appendSessionMessage({
            sessionId: unrelatedSessionId,
            userId,
            role: 'assistant',
            clientRequestId: `${otherRequestId}:assistant:1`,
            content: [{ type: 'text', text: 'unrelated turn assistant message' }],
            createdAt: baseTime + 1_000,
          });

          const earlierUserMessageId = earlierUserMessage.id;
          const earlierAssistantMessageId = earlierAssistantMessage.id;
          const targetUserMessageId = targetUserMessage.id;
          const targetAssistantMessageId = targetAssistantMessage.id;

          // 回合归因前提：clientRequestId 只存在于 message_v2.data JSON。
          const targetRow = sqliteGet<{ data: string }>(
            'SELECT data FROM message_v2 WHERE id = ?',
            [targetUserMessageId],
          );
          assert(targetRow !== undefined, 'target user message_v2 row must exist after seeding');
          const parsedTargetData = JSON.parse(targetRow.data) as { clientRequestId?: unknown };
          assert(
            parsedTargetData.clientRequestId === targetRequestId,
            `target message_v2 data must carry clientRequestId=${targetRequestId}, got ${String(
              parsedTargetData.clientRequestId,
            )}`,
          );

          // ─── S2 派生物：session_run_events / session_entry ───
          sqliteRun(
            `INSERT INTO session_run_events
             (session_id, user_id, client_request_id, seq, event_type, event_id, occurred_at_ms, payload_json)
           VALUES (?, ?, ?, 1, 'tool_result', ?, ?, '{}')`,
            [
              rootSessionId,
              userId,
              earlierRequestId,
              `evt-earlier-${randomUUID()}`,
              baseTime + 1_000,
            ],
          );
          sqliteRun(
            `INSERT INTO session_run_events
             (session_id, user_id, client_request_id, seq, event_type, event_id, occurred_at_ms, payload_json)
           VALUES (?, ?, ?, 1, 'tool_result', ?, ?, '{}')`,
            [
              rootSessionId,
              userId,
              targetRequestId,
              `evt-target-${randomUUID()}`,
              targetUserCreatedAt,
            ],
          );
          sqliteRun(
            `INSERT INTO session_run_events
             (session_id, user_id, client_request_id, seq, event_type, event_id, occurred_at_ms, payload_json)
           VALUES (?, ?, ?, 1, 'tool_result', ?, ?, '{}')`,
            [
              rootSessionId,
              userId,
              targetAssistantRequestId,
              `evt-target-assistant-${randomUUID()}`,
              baseTime + 3_000,
            ],
          );
          sqliteRun(
            `INSERT INTO session_run_events
             (session_id, user_id, client_request_id, seq, event_type, event_id, occurred_at_ms, payload_json)
           VALUES (?, ?, ?, 1, 'tool_result', ?, ?, '{}')`,
            [
              unrelatedSessionId,
              userId,
              otherRequestId,
              `evt-other-${randomUUID()}`,
              baseTime + 1_000,
            ],
          );
          sqliteRun(
            `INSERT INTO session_entry (id, session_id, user_id, client_request_id, seq, type, timestamp, data)
           VALUES (?, ?, ?, ?, 1, 'message.updated', ?, '{}')`,
            [randomUUID(), rootSessionId, userId, earlierRequestId, baseTime + 1_000],
          );
          sqliteRun(
            `INSERT INTO session_entry (id, session_id, user_id, client_request_id, seq, type, timestamp, data)
           VALUES (?, ?, ?, ?, 1, 'message.updated', ?, '{}')`,
            [randomUUID(), rootSessionId, userId, targetRequestId, targetUserCreatedAt],
          );
          sqliteRun(
            `INSERT INTO session_entry (id, session_id, user_id, client_request_id, seq, type, timestamp, data)
           VALUES (?, ?, ?, ?, 1, 'message.updated', ?, '{}')`,
            [randomUUID(), unrelatedSessionId, userId, otherRequestId, baseTime + 1_000],
          );

          // ─── S2 派生物（回合级）：session_file_diffs / session_snapshots ───
          const insertFileDiff = (
            sessionId: string,
            clientRequestId: string,
            filePath: string,
          ): void => {
            sqliteRun(
              `INSERT INTO session_file_diffs
               (session_id, user_id, client_request_id, request_id, tool_name, file_path, additions, deletions)
             VALUES (?, ?, ?, ?, 'write', ?, 3, 1)`,
              [sessionId, userId, clientRequestId, clientRequestId, filePath],
            );
          };
          insertFileDiff(rootSessionId, targetRequestId, 'target-turn.txt');
          insertFileDiff(rootSessionId, earlierRequestId, 'earlier-turn.txt');
          insertFileDiff(unrelatedSessionId, otherRequestId, 'unrelated-turn.txt');

          const insertSnapshot = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO session_snapshots (session_id, user_id, client_request_id, summary_json, files_json)
             VALUES (?, ?, ?, '{}', '[]')`,
              [sessionId, userId, createRequestSnapshotRef(clientRequestId)],
            );
          };
          insertSnapshot(rootSessionId, targetRequestId);
          insertSnapshot(rootSessionId, earlierRequestId);

          // ─── S1 pending 交互：clientRequestId 位于 request_payload_json 内 ───
          const targetPermissionRequestId = randomUUID();
          const earlierPermissionRequestId = randomUUID();
          const targetQuestionRequestId = randomUUID();
          const earlierQuestionRequestId = randomUUID();
          sqliteRun(
            `INSERT INTO permission_requests
             (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
           VALUES (?, ?, 'write', 'workspace:target.txt', 'target turn permission', 'medium', 'pending', ?)`,
            [
              targetPermissionRequestId,
              rootSessionId,
              JSON.stringify({ clientRequestId: targetRequestId }),
            ],
          );
          sqliteRun(
            `INSERT INTO permission_requests
             (id, session_id, tool_name, scope, reason, risk_level, status, request_payload_json)
           VALUES (?, ?, 'write', 'workspace:earlier.txt', 'earlier turn permission', 'medium', 'pending', ?)`,
            [
              earlierPermissionRequestId,
              rootSessionId,
              JSON.stringify({ clientRequestId: earlierRequestId }),
            ],
          );
          sqliteRun(
            `INSERT INTO question_requests
             (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
           VALUES (?, ?, ?, 'ask_user', 'target turn question', '[]', ?, 'pending')`,
            [
              targetQuestionRequestId,
              rootSessionId,
              userId,
              JSON.stringify({ clientRequestId: targetRequestId }),
            ],
          );
          sqliteRun(
            `INSERT INTO question_requests
             (id, session_id, user_id, tool_name, title, questions_json, request_payload_json, status)
           VALUES (?, ?, ?, 'ask_user', 'earlier turn question', '[]', ?, 'pending')`,
            [
              earlierQuestionRequestId,
              rootSessionId,
              userId,
              JSON.stringify({ clientRequestId: earlierRequestId }),
            ],
          );

          // ─── S3 团队记录：目标回合（root + child 子树）、EARLIER、无关会话 ───
          const targetHandoffId = randomUUID();
          const earlierHandoffId = randomUUID();
          const otherHandoffId = randomUUID();
          sqliteRun(
            `INSERT INTO handoff_records
             (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, client_request_id)
           VALUES (?, ?, ?, 'reception', 'executor', ?, '{}', 'running', ?)`,
            [targetHandoffId, userId, rootSessionId, childSessionId, targetRequestId],
          );
          sqliteRun(
            `INSERT INTO handoff_records
             (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, client_request_id)
           VALUES (?, ?, ?, 'executor', 'reception', ?, '{}', 'running', ?)`,
            [earlierHandoffId, userId, childSessionId, rootSessionId, earlierRequestId],
          );
          sqliteRun(
            `INSERT INTO handoff_records
             (id, user_id, from_session_id, from_role_layer, to_role_layer, to_session_id, payload_json, state, client_request_id)
           VALUES (?, ?, ?, 'reception', 'executor', NULL, '{}', 'running', ?)`,
            [otherHandoffId, userId, unrelatedSessionId, otherRequestId],
          );

          const insertUsage = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO team_usage_records
               (user_id, session_id, layer, provider, model, client_request_id, input_tokens, output_tokens)
             VALUES (?, ?, 'executor', 'openai', 'gpt-test', ?, 10, 20)`,
              [userId, sessionId, clientRequestId],
            );
          };
          insertUsage(rootSessionId, targetRequestId);
          insertUsage(childSessionId, targetRequestId);
          insertUsage(rootSessionId, earlierRequestId);
          insertUsage(unrelatedSessionId, otherRequestId);

          const insertToolCall = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO team_tool_call_records
               (user_id, session_id, layer, tool_name, duration_ms, success, client_request_id)
             VALUES (?, ?, 'executor', 'write', 12, 1, ?)`,
              [userId, sessionId, clientRequestId],
            );
          };
          insertToolCall(rootSessionId, targetRequestId);
          insertToolCall(childSessionId, targetRequestId);
          insertToolCall(rootSessionId, earlierRequestId);
          insertToolCall(unrelatedSessionId, otherRequestId);

          const insertAudit = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO team_audit_logs
               (user_id, action, entity_type, entity_id, summary, session_id, client_request_id)
             VALUES (?, 'turn_rollback', 'session', ?, 'seed audit', ?, ?)`,
              [userId, sessionId, sessionId, clientRequestId],
            );
          };
          insertAudit(rootSessionId, targetRequestId);
          insertAudit(rootSessionId, earlierRequestId);
          insertAudit(unrelatedSessionId, otherRequestId);

          const insertConverge = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO team_converge_results
               (id, team_workspace_id, session_id, result_json, client_request_id)
             VALUES (?, ?, ?, '{}', ?)`,
              [randomUUID(), randomUUID(), sessionId, clientRequestId],
            );
          };
          insertConverge(childSessionId, targetRequestId);
          insertConverge(rootSessionId, earlierRequestId);
          insertConverge(unrelatedSessionId, otherRequestId);

          const insertTeamMessage = (sessionId: string, clientRequestId: string): void => {
            sqliteRun(
              `INSERT INTO team_messages (id, user_id, session_id, content, type, client_request_id)
             VALUES (?, ?, ?, 'seed team message', 'update', ?)`,
              [randomUUID(), userId, sessionId, clientRequestId],
            );
          };
          insertTeamMessage(rootSessionId, targetRequestId);
          insertTeamMessage(childSessionId, targetRequestId);
          insertTeamMessage(rootSessionId, earlierRequestId);
          insertTeamMessage(unrelatedSessionId, otherRequestId);

          // ─── 文件任务图（计划 §3 第 6 步）：作废回合节点 + 存活回合节点 + 空图用例 ───
          const taskProjectRoot = resolveTaskGraphProjectRoot(rootSessionId);
          assert(
            taskProjectRoot === workspaceRoot &&
              resolveTaskGraphProjectRoot(childSessionId) === workspaceRoot,
            `task graph project root must resolve to the temp workspace (root=${taskProjectRoot}, child=${resolveTaskGraphProjectRoot(childSessionId)}, expected ${workspaceRoot})`,
          );
          const taskManager = new AgentTaskManagerImpl();
          const rootTaskGraph = await taskManager.loadOrCreate(taskProjectRoot, rootSessionId);
          const voidedTask = taskManager.addTask(rootTaskGraph, {
            title: '被回退回合的任务',
            status: 'pending',
            blockedBy: [],
            sessionId: rootSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: targetRequestId,
          });
          const survivorTask = taskManager.addTask(rootTaskGraph, {
            title: '存活回合的任务',
            status: 'pending',
            blockedBy: [voidedTask.id],
            sessionId: rootSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: earlierRequestId,
          });
          // C10：存活节点里故意留下指向被作废节点的 parentTaskId / blocks 引用，
          // 回退后必须被清理（不得残留悬挂指针）。
          const survivorChildTask = taskManager.addTask(rootTaskGraph, {
            title: '存活子任务（父节点被回退）',
            status: 'pending',
            blockedBy: [],
            parentTaskId: voidedTask.id,
            sessionId: rootSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: earlierRequestId,
          });
          const survivorBlocksRefTask = taskManager.addTask(rootTaskGraph, {
            title: '存活任务（blocks 引用被回退节点）',
            status: 'pending',
            blockedBy: [],
            blocks: [voidedTask.id],
            sessionId: rootSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: earlierRequestId,
          });
          // H3：后续回合的更深层后代（孙节点）必须连同其父链完整保留。
          const survivorGrandchildTask = taskManager.addTask(rootTaskGraph, {
            title: '存活孙任务（父链完整）',
            status: 'pending',
            blockedBy: [],
            parentTaskId: survivorChildTask.id,
            sessionId: rootSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: earlierRequestId,
          });
          await taskManager.save(rootTaskGraph);

          // 子会话图只含被作废回合的节点：回退后应整体删文件（空图用例）。
          const childTaskGraph = await taskManager.loadOrCreate(taskProjectRoot, childSessionId);
          taskManager.addTask(childTaskGraph, {
            title: '被回退回合的子会话任务',
            status: 'pending',
            blockedBy: [],
            sessionId: childSessionId,
            priority: 'medium',
            tags: ['turn-rollback-fixture'],
            clientRequestId: targetAssistantRequestId,
          });
          await taskManager.save(childTaskGraph);

          // C10：损坏的任务图文件必须产生 warn（残留可见），且不会被静默当成空图删除。
          const corruptGraphSessionId = randomUUID();
          sqliteRun(
            `INSERT INTO sessions
             (id, user_id, messages_json, state_status, metadata_json, role_layer, team_parent_session_id)
           VALUES (?, ?, '[]', 'running', '{}', 'executor', ?)`,
            [corruptGraphSessionId, userId, rootSessionId],
          );
          const corruptGraphPath = path.join(
            taskProjectRoot,
            '.agentdocs',
            'tasks',
            `${corruptGraphSessionId}.json`,
          );
          writeFileSync(corruptGraphPath, '{ this is not valid json', 'utf8');

          // ─── 行数期望表：before 证明种下、after 证明精确删除 / 零误伤 ───
          const expectations: RowExpectation[] = [
            {
              label: 'target turn message_v2 rows deleted',
              sql: 'SELECT COUNT(*) as count FROM message_v2 WHERE id IN (?, ?)',
              params: [targetUserMessageId, targetAssistantMessageId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn part_v2 rows deleted',
              sql: 'SELECT COUNT(*) as count FROM part_v2 WHERE message_id IN (?, ?)',
              params: [targetUserMessageId, targetAssistantMessageId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn session_messages rows deleted',
              sql: 'SELECT COUNT(*) as count FROM session_messages WHERE id IN (?, ?)',
              params: [targetUserMessageId, targetAssistantMessageId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn session_messages_fts rows deleted',
              sql: 'SELECT COUNT(*) as count FROM session_messages_fts WHERE message_id IN (?, ?)',
              params: [targetUserMessageId, targetAssistantMessageId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn session_run_events rows deleted (all invalidated request ids)',
              sql: `SELECT COUNT(*) as count FROM session_run_events
                  WHERE session_id = ? AND client_request_id IN (?, ?)`,
              params: [rootSessionId, targetRequestId, targetAssistantRequestId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn session_entry rows deleted',
              sql: `SELECT COUNT(*) as count FROM session_entry
                  WHERE session_id = ? AND client_request_id = ?`,
              params: [rootSessionId, targetRequestId],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn session_file_diffs deleted',
              sql: 'SELECT COUNT(*) as count FROM session_file_diffs WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn session_snapshots deleted',
              sql: 'SELECT COUNT(*) as count FROM session_snapshots WHERE client_request_id = ?',
              params: [createRequestSnapshotRef(targetRequestId)],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn handoff_records deleted',
              sql: 'SELECT COUNT(*) as count FROM handoff_records WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn team_usage_records deleted (root + child subtree)',
              sql: 'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn team_tool_call_records deleted (root + child subtree)',
              sql: 'SELECT COUNT(*) as count FROM team_tool_call_records WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 2,
              after: 0,
            },
            {
              label: 'target turn team_audit_logs deleted',
              sql: 'SELECT COUNT(*) as count FROM team_audit_logs WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn team_converge_results deleted (child subtree)',
              sql: 'SELECT COUNT(*) as count FROM team_converge_results WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 1,
              after: 0,
            },
            {
              label: 'target turn team_messages deleted (root + child subtree)',
              sql: 'SELECT COUNT(*) as count FROM team_messages WHERE client_request_id = ?',
              params: [targetRequestId],
              before: 2,
              after: 0,
            },
            {
              label: 'earlier turn message_v2 rows survive',
              sql: 'SELECT COUNT(*) as count FROM message_v2 WHERE id IN (?, ?)',
              params: [earlierUserMessageId, earlierAssistantMessageId],
              before: 2,
              after: 2,
            },
            {
              label: 'earlier turn part_v2 rows survive',
              sql: 'SELECT COUNT(*) as count FROM part_v2 WHERE message_id IN (?, ?)',
              params: [earlierUserMessageId, earlierAssistantMessageId],
              before: 2,
              after: 2,
            },
            {
              label: 'earlier turn session_messages rows survive',
              sql: 'SELECT COUNT(*) as count FROM session_messages WHERE id IN (?, ?)',
              params: [earlierUserMessageId, earlierAssistantMessageId],
              before: 2,
              after: 2,
            },
            {
              label: 'earlier turn session_run_events survive',
              sql: `SELECT COUNT(*) as count FROM session_run_events
                  WHERE session_id = ? AND client_request_id = ?`,
              params: [rootSessionId, earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn session_entry survives',
              sql: `SELECT COUNT(*) as count FROM session_entry
                  WHERE session_id = ? AND client_request_id = ?`,
              params: [rootSessionId, earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn session_file_diffs survive',
              sql: 'SELECT COUNT(*) as count FROM session_file_diffs WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn session_snapshots survive',
              sql: 'SELECT COUNT(*) as count FROM session_snapshots WHERE client_request_id = ?',
              params: [createRequestSnapshotRef(earlierRequestId)],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn handoff_records survive',
              sql: 'SELECT COUNT(*) as count FROM handoff_records WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn team_usage_records survive',
              sql: 'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn team_tool_call_records survive',
              sql: 'SELECT COUNT(*) as count FROM team_tool_call_records WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn team_audit_logs survive',
              sql: 'SELECT COUNT(*) as count FROM team_audit_logs WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn team_converge_results survive',
              sql: 'SELECT COUNT(*) as count FROM team_converge_results WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'earlier turn team_messages survive',
              sql: 'SELECT COUNT(*) as count FROM team_messages WHERE client_request_id = ?',
              params: [earlierRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session message_v2 rows untouched',
              sql: 'SELECT COUNT(*) as count FROM message_v2 WHERE session_id = ?',
              params: [unrelatedSessionId],
              before: 2,
              after: 2,
            },
            {
              label: 'unrelated session session_run_events untouched',
              sql: 'SELECT COUNT(*) as count FROM session_run_events WHERE session_id = ?',
              params: [unrelatedSessionId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session session_entry untouched',
              sql: 'SELECT COUNT(*) as count FROM session_entry WHERE session_id = ?',
              params: [unrelatedSessionId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session session_file_diffs untouched',
              sql: 'SELECT COUNT(*) as count FROM session_file_diffs WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session handoff_records untouched',
              sql: 'SELECT COUNT(*) as count FROM handoff_records WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session team_usage_records untouched',
              sql: 'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session team_tool_call_records untouched',
              sql: 'SELECT COUNT(*) as count FROM team_tool_call_records WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session team_audit_logs untouched',
              sql: 'SELECT COUNT(*) as count FROM team_audit_logs WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session team_converge_results untouched',
              sql: 'SELECT COUNT(*) as count FROM team_converge_results WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
            {
              label: 'unrelated session team_messages untouched',
              sql: 'SELECT COUNT(*) as count FROM team_messages WHERE client_request_id = ?',
              params: [otherRequestId],
              before: 1,
              after: 1,
            },
          ];

          for (const expectation of expectations) {
            assertRowCount(expectation, 'seeded');
          }

          // ─── 执行回退：回退 TARGET 回合（含）之后的一切 ───
          const rollbackStartMs = Date.now();
          const rollbackWarnings: string[] = [];
          const originalConsoleWarn = console.warn;
          const result = await (async () => {
            console.warn = (...args: unknown[]): void => {
              rollbackWarnings.push(args.map((arg) => String(arg)).join(' '));
            };
            try {
              return await rollbackSessionTurn({
                sessionId: rootSessionId,
                userId,
                messageId: targetUserMessageId,
                messageText: 'target turn user message',
              });
            } finally {
              console.warn = originalConsoleWarn;
            }
          })();
          const rollback = result.rollback;

          // ─── receipt 自洽性 ───
          assert(
            rollback.applied !== false,
            `real rollback must be broadcast-eligible (applied must be absent/true, got ${String(
              rollback.applied,
            )})`,
          );
          assert(
            rollback.sessionId === rootSessionId,
            `receipt.sessionId must be the rolled-back session (expected ${rootSessionId}, got ${rollback.sessionId})`,
          );
          assert(
            rollback.cutoffMessageId === targetUserMessageId,
            `receipt.cutoffMessageId must be the requested cutoff (expected ${targetUserMessageId}, got ${rollback.cutoffMessageId})`,
          );
          assert(
            rollback.cutoffTimeMs > 0,
            `receipt.cutoffTimeMs must be positive, got ${rollback.cutoffTimeMs}`,
          );
          assert(
            rollback.cutoffTimeMs === targetUserCreatedAt,
            `receipt.cutoffTimeMs must equal the first removed message time_created (expected ${targetUserCreatedAt}, got ${rollback.cutoffTimeMs})`,
          );
          assert(
            rollback.tombstoneAtMs >= rollback.cutoffTimeMs,
            `receipt.tombstoneAtMs must be >= cutoffTimeMs (cutoff=${rollback.cutoffTimeMs}, tombstone=${rollback.tombstoneAtMs})`,
          );
          assert(
            rollback.tombstoneAtMs >= rollbackStartMs,
            `receipt.tombstoneAtMs must be captured at rollback time (rollbackStart=${rollbackStartMs}, tombstone=${rollback.tombstoneAtMs})`,
          );
          assert(
            rollback.removedMessageIds.length === 2 &&
              rollback.removedMessageIds.includes(targetUserMessageId) &&
              rollback.removedMessageIds.includes(targetAssistantMessageId),
            `receipt.removedMessageIds must contain exactly the target turn messages, got [${rollback.removedMessageIds.join(', ')}]`,
          );
          assert(
            !rollback.removedMessageIds.includes(earlierUserMessageId) &&
              !rollback.removedMessageIds.includes(earlierAssistantMessageId),
            `receipt.removedMessageIds must not contain earlier turn messages, got [${rollback.removedMessageIds.join(', ')}]`,
          );
          assert(
            rollback.invalidatedClientRequestIds.includes(targetRequestId) &&
              rollback.invalidatedClientRequestIds.includes(targetAssistantRequestId),
            `receipt.invalidatedClientRequestIds must contain the target turn ids, got [${rollback.invalidatedClientRequestIds.join(', ')}]`,
          );
          assert(
            !rollback.invalidatedClientRequestIds.includes(earlierRequestId),
            `receipt.invalidatedClientRequestIds must not contain the earlier turn id, got [${rollback.invalidatedClientRequestIds.join(', ')}]`,
          );
          assert(
            rollback.affectedSessionIds.includes(rootSessionId) &&
              rollback.affectedSessionIds.includes(childSessionId),
            `receipt.affectedSessionIds must include the root and child sessions, got [${rollback.affectedSessionIds.join(', ')}]`,
          );
          assert(
            !rollback.affectedSessionIds.includes(unrelatedSessionId),
            `receipt.affectedSessionIds must not include the unrelated session, got [${rollback.affectedSessionIds.join(', ')}]`,
          );

          // ─── 返回消息列表（向后兼容）───
          assert(
            result.messages.every(
              (message) =>
                message.id !== targetUserMessageId && message.id !== targetAssistantMessageId,
            ),
            'returned messages must not contain rolled-back target turn messages',
          );
          assert(
            result.messages.some((message) => message.id === earlierUserMessageId) &&
              result.messages.some((message) => message.id === earlierAssistantMessageId),
            'returned messages must still contain the earlier turn messages',
          );

          // ─── 行级断言：目标清除 + 存活行零误伤 ───
          for (const expectation of expectations) {
            assertRowCount(expectation, 'after rollback');
          }

          // ─── GAP A：turn_rollback 权威痕迹必须存在、回合键为 NULL、指认被作废回合 ───
          const rollbackAudit = sqliteGet<{
            action: string;
            client_request_id: string | null;
            detail: string | null;
            entity_id: string;
            entity_type: string;
            id: number;
            session_id: string | null;
          }>(
            `SELECT id, action, client_request_id, detail, entity_id, entity_type, session_id
               FROM team_audit_logs
              WHERE session_id = ? AND action = 'turn_rollback' AND client_request_id IS NULL
              ORDER BY id DESC
              LIMIT 1`,
            [rootSessionId],
          );
          assert(rollbackAudit !== undefined, 'rollback must write a turn_rollback audit row');
          assert(
            rollbackAudit.client_request_id === null,
            `turn_rollback audit row must keep a NULL client_request_id (got ${String(
              rollbackAudit.client_request_id,
            )})`,
          );
          assert(
            rollbackAudit.entity_type === 'session' && rollbackAudit.entity_id === rootSessionId,
            `turn_rollback audit row must be attributed to the rolled-back session (got ${rollbackAudit.entity_type}/${rollbackAudit.entity_id})`,
          );
          const rollbackAuditDetail = parseAuditDetail(rollbackAudit.detail);
          assert(
            rollbackAuditDetail['cutoffMessageId'] === targetUserMessageId,
            `turn_rollback audit detail must reference the cutoff message (got ${String(
              rollbackAuditDetail['cutoffMessageId'],
            )})`,
          );
          assert(
            rollbackAuditDetail['tombstoneAtMs'] === rollback.tombstoneAtMs,
            `turn_rollback audit detail must reference the receipt tombstone (expected ${rollback.tombstoneAtMs}, got ${String(
              rollbackAuditDetail['tombstoneAtMs'],
            )})`,
          );
          assert(
            rollbackAuditDetail['removedMessageCount'] === 2,
            `turn_rollback audit detail must record the removed message count (got ${String(
              rollbackAuditDetail['removedMessageCount'],
            )})`,
          );
          const auditedRequestIds = readStringArrayField(
            rollbackAuditDetail,
            'invalidatedClientRequestIds',
          );
          assert(
            auditedRequestIds.includes(targetRequestId) &&
              auditedRequestIds.includes(targetAssistantRequestId),
            `turn_rollback audit detail must reference the voided turn request ids, got [${auditedRequestIds.join(
              ', ',
            )}]`,
          );
          assert(
            !auditedRequestIds.includes(earlierRequestId),
            `turn_rollback audit detail must not reference surviving turns, got [${auditedRequestIds.join(
              ', ',
            )}]`,
          );
          const auditedSessionIds = readStringArrayField(rollbackAuditDetail, 'affectedSessionIds');
          assert(
            auditedSessionIds.includes(rootSessionId) && auditedSessionIds.includes(childSessionId),
            `turn_rollback audit detail must record the affected subtree, got [${auditedSessionIds.join(
              ', ',
            )}]`,
          );

          // ─── GAP B + C10 + H3：文件任务图按回合清理 ───
          // 具体断言（含图级无悬挂引用扫描与后续回合父链保留）见
          // verify-team-turn-rollback-task-graph.ts。
          const taskStore = new AgentTaskStoreImpl();
          const rootGraphAfterRollback = await taskStore.load(taskProjectRoot, rootSessionId);
          assertTaskGraphPurgeOutcome({
            graph: rootGraphAfterRollback,
            removedTaskId: voidedTask.id,
            survivorTaskId: survivorTask.id,
            survivorChildTaskId: survivorChildTask.id,
            survivorBlocksRefTaskId: survivorBlocksRefTask.id,
            survivorGrandchildTaskId: survivorGrandchildTask.id,
            emptyChildGraphPath: path.join(
              taskProjectRoot,
              '.agentdocs',
              'tasks',
              `${childSessionId}.json`,
            ),
            corruptGraphPath,
            rollbackWarnings,
          });

          // ─── S1 pending 交互：置终态、不删行，且只命中被回退回合 ───
          const targetPermission = sqliteGet<{ status: string; decision: string | null }>(
            'SELECT status, decision FROM permission_requests WHERE id = ?',
            [targetPermissionRequestId],
          );
          assert(
            targetPermission !== undefined,
            'target permission_requests row must still exist (terminal status, not deleted)',
          );
          assert(
            targetPermission.status === 'rejected' && targetPermission.decision === 'reject',
            `target permission must be rejected (expected status=rejected/decision=reject, got status=${targetPermission.status}/decision=${String(targetPermission.decision)})`,
          );
          const earlierPermission = sqliteGet<{ status: string }>(
            'SELECT status FROM permission_requests WHERE id = ?',
            [earlierPermissionRequestId],
          );
          assert(
            earlierPermission?.status === 'pending',
            `earlier permission must stay pending (got ${String(earlierPermission?.status)})`,
          );
          const targetQuestion = sqliteGet<{ status: string }>(
            'SELECT status FROM question_requests WHERE id = ?',
            [targetQuestionRequestId],
          );
          assert(
            targetQuestion !== undefined,
            'target question_requests row must still exist (terminal status, not deleted)',
          );
          assert(
            targetQuestion.status === 'dismissed',
            `target question must be dismissed (expected dismissed, got ${targetQuestion.status})`,
          );
          const earlierQuestion = sqliteGet<{ status: string }>(
            'SELECT status FROM question_requests WHERE id = ?',
            [earlierQuestionRequestId],
          );
          assert(
            earlierQuestion?.status === 'pending',
            `earlier question must stay pending (got ${String(earlierQuestion?.status)})`,
          );

          // ─── D2：子树内 running 子会话 / handoff 被级联取消 ───
          const childSession = sqliteGet<{ substate: string | null }>(
            'SELECT substate FROM sessions WHERE id = ?',
            [childSessionId],
          );
          assert(
            childSession?.substate === 'cancelled',
            `running child session must be cascade-cancelled (expected substate=cancelled, got ${String(
              childSession?.substate,
            )})`,
          );
          const earlierHandoff = sqliteGet<{ state: string }>(
            'SELECT state FROM handoff_records WHERE id = ?',
            [earlierHandoffId],
          );
          assert(
            earlierHandoff !== undefined,
            'earlier turn handoff row must survive the rollback (no over-deletion)',
          );
          assert(
            earlierHandoff.state === 'cancelled',
            `running handoff inside the affected subtree must be cascade-cancelled (expected cancelled, got ${earlierHandoff.state})`,
          );
          const otherHandoff = sqliteGet<{ state: string }>(
            'SELECT state FROM handoff_records WHERE id = ?',
            [otherHandoffId],
          );
          assert(
            otherHandoff?.state === 'running',
            `handoff outside the affected subtree must stay running (got ${String(otherHandoff?.state)})`,
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM sessions WHERE id IN (?, ?)', [
              rootSessionId,
              childSessionId,
            ]) === 2,
            'rollback must not delete sessions',
          );

          // ─── 外键完整性 ───
          const foreignKeyViolations = sqliteAll<Record<string, unknown>>(
            'PRAGMA foreign_key_check',
          );
          assert(
            foreignKeyViolations.length === 0,
            `PRAGMA foreign_key_check must return no rows, got ${foreignKeyViolations.length}`,
          );

          // ─── 幂等：同一 cutoffMessageId 重复回退不抛错、不二次删除 ───
          const second = await rollbackSessionTurn({
            sessionId: rootSessionId,
            userId,
            messageId: targetUserMessageId,
            messageText: 'target turn user message',
          });
          assert(
            second.rollback.removedMessageIds.length === 0,
            `second rollback must not remove any message, got [${second.rollback.removedMessageIds.join(', ')}]`,
          );
          assert(
            second.rollback.invalidatedClientRequestIds.length === 0,
            `second rollback must not invalidate any client request, got [${second.rollback.invalidatedClientRequestIds.join(', ')}]`,
          );
          // no-op receipt 必须显式标记 applied=false 且窗口为空——否则路由会广播一个
          // 看似删除数据的 receipt，多标签页前端会把已有窗口右边界推到「现在」。
          assert(
            second.rollback.applied === false,
            `no-op rollback receipt must set applied=false (got ${String(second.rollback.applied)})`,
          );
          assert(
            second.rollback.cutoffTimeMs === 0 && second.rollback.tombstoneAtMs === 0,
            `no-op rollback receipt must not invent a void window (cutoff=${second.rollback.cutoffTimeMs}, tombstone=${second.rollback.tombstoneAtMs})`,
          );
          for (const expectation of expectations) {
            assertRowCount(expectation, 'after rollback');
          }
          assert(
            countRows('SELECT COUNT(*) as count FROM permission_requests WHERE id = ?', [
              earlierPermissionRequestId,
            ]) === 1,
            'second rollback must not delete unrelated permission rows',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM question_requests WHERE id = ?', [
              earlierQuestionRequestId,
            ]) === 1,
            'second rollback must not delete unrelated question rows',
          );

          // ─── GAP A：权威痕迹在幂等重放后仍存活（NULL 回合键不会被按回合删除命中）───
          assert(
            sqliteGet<{ id: number }>('SELECT id FROM team_audit_logs WHERE id = ?', [
              rollbackAudit.id,
            ]) !== undefined,
            `turn_rollback audit row must survive the idempotent repeat rollback (id=${rollbackAudit.id})`,
          );
          assert(
            countRows(
              `SELECT COUNT(*) as count FROM team_audit_logs
                WHERE session_id = ? AND action = 'turn_rollback' AND client_request_id IS NULL`,
              [rootSessionId],
            ) === 1,
            'idempotent repeat rollback must not duplicate the turn_rollback audit row',
          );

          // ─── Phase 1 写入链路：真实写入函数必须自带回合键（含父 handoff 继承）───
          //
          // 上面的 S3 断言只证明「按回合删除」正确；若真实写入路径落 NULL，生产环境
          // 仍会匹配不到。这里改用真实写入函数落库并断言，闭合该验证盲区。
          const writeRootSessionId = randomUUID();
          const writeChildSessionId = randomUUID();
          const writeTurnId = `turn-write-${randomUUID()}`;
          sqliteRun(
            `INSERT INTO sessions (id, user_id, messages_json, state_status, metadata_json, role_layer)
             VALUES (?, ?, '[]', 'idle', ?, 'reception')`,
            [writeRootSessionId, userId, JSON.stringify({ workingDirectory: workspaceRoot })],
          );
          sqliteRun(
            `INSERT INTO sessions
             (id, user_id, messages_json, state_status, metadata_json, role_layer, team_parent_session_id)
             VALUES (?, ?, '[]', 'idle', '{}', 'pm1', ?)`,
            [writeChildSessionId, userId, writeRootSessionId],
          );

          // 1) reception→pm1：显式回合键直传
          const writeParentHandoff = createHandoff({
            userId,
            fromSessionId: writeRootSessionId,
            fromRoleLayer: 'reception',
            toRoleLayer: 'pm1',
            clientRequestId: writeTurnId,
            payload: { sourceIntent: 'write path turn' },
          });
          assert(
            writeParentHandoff.clientRequestId === writeTurnId,
            `createHandoff explicit turn id must round-trip (expected ${writeTurnId}, got ${String(writeParentHandoff.clientRequestId)})`,
          );
          const writeParentRow = sqliteGet<{ client_request_id: string | null }>(
            'SELECT client_request_id FROM handoff_records WHERE id = ?',
            [writeParentHandoff.id],
          );
          assert(
            writeParentRow?.client_request_id === writeTurnId,
            `createHandoff explicit turn id must persist (expected ${writeTurnId}, got ${String(writeParentRow?.client_request_id)})`,
          );

          // 2) 派发：claim + start 写入 to_session_id，形成子 handoff 的父指针
          const writeClaimToken = randomUUID();
          assert(
            claimHandoff({ handoffId: writeParentHandoff.id, claimToken: writeClaimToken }) !==
              null,
            'parent handoff must be claimable for the inheritance fixture',
          );
          assert(
            startHandoff({
              handoffId: writeParentHandoff.id,
              claimToken: writeClaimToken,
              toSessionId: writeChildSessionId,
            }),
            'parent handoff must start and bind to_session_id for the inheritance fixture',
          );
          assert(
            resolveSessionTurnClientRequestId(writeChildSessionId) === writeTurnId,
            'resolveSessionTurnClientRequestId must read the parent handoff turn id',
          );

          // C9.1：终态父 handoff 不得被继承（详见 verify-team-turn-rollback-resolver.ts）。
          verifyActiveOnlyResolverTurnInheritance({
            userId,
            fromSessionId: writeRootSessionId,
          });
          // H4：会话自身的真实回合键优先于活跃父 handoff 继承。
          verifyTurnKeyOwnershipPrecedence({ userId });

          // 3) pm1→pm2：不传回合键 → 从父 handoff 继承
          const writeChildHandoff = createHandoff({
            userId,
            fromSessionId: writeChildSessionId,
            fromRoleLayer: 'pm1',
            toRoleLayer: 'pm2',
            payload: { resultJson: null },
          });
          assert(
            writeChildHandoff.clientRequestId === writeTurnId,
            `descendant handoff must inherit the parent turn id (expected ${writeTurnId}, got ${String(writeChildHandoff.clientRequestId)})`,
          );
          assert(
            sqliteGet<{ client_request_id: string | null }>(
              'SELECT client_request_id FROM handoff_records WHERE id = ?',
              [writeChildHandoff.id],
            )?.client_request_id === writeTurnId,
            'descendant handoff inheritance must persist to client_request_id',
          );

          // 4) 审计：回合级带键；团队级（分享）保持 NULL
          const writeTurnAuditEntityId = randomUUID();
          const teamLevelAuditEntityId = `team-level-${randomUUID()}`;
          logTeamAudit({
            action: 'handoff_control',
            entityType: 'handoff',
            entityId: writeTurnAuditEntityId,
            sessionId: writeChildSessionId,
            summary: 'write path turn audit',
            userId,
            clientRequestId: writeTurnId,
          });
          logTeamAudit({
            action: 'share_created',
            entityType: 'session_share',
            entityId: teamLevelAuditEntityId,
            sessionId: null,
            summary: 'write path team-level audit',
            userId,
          });
          assert(
            sqliteGet<{ client_request_id: string | null }>(
              'SELECT client_request_id FROM team_audit_logs WHERE entity_id = ?',
              [writeTurnAuditEntityId],
            )?.client_request_id === writeTurnId,
            'logTeamAudit must persist the turn id',
          );
          assert(
            sqliteGet<{ client_request_id: string | null }>(
              'SELECT client_request_id FROM team_audit_logs WHERE entity_id = ?',
              [teamLevelAuditEntityId],
            )?.client_request_id === null,
            'team-level audit must keep a NULL turn id',
          );

          // 5) usage / tool call / timing：真实发布器按父 handoff 继承回合键；
          //    reception（无父 handoff）用显式回合键兜底。
          const writeSessionContext = { metadataJson: '{}', roleLayer: 'pm2' };
          publishTeamUsageEvent({
            userId,
            sessionId: writeChildSessionId,
            sessionContext: writeSessionContext,
            round: 1,
            provider: 'openai',
            model: 'gpt-write-path',
            inputTokens: 7,
            outputTokens: 8,
          });
          publishTeamToolCallEvent({
            userId,
            sessionId: writeChildSessionId,
            sessionContext: writeSessionContext,
            toolName: 'write',
            durationMs: 11,
            success: true,
          });
          publishTeamTimingEvent({
            userId,
            sessionId: writeChildSessionId,
            sessionContext: writeSessionContext,
            round: 1,
            totalMs: 33,
            provider: 'openai',
            model: 'gpt-write-path',
          });
          publishTeamWorkflowUsageEvent({
            userId,
            sessionId: writeRootSessionId,
            layer: 'reception',
            provider: 'openai',
            model: 'gpt-write-path',
            inputTokens: 3,
            outputTokens: 4,
            clientRequestId: writeTurnId,
          });
          // usage 与 timing 同聚合键合并为 1 行，tool call 计数行 1 行，reception 1 行。
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              [writeTurnId],
            ) === 3,
            `real usage/timing writes must be tagged with the turn id (expected 3 aggregate rows, got ${countRows(
              'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              [writeTurnId],
            )})`,
          );
          assert(
            countRows(
              `SELECT COUNT(*) as count FROM team_usage_records
                WHERE session_id IN (?, ?) AND (client_request_id IS NULL OR client_request_id = '')`,
              [writeRootSessionId, writeChildSessionId],
            ) === 0,
            'real usage writes must not fall back to NULL/empty turn ids',
          );
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_tool_call_records WHERE client_request_id = ?',
              [writeTurnId],
            ) === 1,
            'real tool-call writes must be tagged with the turn id',
          );

          // 6) converge + team message：显式回合键直传
          const writeConvergeResult: ConvergeResult = {
            deviations: [],
            evaluatedArtifacts: [],
            timestamp: Date.now(),
            durationMs: 1,
            hasCriticalDeviations: false,
            report: 'write path converge',
          };
          recordConvergeResult(randomUUID(), writeChildSessionId, writeConvergeResult, writeTurnId);
          appendTeamMessage({
            id: randomUUID(),
            userId,
            sessionId: writeChildSessionId,
            content: 'write path team message',
            type: 'update',
            clientRequestId: writeTurnId,
          });
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_converge_results WHERE client_request_id = ?',
              [writeTurnId],
            ) === 1,
            'recordConvergeResult must persist the turn id',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM team_messages WHERE client_request_id = ?', [
              writeTurnId,
            ]) === 1,
            'appendTeamMessage must persist the turn id',
          );

          // 7) 回退该回合：真实写入的 S3 记录必须被清除，团队级 NULL 审计必须存活
          const writeUserMessage = appendSessionMessage({
            sessionId: writeRootSessionId,
            userId,
            role: 'user',
            clientRequestId: writeTurnId,
            content: [{ type: 'text', text: 'write path turn message' }],
          });
          const writeRollback = await rollbackSessionTurn({
            sessionId: writeRootSessionId,
            userId,
            messageId: writeUserMessage.id,
            messageText: 'write path turn message',
          });
          assert(
            writeRollback.rollback.invalidatedClientRequestIds.includes(writeTurnId),
            'real-path rollback must invalidate the write-path turn id',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM handoff_records WHERE client_request_id = ?', [
              writeTurnId,
            ]) === 0,
            'rollback must delete handoffs written through the real path',
          );
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_usage_records WHERE client_request_id = ?',
              [writeTurnId],
            ) === 0,
            'rollback must delete usage rows written through the real path',
          );
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_tool_call_records WHERE client_request_id = ?',
              [writeTurnId],
            ) === 0,
            'rollback must delete tool-call rows written through the real path',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM team_audit_logs WHERE client_request_id = ?', [
              writeTurnId,
            ]) === 0,
            'rollback must delete audit rows written through the real path',
          );
          assert(
            countRows(
              'SELECT COUNT(*) as count FROM team_converge_results WHERE client_request_id = ?',
              [writeTurnId],
            ) === 0,
            'rollback must delete converge rows written through the real path',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM team_messages WHERE client_request_id = ?', [
              writeTurnId,
            ]) === 0,
            'rollback must delete team messages written through the real path',
          );
          assert(
            countRows('SELECT COUNT(*) as count FROM team_audit_logs WHERE entity_id = ?', [
              teamLevelAuditEntityId,
            ]) === 1,
            'team-level audit (NULL turn id) must survive the rollback',
          );
          const writeRollbackAudit = sqliteGet<{
            client_request_id: string | null;
            detail: string | null;
          }>(
            `SELECT client_request_id, detail FROM team_audit_logs
              WHERE session_id = ? AND action = 'turn_rollback' AND client_request_id IS NULL
              ORDER BY id DESC
              LIMIT 1`,
            [writeRootSessionId],
          );
          assert(
            writeRollbackAudit !== undefined && writeRollbackAudit.client_request_id === null,
            'real-path rollback must leave a NULL-keyed turn_rollback audit row',
          );
          assert(
            readStringArrayField(
              parseAuditDetail(writeRollbackAudit?.detail ?? null),
              'invalidatedClientRequestIds',
            ).includes(writeTurnId),
            `real-path rollback audit detail must reference the voided write-path turn id (${writeTurnId})`,
          );
          // ─── 加固项验收（H1 / H2 / H4-publisher / W2），夹具独立于上面的行数期望表 ───
          verifyDeleteHelpersAreUserScoped();
          await verifyRollbackScopeCap();
          await verifyDirectSendTurnKeyPrecedence();
          await verifyTurnLessWritesSurviveRollback();
          // ─── W1 链式派发 / W3 内部键命名空间，验收夹具同样独立 ───
          await verifyChainedDispatchCarriesTurnKey();
          await verifyDegradedChainCarriesTurnKey();
          verifyInternalRequestKeyGuard();

          assert(
            sqliteAll<Record<string, unknown>>('PRAGMA foreign_key_check').length === 0,
            'PRAGMA foreign_key_check must stay clean after the real-path rollback',
          );

          console.log('verify-team-turn-rollback: ok');
        } finally {
          await closeDb();
        }
      },
    );
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error('verify-team-turn-rollback: failed');
  console.error(error);
  process.exitCode = 1;
});
