import { sqliteAll, sqliteRun } from '../infra/db.js';

/**
 * team_audit_logs 是只增表：handoff 控制、共享、评论、route 决策、runtime incident
 * 等每条治理事件都会落一行，且从无裁剪。长时间运行的网关会让它无界膨胀，最终拖慢
 * `/team/runtime` 审计查询并吃满磁盘。这里按「每用户保留最近 N 条」做有界裁剪。
 *
 * 裁剪是摊销执行的：不是每次 INSERT 都跑一次 DELETE（那会让写放大一倍），而是每累计
 * `TEAM_AUDIT_PRUNE_CHECK_INTERVAL` 次插入才触发一次。因此实际行数最多比上限多出一个
 * 检查间隔，属于可接受的过冲。裁剪失败只告警、绝不影响审计写入本身。
 */
const DEFAULT_TEAM_AUDIT_MAX_ROWS_PER_USER = 2000;
export const TEAM_AUDIT_PRUNE_CHECK_INTERVAL = 50;

let teamAuditRetentionOverride: number | null = null;
const insertsSincePruneByUser = new Map<string, number>();

function resolveTeamAuditRetention(): number {
  if (teamAuditRetentionOverride !== null) {
    return teamAuditRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_TEAM_AUDIT_MAX_ROWS_PER_USER'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_TEAM_AUDIT_MAX_ROWS_PER_USER;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 视为「关闭裁剪」，与其它 env 死线开关（传非正数禁用）保持一致语义。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneTeamAuditLogs(userId: string, limit: number): void {
  // 用自增主键 id 而非 created_at 排序：created_at 是 datetime('now') 秒级精度，
  // 同秒内多条会并列；id 单调唯一，能稳定区分「最近 N 条」。
  sqliteRun(
    `DELETE FROM team_audit_logs
      WHERE user_id = ?
        AND id NOT IN (
          SELECT id FROM team_audit_logs
           WHERE user_id = ?
           ORDER BY id DESC
           LIMIT ?
        )`,
    [userId, userId, limit],
  );
}

function maybePruneTeamAuditLogs(userId: string): void {
  const limit = resolveTeamAuditRetention();
  if (limit <= 0) {
    // 裁剪关闭：不累计计数，避免重新开启后立刻触发一次大裁剪。
    insertsSincePruneByUser.delete(userId);
    return;
  }
  const pending = (insertsSincePruneByUser.get(userId) ?? 0) + 1;
  if (pending < TEAM_AUDIT_PRUNE_CHECK_INTERVAL) {
    insertsSincePruneByUser.set(userId, pending);
    return;
  }
  insertsSincePruneByUser.set(userId, 0);
  try {
    pruneTeamAuditLogs(userId, limit);
  } catch (error) {
    console.warn(
      `[team-audit-store] 裁剪 team_audit_logs 失败（user=${userId}）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** 测试用：覆盖每用户保留上限（传 null 恢复 env / 默认值）。 */
export function __setTeamAuditRetentionForTesting(limit: number | null): void {
  teamAuditRetentionOverride = limit;
}

/** 测试用：清空摊销计数状态。 */
export function __resetTeamAuditPruneStateForTesting(): void {
  insertsSincePruneByUser.clear();
}

export type TeamAuditAction =
  | 'capability_violation'
  | 'constitution_check'
  | 'quality_review'
  | 'share_created'
  | 'share_deleted'
  | 'share_permission_updated'
  | 'shared_comment_created'
  | 'shared_permission_replied'
  | 'shared_question_replied'
  | 'task_created'
  | 'escape_hatch_used'
  | 'handoff_control'
  | 'runtime_incident'
  | 'runtime_alert_control'
  | 'runtime_remediation'
  | 'route_decision';

export type TeamAuditEntityType =
  | 'artifact'
  | 'layer'
  | 'session_share'
  | 'shared_session_comment'
  | 'permission_request'
  | 'question_request'
  | 'team_task'
  | 'session_inbound_message'
  | 'handoff'
  | 'runtime_incident'
  | 'runtime_alert'
  | 'session';

interface TeamAuditLogRow {
  action: TeamAuditAction;
  actor_email: string | null;
  actor_user_id: string | null;
  created_at: string;
  detail: string | null;
  entity_id: string;
  entity_type: TeamAuditEntityType;
  id: number;
  session_id: string | null;
  summary: string;
}

export interface TeamAuditLogRecord {
  action: TeamAuditAction;
  actorEmail: string | null;
  actorUserId: string | null;
  createdAt: string;
  detail: string | null;
  entityId: string;
  entityType: TeamAuditEntityType;
  id: string;
  sessionId: string | null;
  summary: string;
}

export function logTeamAudit(input: {
  action: TeamAuditAction;
  actorEmail?: string;
  actorUserId?: string;
  detail?: string;
  entityId: string;
  entityType: TeamAuditEntityType;
  sessionId?: string | null;
  summary: string;
  userId: string;
}): void {
  sqliteRun(
    `INSERT INTO team_audit_logs (
       user_id,
       actor_user_id,
       actor_email,
       action,
       entity_type,
       entity_id,
       session_id,
       summary,
       detail,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.userId,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.sessionId ?? null,
      input.summary,
      input.detail ?? null,
    ],
  );

  maybePruneTeamAuditLogs(input.userId);
}

/** 测试用：直接落一条审计日志，便于验证 sessionId 归属字段。 */
export function __insertTeamAuditLogForTesting(input: {
  action: TeamAuditAction;
  detail?: string;
  entityId: string;
  entityType: TeamAuditEntityType;
  sessionId?: string | null;
  summary: string;
  userId: string;
}): void {
  logTeamAudit({
    action: input.action,
    detail: input.detail,
    entityId: input.entityId,
    entityType: input.entityType,
    sessionId: input.sessionId ?? null,
    summary: input.summary,
    userId: input.userId,
  });
}

export function listTeamAuditLogs(input: { limit: number; userId: string }): TeamAuditLogRecord[] {
  const rows = sqliteAll<TeamAuditLogRow>(
    `SELECT id, actor_user_id, actor_email, action, entity_type, entity_id, session_id, summary, detail, created_at
     FROM team_audit_logs
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [input.userId, input.limit],
  );

  return rows.map((row) => ({
    id: String(row.id),
    action: row.action,
    actorEmail: row.actor_email,
    actorUserId: row.actor_user_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    sessionId: row.session_id,
    summary: row.summary,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
