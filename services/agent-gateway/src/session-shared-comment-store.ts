import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';

interface SharedSessionCommentRow {
  author_email: string;
  content: string;
  created_at: string;
  id: string;
  session_id: string;
}

export interface SharedSessionCommentRecord {
  authorEmail: string;
  content: string;
  createdAt: string;
  id: string;
  sessionId: string;
}

function mapSharedSessionCommentRow(row: SharedSessionCommentRow): SharedSessionCommentRecord {
  return {
    authorEmail: row.author_email,
    content: row.content,
    createdAt: row.created_at,
    id: row.id,
    sessionId: row.session_id,
  };
}

export function listSharedSessionComments(input: {
  ownerUserId: string;
  sessionId: string;
}): SharedSessionCommentRecord[] {
  const rows = sqliteAll<SharedSessionCommentRow>(
    `SELECT id, session_id, author_email, content, created_at
     FROM shared_session_comments
     WHERE owner_user_id = ? AND session_id = ?
     ORDER BY created_at ASC, id ASC`,
    [input.ownerUserId, input.sessionId],
  );

  return rows.map(mapSharedSessionCommentRow);
}

export function createSharedSessionComment(input: {
  ownerUserId: string;
  sessionId: string;
  authorUserId: string;
  authorEmail: string;
  content: string;
}): SharedSessionCommentRecord {
  const id = randomUUID();
  sqliteRun(
    `INSERT INTO shared_session_comments (id, owner_user_id, session_id, author_user_id, author_email, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [id, input.ownerUserId, input.sessionId, input.authorUserId, input.authorEmail, input.content],
  );

  const createdRow = sqliteGet<SharedSessionCommentRow>(
    `SELECT id, session_id, author_email, content, created_at
     FROM shared_session_comments
     WHERE id = ? AND owner_user_id = ?
     LIMIT 1`,
    [id, input.ownerUserId],
  );

  if (createdRow) {
    return mapSharedSessionCommentRow(createdRow);
  }

  return {
    authorEmail: input.authorEmail,
    content: input.content,
    createdAt: new Date().toISOString(),
    id,
    sessionId: input.sessionId,
  };
}
