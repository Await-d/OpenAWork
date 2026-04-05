import { sqliteAll, sqliteRun } from './db.js';

const ACTIVE_VIEWER_WINDOW_MS = 90_000;

interface SharedSessionPresenceRow {
  first_seen_at_ms: number;
  last_seen_at_ms: number;
  viewer_email: string;
  viewer_user_id: string;
}

export interface SharedSessionPresenceRecord {
  active: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  viewerEmail: string;
  viewerUserId: string;
}

function toIso(timestampMs: number): string {
  return new Date(timestampMs).toISOString();
}

function mapSharedSessionPresenceRow(
  row: SharedSessionPresenceRow,
  nowMs: number,
): SharedSessionPresenceRecord {
  return {
    active: nowMs - row.last_seen_at_ms <= ACTIVE_VIEWER_WINDOW_MS,
    firstSeenAt: toIso(row.first_seen_at_ms),
    lastSeenAt: toIso(row.last_seen_at_ms),
    viewerEmail: row.viewer_email,
    viewerUserId: row.viewer_user_id,
  };
}

function pruneRevokedSharedSessionPresence(input: {
  ownerUserId: string;
  sessionId: string;
}): void {
  sqliteRun(
    `DELETE FROM shared_session_presence
     WHERE owner_user_id = ?
       AND session_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM session_shares ss
         JOIN team_members tm ON tm.id = ss.member_id
         WHERE ss.user_id = shared_session_presence.owner_user_id
           AND ss.session_id = shared_session_presence.session_id
           AND lower(tm.email) = lower(shared_session_presence.viewer_email)
       )`,
    [input.ownerUserId, input.sessionId],
  );
}

export function listSharedSessionPresence(input: {
  limit?: number;
  nowMs?: number;
  ownerUserId: string;
  sessionId: string;
}): SharedSessionPresenceRecord[] {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit ?? 8;
  pruneRevokedSharedSessionPresence({
    ownerUserId: input.ownerUserId,
    sessionId: input.sessionId,
  });
  const rows = sqliteAll<SharedSessionPresenceRow>(
    `SELECT viewer_user_id, viewer_email, first_seen_at_ms, last_seen_at_ms
     FROM shared_session_presence
     WHERE owner_user_id = ? AND session_id = ?
     ORDER BY last_seen_at_ms DESC
     LIMIT ?`,
    [input.ownerUserId, input.sessionId, limit],
  );

  return rows.map((row) => mapSharedSessionPresenceRow(row, nowMs));
}

export function touchSharedSessionPresence(input: {
  nowMs?: number;
  ownerUserId: string;
  sessionId: string;
  viewerEmail: string;
  viewerUserId: string;
}): SharedSessionPresenceRecord[] {
  const nowMs = input.nowMs ?? Date.now();
  sqliteRun(
    `INSERT INTO shared_session_presence (
       owner_user_id,
       session_id,
       viewer_user_id,
       viewer_email,
       first_seen_at_ms,
       last_seen_at_ms
     ) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(owner_user_id, session_id, viewer_user_id)
     DO UPDATE SET viewer_email = excluded.viewer_email, last_seen_at_ms = excluded.last_seen_at_ms`,
    [input.ownerUserId, input.sessionId, input.viewerUserId, input.viewerEmail, nowMs, nowMs],
  );

  return listSharedSessionPresence({
    nowMs,
    ownerUserId: input.ownerUserId,
    sessionId: input.sessionId,
  });
}
