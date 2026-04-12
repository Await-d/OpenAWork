/**
 * Projectors for V2 Message Store.
 *
 * Each projector transforms a SyncEvent into the appropriate DB mutation.
 * This is the "write side" of CQRS — events are the source of truth,
 * projectors build the read model.
 *
 * Inspired by opencode's session/projectors.ts pattern.
 */

import { registerProjector } from './sync-event.js';
import { MessageEvents, SessionEvents, type SessionInfo, type DeepPartial } from './sync-event.js';
import { sqliteRun, sqliteGet } from './db.js';
import {
  type MessageInfo,
  type MessagePart,
  messageInfoToRowData,
  partToRowData,
} from './message-v2-schema.js';

// ─── FK Constraint Tolerance ───
// opencode pattern: ignore SQLITE_CONSTRAINT_FOREIGNKEY errors
// (occurs when a late event references a deleted session/message)

function isForeignKeyError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  if ('code' in err && (err as { code: string }).code === 'SQLITE_CONSTRAINT_FOREIGNKEY')
    return true;
  if ('message' in err && typeof (err as { message: string }).message === 'string') {
    return (err as { message: string }).message.includes('FOREIGN KEY constraint failed');
  }
  return false;
}

function safeUpsert(fn: () => void, label: string, context: Record<string, string>): void {
  try {
    fn();
  } catch (err) {
    if (isForeignKeyError(err)) {
      console.warn(`[Projector] ignored late ${label}`, context);
      return;
    }
    throw err;
  }
}

// ─── Message Projectors ───
// Both Created and Updated use the same upsert logic (opencode pattern)

const messageUpsertProjector = (event: { data: unknown }) => {
  const data = event.data as { sessionID: string; info: MessageInfo };
  const info = data.info;
  const dataJson = messageInfoToRowData(info);

  // Resolve user_id from sessions table to satisfy FK constraint
  const sessionRow = sqliteGet<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [
    data.sessionID,
  ]);
  const userId = sessionRow?.user_id ?? '';

  safeUpsert(
    () =>
      sqliteRun(
        `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
        [info.id, data.sessionID, userId, info.time.created, dataJson],
      ),
    'message update',
    { messageID: info.id, sessionID: data.sessionID },
  );
};

registerProjector(MessageEvents.Created.type, messageUpsertProjector);
registerProjector(MessageEvents.Updated.type, messageUpsertProjector);

registerProjector(MessageEvents.Removed.type, (event) => {
  const data = event.data as { sessionID: string; messageID: string };
  sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [
    data.messageID,
    data.sessionID,
  ]);
  sqliteRun('DELETE FROM message_v2 WHERE id = ? AND session_id = ?', [
    data.messageID,
    data.sessionID,
  ]);
});

// ─── Part Projectors ───

const partUpsertProjector = (event: { data: unknown }) => {
  const data = event.data as { sessionID: string; part: MessagePart; time?: number };
  const part = data.part;
  const dataJson = partToRowData(part);
  const timeCreated =
    data.time ?? (part as { time?: { start?: number } }).time?.start ?? Date.now();

  // Resolve user_id from sessions table to satisfy FK constraint
  const sessionRow = sqliteGet<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [
    data.sessionID,
  ]);
  const userId = sessionRow?.user_id ?? '';

  safeUpsert(
    () =>
      sqliteRun(
        `INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
        [part.id, part.messageID, data.sessionID, userId, timeCreated, dataJson],
      ),
    'part update',
    { partID: part.id, messageID: part.messageID, sessionID: data.sessionID },
  );
};

registerProjector(MessageEvents.PartCreated.type, partUpsertProjector);
registerProjector(MessageEvents.PartUpdated.type, partUpsertProjector);

registerProjector(MessageEvents.PartDelta.type, (event) => {
  const data = event.data as {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };

  const row = sqliteGet<{ data: string }>(
    'SELECT data FROM part_v2 WHERE id = ? AND message_id = ? AND session_id = ?',
    [data.partID, data.messageID, data.sessionID],
  );
  if (!row) return;

  const partData = JSON.parse(row.data) as Record<string, unknown>;
  const existing = typeof partData[data.field] === 'string' ? (partData[data.field] as string) : '';
  partData[data.field] = existing + data.delta;

  sqliteRun("UPDATE part_v2 SET data = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(partData),
    data.partID,
  ]);
});

