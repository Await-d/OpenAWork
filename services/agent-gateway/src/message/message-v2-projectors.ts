/**
 * Projectors for V2 Message Store.
 *
 * Each projector transforms a SyncEvent into the appropriate DB mutation.
 * This is the "write side" of CQRS — events are the source of truth,
 * projectors build the read model.
 *
 * Inspired by opencode's session/projectors.ts pattern.
 */

import { registerProjector } from '../session/sync-event.js';
import {
  MessageEvents,
  SessionEvents,
  type SessionInfo,
  type DeepPartial,
} from '../session/sync-event.js';
import { sqliteRun, sqliteGet } from '../infra/db.js';
import { invalidateSessionOwnerCache } from '../infra/session-owner-cache.js';
import { deleteSessionMessageSearchDocumentsForSession } from '../session/session-search-store.js';
import {
  type MessageInfo,
  type MessagePart,
  messageInfoToRowData,
  partToRowData,
} from './message-v2-schema.js';
import { buildToolOutputReferenceIdentity } from './tool-output-reference.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

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
      logGatewayWarn(`[Projector] ignored late ${label}`, context);
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

  // `id` 是 message_v2 的主键，但 SQLite 对**非 INTEGER** 主键仍允许 NULL（唯一索引把
  // 多个 NULL 视为互不相同），而绑定层又把 `undefined` 归一成 NULL（见
  // `infra/sqlite-bind-params.ts`）。两者叠加的后果是灾难性的：调用方只要把「从行 JSON
  // 还原出来的 info」直接回投（`messageInfoToRowData` 会剥掉 id，回投时 id 就成了
  // undefined），每次调用都会插进一行**新的**不可寻址幽灵行——ON CONFLICT 永不命中，
  // 按 id 删除永不匹配，读路径却仍把它们当成合法消息参与回合归因。生产库上单个会话
  // 曾因此累积 228 万行（805 MiB），把 truncate / 列表接口拖到秒级。
  //
  // 这里是 message_v2 的唯一写入点，缺 id 一律按编程错误处理：告警并丢弃，绝不落库。
  if (typeof info?.id !== 'string' || info.id.length === 0) {
    logGatewayWarn('[Projector] 丢弃缺少 message id 的消息写入（不落库）', {
      sessionID: typeof data?.sessionID === 'string' ? data.sessionID : '',
      role: typeof info?.role === 'string' ? info.role : '',
    });
    return;
  }

  const dataJson = messageInfoToRowData(info);

  // Resolve user_id from sessions table to satisfy FK constraint
  const sessionRow = sqliteGet<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [
    data.sessionID,
  ]);
  const userId = sessionRow?.user_id ?? '';
  // 请求族（clientRequestId）与 `role` 一样反规范化落列：按请求族读写的五个入口靠它做
  // 索引范围扫描，不再把整会话的 `data` 拉进 JS 逐行 JSON.parse。缺失时写 ''（列 NOT NULL），
  // '' 落在任何非空 root 的区间之外，因此不会被误命中。
  const clientRequestId = typeof info.clientRequestId === 'string' ? info.clientRequestId : '';

  safeUpsert(
    () =>
      sqliteRun(
        // `role` / `client_request_id` 与 `time_created` 一起作为反规范化列落库：读侧的回合
        // 窗口查询、回合计数与请求族查询靠索引定位，不再对 `data` 做前导通配符 LIKE 或整表
        // JSON 解析。ON CONFLICT 分支必须一并刷新 —— role 可能随消息状态流转而变化，
        // clientRequestId 也可能后补（compaction / 重试回填），只更新 `data` 会让索引列与
        // JSON 脱节。
        `INSERT INTO message_v2 (id, session_id, user_id, time_created, role, client_request_id, data)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           role = excluded.role,
           client_request_id = excluded.client_request_id,
           data = excluded.data,
           updated_at = datetime('now')`,
        [info.id, data.sessionID, userId, info.time.created, info.role, clientRequestId, dataJson],
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
  // Clean the v1 search mirror in lock-step. `appendSessionMessageV2`
  // populates `session_messages` + `session_messages_fts` outside the
  // projector pipeline (legacy FTS read path still queries those
  // tables). If we only drop the v2 rows, retry / truncate flows leave
  // ghost rows that surface in session search and the rating-store
  // UNION lookup. The DELETE is keyed by `id` only because the v1
  // schema's PRIMARY KEY is `id`; FTS is keyed by `message_id` (per
  // session-search-store.ts).
  sqliteRun('DELETE FROM session_messages WHERE id = ?', [data.messageID]);
  sqliteRun('DELETE FROM session_messages_fts WHERE message_id = ?', [data.messageID]);
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
  const toolCallId = part.type === 'tool' ? part.callID : null;
  const referenceIdentity =
    toolCallId === null ? null : buildToolOutputReferenceIdentity(toolCallId);
  const toolCallRef =
    referenceIdentity !== null && 'toolCallRef' in referenceIdentity
      ? referenceIdentity.toolCallRef
      : null;

  safeUpsert(
    () =>
      sqliteRun(
        `INSERT INTO part_v2
           (id, message_id, session_id, user_id, time_created, data, tool_call_id, tool_call_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           data = excluded.data,
           tool_call_id = excluded.tool_call_id,
           tool_call_ref = excluded.tool_call_ref,
           updated_at = datetime('now')`,
        [
          part.id,
          part.messageID,
          data.sessionID,
          userId,
          timeCreated,
          dataJson,
          toolCallId,
          toolCallRef,
        ],
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
  deleteSessionMessageSearchDocumentsForSession(data.sessionID);
  // The row is gone — drop its cached owner so later writes do not resolve a
  // stale user_id through the owner cache.
  invalidateSessionOwnerCache(data.sessionID);
});

console.log('[SyncEvent] session projectors registered');
