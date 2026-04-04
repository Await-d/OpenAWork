import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteRun } from './db.js';

interface SearchableSessionMessageRow {
  created_at_ms: number;
  id: string;
  role: string;
  session_id: string;
  title: string | null;
  updated_at: string;
  snippet: string;
}

interface SessionMessageIndexRow {
  content_json: string;
  id: string;
  role: string;
  session_id: string;
  user_id: string;
}

export interface SessionSearchResult {
  createdAtMs: number;
  messageId: string;
  role: string;
  sessionId: string;
  snippet: string;
  title: string | null;
  updatedAt: string;
}

interface LegacySessionRow {
  id: string;
  messages_json: string;
  user_id: string;
}

interface LegacyMessage {
  content: string | Array<{ text?: string; type?: string }>;
  createdAt?: number | string;
  id?: string;
  role?: string;
}

export function hydrateLegacySessionMessagesForSearch(userId: string): void {
  const sessions = sqliteAll<LegacySessionRow>(
    `SELECT id, user_id, messages_json
     FROM sessions
     WHERE user_id = ?
       AND messages_json != '[]'
       AND NOT EXISTS (
         SELECT 1 FROM session_messages msg WHERE msg.session_id = sessions.id AND msg.user_id = sessions.user_id
       )`,
    [userId],
  );

  sessions.forEach((session) => {
    let parsedMessages: LegacyMessage[] = [];
    try {
      const parsed = JSON.parse(session.messages_json) as unknown;
      if (Array.isArray(parsed)) {
        parsedMessages = parsed as LegacyMessage[];
      }
    } catch {
      parsedMessages = [];
    }

    parsedMessages.forEach((message, index) => {
      const role =
        message.role === 'assistant' ||
        message.role === 'system' ||
        message.role === 'tool' ||
        message.role === 'user'
          ? message.role
          : null;
      if (!role) {
        return;
      }

      const normalizedContent = normalizeLegacyContent(message.content);
      if (!normalizedContent) {
        return;
      }

      const messageId =
        typeof message.id === 'string' && message.id.length > 0 ? message.id : randomUUID();
      const contentJson = JSON.stringify(normalizedContent);

      sqliteRun(
        "INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'final', NULL, ?, datetime('now'))",
        [
          messageId,
          session.id,
          session.user_id,
          index + 1,
          role,
          contentJson,
          normalizeLegacyCreatedAt(message.createdAt),
        ],
      );

      upsertSessionMessageSearchDocument({
        contentJson,
        id: messageId,
        role,
        sessionId: session.id,
        userId: session.user_id,
      });
    });
  });
}

export function upsertSessionMessageSearchDocument(input: {
  contentJson: string;
  id: string;
  role: string;
  sessionId: string;
  userId: string;
}): void {
  const content = buildSearchableMessageText(input.contentJson);
  sqliteRun('DELETE FROM session_messages_fts WHERE message_id = ?', [input.id]);
  if (content.length === 0) {
    return;
  }
  sqliteRun(
    'INSERT INTO session_messages_fts (message_id, session_id, user_id, role, content) VALUES (?, ?, ?, ?, ?)',
    [input.id, input.sessionId, input.userId, input.role, content],
  );
}

export function deleteSessionMessageSearchDocument(messageId: string): void {
  sqliteRun('DELETE FROM session_messages_fts WHERE message_id = ?', [messageId]);
}

export function rebuildSessionMessageSearchIndex(): void {
  sqliteRun('DELETE FROM session_messages_fts');
  const rows = sqliteAll<SessionMessageIndexRow>(
    'SELECT id, session_id, user_id, role, content_json FROM session_messages',
  );
  rows.forEach((row) => {
    upsertSessionMessageSearchDocument({
      contentJson: row.content_json,
      id: row.id,
      role: row.role,
      sessionId: row.session_id,
      userId: row.user_id,
    });
  });
}

export function searchSessionMessages(input: {
  limit: number;
  query: string;
  userId: string;
}): SessionSearchResult[] {
  const ftsQuery = buildFtsQuery(input.query);
  if (!ftsQuery) {
    return [];
  }

  return sqliteAll<SearchableSessionMessageRow>(
    `SELECT
      fts.message_id AS id,
      fts.session_id AS session_id,
      fts.role AS role,
      msg.created_at_ms AS created_at_ms,
      sess.title AS title,
      sess.updated_at AS updated_at,
      snippet(session_messages_fts, 4, '<mark>', '</mark>', '…', 18) AS snippet
    FROM session_messages_fts fts
    JOIN session_messages msg ON msg.id = fts.message_id
    JOIN sessions sess ON sess.id = fts.session_id
    WHERE session_messages_fts MATCH ? AND fts.user_id = ?
    ORDER BY bm25(session_messages_fts), msg.created_at_ms DESC
    LIMIT ?`,
    [ftsQuery, input.userId, input.limit],
  ).map((row) => ({
    createdAtMs: row.created_at_ms,
    messageId: row.id,
    role: row.role,
    sessionId: row.session_id,
    snippet: row.snippet,
    title: row.title,
    updatedAt: row.updated_at,
  }));
}

function normalizeLegacyContent(
  value: LegacyMessage['content'],
): Array<{ text: string; type: 'text' }> | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return [{ type: 'text', text: value }];
  }

  if (Array.isArray(value)) {
    const normalized = value
      .flatMap((item) =>
        item?.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0
          ? [{ type: 'text' as const, text: item.text }]
          : [],
      )
      .slice(0, 32);
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function normalizeLegacyCreatedAt(value: LegacyMessage['createdAt']): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

export function buildSearchableMessageText(contentJson: string): string {
  try {
    const parsed = JSON.parse(contentJson) as unknown;
    if (!Array.isArray(parsed)) {
      return '';
    }

    return parsed
      .flatMap((item) => {
        if (!item || typeof item !== 'object') {
          return [];
        }
        const record = item as Record<string, unknown>;
        if (record['type'] === 'text' && typeof record['text'] === 'string') {
          return [record['text']];
        }
        if (record['type'] === 'modified_files_summary') {
          const title = typeof record['title'] === 'string' ? record['title'] : '';
          const summary = typeof record['summary'] === 'string' ? record['summary'] : '';
          return [[title, summary].filter((value) => value.length > 0).join('：')];
        }
        return [];
      })
      .join('\n')
      .trim();
  } catch {
    return '';
  }
}

function buildFtsQuery(input: string): string {
  const tokens = input
    .trim()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, 8);

  if (tokens.length === 0) {
    return '';
  }

  return tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
}
