import { sqliteAll, sqliteGet } from './db.js';
import { sanitizeSessionMetadataJson } from './session-workspace-metadata.js';
import { resolveSessionWorkspacePath } from './session-workspace-resolution.js';

type SharedSessionPermission = 'view' | 'comment' | 'operate';

interface SharedSessionRow {
  messages_json: string;
  owner_user_id: string;
  permission: SharedSessionPermission;
  session_created_at: string;
  session_id: string;
  session_metadata_json: string;
  session_state_status: string;
  session_title: string | null;
  session_updated_at: string;
  share_created_at: string;
  share_updated_at: string;
  shared_by_email: string;
}

export interface SharedSessionAccessRecord {
  messagesJson: string;
  ownerUserId: string;
  permission: SharedSessionPermission;
  session: {
    createdAt: string;
    id: string;
    metadataJson: string;
    stateStatus: string;
    title: string | null;
    updatedAt: string;
    workspacePath: string | null;
  };
  shareCreatedAt: string;
  shareUpdatedAt: string;
  sharedByEmail: string;
}

const BASE_SHARED_SESSION_SELECT = `SELECT
  sess.id AS session_id,
  sess.messages_json AS messages_json,
  sess.state_status AS session_state_status,
  sess.metadata_json AS session_metadata_json,
  sess.title AS session_title,
  sess.created_at AS session_created_at,
  sess.updated_at AS session_updated_at,
  ss.user_id AS owner_user_id,
  ss.permission AS permission,
  ss.created_at AS share_created_at,
  ss.updated_at AS share_updated_at,
  owner.email AS shared_by_email
FROM session_shares ss
JOIN team_members tm ON tm.id = ss.member_id
JOIN sessions sess ON sess.id = ss.session_id AND sess.user_id = ss.user_id
JOIN users owner ON owner.id = ss.user_id`;

function mapSharedSessionRow(row: SharedSessionRow): SharedSessionAccessRecord {
  const metadataJson = sanitizeSessionMetadataJson(row.session_metadata_json);
  return {
    messagesJson: row.messages_json,
    ownerUserId: row.owner_user_id,
    permission: row.permission,
    session: {
      createdAt: row.session_created_at,
      id: row.session_id,
      metadataJson,
      stateStatus: row.session_state_status,
      title: row.session_title,
      updatedAt: row.session_updated_at,
      workspacePath: resolveSessionWorkspacePath({
        metadataJson,
        sessionId: row.session_id,
        userId: row.owner_user_id,
      }),
    },
    shareCreatedAt: row.share_created_at,
    shareUpdatedAt: row.share_updated_at,
    sharedByEmail: row.shared_by_email,
  };
}

export function listSharedSessionsForRecipient(input: {
  email: string;
  limit: number;
  offset: number;
}): SharedSessionAccessRecord[] {
  const rows = sqliteAll<SharedSessionRow>(
    `${BASE_SHARED_SESSION_SELECT}
     WHERE lower(tm.email) = lower(?)
     ORDER BY ss.updated_at DESC, ss.id DESC
     LIMIT ? OFFSET ?`,
    [input.email, input.limit, input.offset],
  );

  return rows.map(mapSharedSessionRow);
}

export function getSharedSessionForRecipient(input: {
  email: string;
  sessionId: string;
}): SharedSessionAccessRecord | null {
  const row = sqliteGet<SharedSessionRow>(
    `${BASE_SHARED_SESSION_SELECT}
     WHERE sess.id = ? AND lower(tm.email) = lower(?)
     LIMIT 1`,
    [input.sessionId, input.email],
  );

  return row ? mapSharedSessionRow(row) : null;
}
