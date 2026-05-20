/**
 * Session Memory Store — Persistent storage for per-session compaction memory.
 *
 * Unlike the cross-session `memories` table (user-level facts/preferences),
 * this stores session-scoped summaries that are used exclusively by the
 * Session Memory Compact path (Layer 1).
 *
 * Storage: Uses the session's `metadata_json` field with a dedicated key
 * `sessionMemoryContent`. This avoids adding a new table and keeps the
 * session memory co-located with other session state.
 *
 * The session memory is extracted in the background after each stream
 * completes (via `extractSessionMemoryForSession`) and consumed during
 * compaction (via `readSessionMemoryContent`).
 */

import { sqliteGet, sqliteRun } from '../infra/db.js';

// ─── Read / Write ────────────────────────────────────────────────────────────

/**
 * Read the session memory content for a given session.
 * Returns null if no session memory has been extracted yet.
 */
export function readSessionMemoryContent(sessionId: string, userId: string): string | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );

  if (!row || !row.metadata_json) return null;

  try {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const content = metadata['sessionMemoryContent'];
    if (typeof content !== 'string' || content.trim().length === 0) {
      return null;
    }
    return content;
  } catch {
    return null;
  }
}

/**
 * Write session memory content for a given session.
 * Merges into the existing metadata_json without overwriting other fields.
 */
export function writeSessionMemoryContent(
  sessionId: string,
  userId: string,
  content: string,
): void {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );

  let metadata: Record<string, unknown> = {};
  if (row?.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }

  metadata['sessionMemoryContent'] = content;
  metadata['sessionMemoryUpdatedAt'] = Date.now();

  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), sessionId, userId],
  );
}

/**
 * Read the last summarized message ID for session memory tracking.
 * This marks the boundary between "already summarized" and "new" messages.
 */
export function readLastSessionMemoryMessageId(sessionId: string, userId: string): string | null {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );

  if (!row?.metadata_json) return null;

  try {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const id = metadata['lastSessionMemoryMessageId'];
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

/**
 * Update the last summarized message ID after successful extraction.
 */
export function writeLastSessionMemoryMessageId(
  sessionId: string,
  userId: string,
  messageId: string,
): void {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );

  let metadata: Record<string, unknown> = {};
  if (row?.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }

  metadata['lastSessionMemoryMessageId'] = messageId;

  sqliteRun(
    "UPDATE sessions SET metadata_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(metadata), sessionId, userId],
  );
}

/**
 * Check if session memory is empty (just the template with no real content).
 */
export function isSessionMemoryEmpty(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;

  // Check if it's just the template with placeholder markers
  const placeholderPattern = /\(待提取\)/g;
  const matches = trimmed.match(placeholderPattern);
  const headingPattern = /^##\s/gm;
  const headings = trimmed.match(headingPattern);

  // If all sections are still placeholders, it's empty
  if (matches && headings && matches.length >= headings.length) {
    return true;
  }

  return false;
}

// ─── Combined Read (optimization) ───────────────────────────────────────────

export interface SessionMemoryState {
  content: string | null;
  lastMessageId: string | null;
  updatedAt: number | null;
}

/**
 * Read all session memory state in a single DB query.
 * Avoids multiple SELECT calls on the same row.
 */
export function readSessionMemoryState(sessionId: string, userId: string): SessionMemoryState {
  const row = sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ? AND user_id = ?',
    [sessionId, userId],
  );

  if (!row?.metadata_json) {
    return { content: null, lastMessageId: null, updatedAt: null };
  }

  try {
    const metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    const content =
      typeof metadata['sessionMemoryContent'] === 'string'
        ? metadata['sessionMemoryContent']
        : null;
    const lastMessageId =
      typeof metadata['lastSessionMemoryMessageId'] === 'string'
        ? metadata['lastSessionMemoryMessageId']
        : null;
    const updatedAt =
      typeof metadata['sessionMemoryUpdatedAt'] === 'number'
        ? metadata['sessionMemoryUpdatedAt']
        : null;
    return {
      content: content && content.trim().length > 0 ? content : null,
      lastMessageId,
      updatedAt,
    };
  } catch {
    return { content: null, lastMessageId: null, updatedAt: null };
  }
}
