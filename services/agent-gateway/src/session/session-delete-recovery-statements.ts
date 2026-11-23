/**
 * Pure-data list of recovery SQL statements consumed by
 * `deleteSessionWithMalformedRecovery`. Kept in a dependency-free
 * module so it can be unit-tested without pulling in the SQLite
 * driver or the gateway db singleton.
 */

import {
  buildDeleteOrphanedChannelChatMemoriesSql,
  buildDeleteOrphanedChannelChatRulesSql,
} from '../memory/channel-chat-scope-cleanup.js';

export interface SessionDeleteRecoveryStatement {
  params: (input: {
    sessionId: string;
    userId: string;
  }) => [string] | [string, string] | [string, string, string];
  sql: string;
}

/**
 * Ordered list of SQL statements `deleteSessionWithMalformedRecovery`
 * runs with `PRAGMA foreign_keys=OFF`. Order matters: child tables
 * must come before their parents because cascades are disabled while
 * this list executes. Whenever a new session-scoped table is added
 * to the schema, append a statement here.
 */
export const SESSION_DELETE_RECOVERY_STATEMENTS: ReadonlyArray<SessionDeleteRecoveryStatement> = [
  // ── ON DELETE SET NULL → manual UPDATE (FK is off, so cascade does
  //    not fire; without these the row keeps a dangling session_id). ──
  {
    sql: 'UPDATE audit_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'UPDATE request_workflow_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Legacy v1 messages mirror ──
  {
    sql: 'DELETE FROM session_messages WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // V2 event-sourced storage. With FK off the normal CASCADE chain
  // (sessions → message_v2 → part_v2) does not fire, so the recovery
  // path purges children first, then parents, then the typed event
  // log (`session_entry`) and FTS mirror.
  {
    sql: 'DELETE FROM part_v2 WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM message_v2 WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_entry WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // `event_log` / `event_sequences` 没有指向 sessions 的外键（`aggregate_id`
  // 只是文本），FK 开 / 关都不会被级联带走；不显式删就会永久残留，且
  // `message.part.created` 事件携带完整 part（含 base64 图片）。
  {
    sql: 'DELETE FROM event_log WHERE aggregate_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM event_sequences WHERE aggregate_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_messages_fts WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Message rating + sharing rows ──
  {
    sql: 'DELETE FROM message_ratings WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM notifications WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_shares WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM shared_session_comments WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM shared_session_presence WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── Artifacts: artifact_versions FK→artifacts(id), so child rows
  //    must be removed via a subquery before the parent artifacts go. ──
  {
    sql: 'DELETE FROM artifact_versions WHERE artifact_id IN (SELECT id FROM artifacts WHERE session_id = ?)',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM artifacts WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // ── Memory extraction audit log ──
  {
    sql: 'DELETE FROM memory_extraction_logs WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_file_diffs WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_file_review_decisions WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM permission_decision_logs WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_run_events WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_runtime_threads WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_snapshots WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_file_backups WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // Shadow-git tree metadata: file entries reference snapshot_trees rows, so
  // delete the children before the parents to keep FK consistency on databases
  // running without cascade triggers.
  {
    sql: `DELETE FROM snapshot_file_entries
          WHERE snapshot_tree_id IN (
            SELECT id FROM snapshot_trees WHERE session_id = ? AND user_id = ?
          )`,
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM snapshot_trees WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM permission_requests WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM question_requests WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_todos WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM task_parent_auto_resume_contexts WHERE child_session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM task_parent_auto_resume_contexts WHERE parent_session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // ── Team / handoff 归属行：此前完全缺失，异常路径下会残留悬挂指针。
  //    语义与建表 FK 对齐：CASCADE → DELETE，SET NULL → UPDATE ... SET NULL。──
  {
    sql: 'DELETE FROM handoff_records WHERE from_session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'UPDATE handoff_records SET to_session_id = NULL WHERE to_session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM team_role_session_instances WHERE root_session_id = ? OR session_id = ?',
    params: ({ sessionId }) => [sessionId, sessionId],
  },
  {
    sql: 'DELETE FROM team_role_session_instances WHERE parent_session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_inbound_messages WHERE to_session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM team_usage_records WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM team_tool_call_records WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM team_converge_results WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'UPDATE team_messages SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'UPDATE team_audit_logs SET session_id = NULL WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  // ── 待发队列：FK 是 sessions(id) ON DELETE CASCADE，FK 关闭时不会级联，
  //    此前遗漏会留下悬挂的队列行（附件的磁盘副本由正常删除路径回收，
  //    见 routes/sessions.ts 的 deleteSessionTree；此畸形恢复路径只保证行级清理）。──
  {
    sql: 'DELETE FROM session_composer_queue WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_composer_input_history WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // ── 会话扩展（会话级安装 / MCP / 审批人 / 操作提案）：全部
  //    `REFERENCES sessions(id) ON DELETE CASCADE`（见 infra/db.ts 的建表），
  //    FK 关闭时不会级联，不显式删就永久残留。子表先于父表：
  //    `session_extension_deliveries` / `session_extension_secrets` 经
  //    `session_extension_operations` / `sessions` 间接级联，FK 关闭时同样
  //    不会被带走，必须逐表清理（deliveries 引 operations.id，secrets 引 sessions.id）。──
  {
    sql: 'DELETE FROM session_extension_deliveries WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_extension_secrets WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM session_extension_operations WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_skill_installations WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_mcp_servers WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  {
    sql: 'DELETE FROM session_extension_settings WHERE session_id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
  // `session_extension_admins` 是**用户级**审批人清单（PK: user_id + admin_user_id），
  // 不指向任何会话——与会话删除无关，故不在此清理（由用户删除路径负责）。
  // ── channel_chat 作用域记忆 / 规则（261104-渠道作用域记忆泄漏）──
  //    作用域 id 由入站来源派生（`memory_message_provenance`），记忆/规则表本身**无**
  //    sessions 外键，FK 关闭时不会被级联带走；而注入按 scope id 字符串匹配、不校验
  //    会话是否仍存在，故不显式清理会留下「删了会话仍被命中」的孤儿。只清「本会话来源
  //    派生、且已无其它会话引用」的 scope id（作用域失效），别的作用域一律不动；
  //    必须在删除 provenance 行**之前**执行（子查询要读本会话来源派生 scope）。
  {
    sql: buildDeleteOrphanedChannelChatMemoriesSql(),
    params: ({ sessionId, userId }) => [userId, sessionId, sessionId],
  },
  {
    sql: buildDeleteOrphanedChannelChatRulesSql(),
    params: ({ sessionId, userId }) => [userId, sessionId, sessionId],
  },
  // 入站来源行：FK 为 sessions(id) ON DELETE CASCADE，FK 关闭时不会级联，必须显式删，
  // 否则恢复路径下留下悬挂来源行（也供上面的作用域派生子查询在此前使用）。
  {
    sql: 'DELETE FROM memory_message_provenance WHERE session_id = ?',
    params: ({ sessionId }) => [sessionId],
  },
  {
    sql: 'DELETE FROM sessions WHERE id = ? AND user_id = ?',
    params: ({ sessionId, userId }) => [sessionId, userId],
  },
];