registerProjector(MessageEvents.PartRemoved.type, (event) => {
  const data = event.data as { sessionID: string; messageID: string; partID: string };
  sqliteRun('DELETE FROM part_v2 WHERE id = ? AND message_id = ? AND session_id = ?', [
    data.partID,
    data.messageID,
    data.sessionID,
  ]);
});

// ─── Auto-initialize projectors on import ───

console.log('[SyncEvent] message-v2 projectors registered');

// ─── Session Projectors (opencode pattern) ───

function sessionInfoToRow(info: SessionInfo) {
  return {
    id: info.id,
    user_id: info.userID,
    title: info.title ?? null,
    parent_id: info.parentID ?? null,
    workspace_id: info.workspaceID ?? null,
    time_created: new Date(info.time.created).toISOString(),
    time_updated: new Date(info.time.updated).toISOString(),
    time_compacting: info.time.compacting ? new Date(info.time.compacting).toISOString() : null,
    time_archived: info.time.archived ? new Date(info.time.archived).toISOString() : null,
    summary_additions: info.summary?.additions ?? null,
    summary_deletions: info.summary?.deletions ?? null,
    summary_files: info.summary?.files ?? null,
    summary_diffs: info.summary?.diffs ? JSON.stringify(info.summary.diffs) : null,
    revert: info.revert ? JSON.stringify(info.revert) : null,
    permission: info.permission ? JSON.stringify(info.permission) : null,
  };
}

function toPartialRow(info: DeepPartial<SessionInfo>) {
  const obj: Record<string, unknown> = {};
  if (info.title !== undefined) obj.title = info.title;
  if (info.parentID !== undefined) obj.parent_id = info.parentID;
  if (info.workspaceID !== undefined) obj.workspace_id = info.workspaceID;
  if (info.time !== undefined && info.time !== null) {
    if (info.time.updated !== undefined && info.time.updated !== null)
      obj.time_updated = new Date(info.time.updated).toISOString();
    if (info.time.compacting !== undefined)
      obj.time_compacting = info.time.compacting
        ? new Date(info.time.compacting).toISOString()
        : null;
    if (info.time.archived !== undefined)
      obj.time_archived = info.time.archived ? new Date(info.time.archived).toISOString() : null;
  }
  if (info.summary !== undefined) {
    obj.summary_additions = (info.summary as Record<string, unknown>)?.additions ?? null;
    obj.summary_deletions = (info.summary as Record<string, unknown>)?.deletions ?? null;
    obj.summary_files = (info.summary as Record<string, unknown>)?.files ?? null;
    obj.summary_diffs = (info.summary as Record<string, unknown>)?.diffs
      ? JSON.stringify((info.summary as Record<string, unknown>).diffs)
      : null;
  }
  if (info.revert !== undefined) obj.revert = info.revert ? JSON.stringify(info.revert) : null;
  if (info.permission !== undefined)
    obj.permission = info.permission ? JSON.stringify(info.permission) : null;
  return obj;
}

registerProjector(SessionEvents.Created.type, (event) => {
  const data = event.data as { sessionID: string; info: SessionInfo };
  const row = sessionInfoToRow(data.info);
  sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, parent_id, workspace_id, time_created, time_updated, time_compacting, time_archived, summary_additions, summary_deletions, summary_files, summary_diffs, revert, permission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.user_id,
      row.title,
      row.parent_id,
      row.workspace_id,
      row.time_created,
      row.time_updated,
      row.time_compacting,
      row.time_archived,
      row.summary_additions,
      row.summary_deletions,
      row.summary_files,
      row.summary_diffs,
      row.revert,
      row.permission,
    ],
  );
});

registerProjector(SessionEvents.Updated.type, (event) => {
  const data = event.data as { sessionID: string; info: DeepPartial<SessionInfo> };
  const partial = toPartialRow(data.info);
  const entries = Object.entries(partial);
  if (entries.length === 0) return;
  const setClause = entries.map(([k]) => `${k} = ?`).join(', ');
  sqliteRun(`UPDATE sessions SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [
    ...entries.map(([, v]) => v as string | number | null),
    data.sessionID,
  ]);
});

registerProjector(SessionEvents.Deleted.type, (event) => {
  const data = event.data as { sessionID: string; info: SessionInfo };
  sqliteRun('DELETE FROM sessions WHERE id = ?', [data.sessionID]);
});

console.log('[SyncEvent] session projectors registered');
