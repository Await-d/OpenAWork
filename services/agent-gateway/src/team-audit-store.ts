import { sqliteAll, sqliteRun } from './db.js';

export type TeamAuditAction =
  | 'share_created'
  | 'share_deleted'
  | 'share_permission_updated'
  | 'shared_comment_created'
  | 'shared_permission_replied'
  | 'shared_question_replied';

export type TeamAuditEntityType =
  | 'session_share'
  | 'shared_session_comment'
  | 'permission_request'
  | 'question_request';

interface TeamAuditLogRow {
  action: TeamAuditAction;
  actor_email: string | null;
  actor_user_id: string | null;
  created_at: string;
  detail: string | null;
  entity_id: string;
  entity_type: TeamAuditEntityType;
  id: number;
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
  summary: string;
}

export function logTeamAudit(input: {
  action: TeamAuditAction;
  actorEmail?: string;
  actorUserId?: string;
  detail?: string;
  entityId: string;
  entityType: TeamAuditEntityType;
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
       summary,
       detail,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      input.userId,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.action,
      input.entityType,
      input.entityId,
      input.summary,
      input.detail ?? null,
    ],
  );
}

export function listTeamAuditLogs(input: { limit: number; userId: string }): TeamAuditLogRecord[] {
  const rows = sqliteAll<TeamAuditLogRow>(
    `SELECT id, actor_user_id, actor_email, action, entity_type, entity_id, summary, detail, created_at
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
    summary: row.summary,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
