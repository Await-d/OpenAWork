import { sqliteAll, sqliteGet, sqliteRun } from './db.js';

export type SessionMessageRatingValue = 'up' | 'down';

interface SessionMessageRatingRow {
  message_id: string;
  notes: string | null;
  rating: SessionMessageRatingValue;
  reason: string | null;
  updated_at: string;
}

export interface SessionMessageRatingRecord {
  messageId: string;
  notes: string | null;
  rating: SessionMessageRatingValue;
  reason: string | null;
  updatedAt: string;
}

export function listSessionMessageRatings(input: {
  sessionId: string;
  userId: string;
}): SessionMessageRatingRecord[] {
  return sqliteAll<SessionMessageRatingRow>(
    `SELECT message_id, rating, reason, notes, updated_at
     FROM message_ratings
     WHERE session_id = ? AND user_id = ?
     ORDER BY updated_at DESC, id DESC`,
    [input.sessionId, input.userId],
  ).map((row) => ({
    messageId: row.message_id,
    notes: row.notes,
    rating: row.rating,
    reason: row.reason,
    updatedAt: row.updated_at,
  }));
}

export function getSessionMessageRating(input: {
  messageId: string;
  sessionId: string;
  userId: string;
}): SessionMessageRatingRecord | null {
  const row = sqliteGet<SessionMessageRatingRow>(
    `SELECT message_id, rating, reason, notes, updated_at
     FROM message_ratings
     WHERE session_id = ? AND user_id = ? AND message_id = ?
     LIMIT 1`,
    [input.sessionId, input.userId, input.messageId],
  );
  return row
    ? {
        messageId: row.message_id,
        notes: row.notes,
        rating: row.rating,
        reason: row.reason,
        updatedAt: row.updated_at,
      }
    : null;
}

export function upsertSessionMessageRating(input: {
  messageId: string;
  notes?: string | null;
  rating: SessionMessageRatingValue;
  reason?: string | null;
  sessionId: string;
  userId: string;
}): SessionMessageRatingRecord {
  sqliteRun(
    `INSERT INTO message_ratings (session_id, user_id, message_id, rating, reason, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(session_id, user_id, message_id)
     DO UPDATE SET rating = excluded.rating, reason = excluded.reason, notes = excluded.notes, updated_at = datetime('now')`,
    [
      input.sessionId,
      input.userId,
      input.messageId,
      input.rating,
      input.reason ?? null,
      input.notes ?? null,
    ],
  );

  return (
    getSessionMessageRating({
      messageId: input.messageId,
      sessionId: input.sessionId,
      userId: input.userId,
    }) ?? {
      messageId: input.messageId,
      notes: input.notes ?? null,
      rating: input.rating,
      reason: input.reason ?? null,
      updatedAt: new Date().toISOString(),
    }
  );
}

export function deleteSessionMessageRating(input: {
  messageId: string;
  sessionId: string;
  userId: string;
}): void {
  sqliteRun('DELETE FROM message_ratings WHERE session_id = ? AND user_id = ? AND message_id = ?', [
    input.sessionId,
    input.userId,
    input.messageId,
  ]);
}

export function hasSessionMessage(input: {
  messageId: string;
  sessionId: string;
  userId: string;
}): boolean {
  return Boolean(
    sqliteGet<{ id: string }>(
      'SELECT id FROM session_messages WHERE session_id = ? AND user_id = ? AND id = ? LIMIT 1',
      [input.sessionId, input.userId, input.messageId],
    )?.id,
  );
}
