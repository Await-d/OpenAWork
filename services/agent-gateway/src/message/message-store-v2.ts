/**
 * V2 Message Store — opencode-style Session → Message → Part storage.
 *
 * Key design:
 * - Message and Part are separate rows, not a single content_json blob
 * - All mutations go through SyncEvent → Projector (event sourcing)
 * - Tool state machine: pending → running → completed/error
 * - Part-level incremental updates via updatePartDelta
 * - Idempotent upsert via ON CONFLICT DO UPDATE
 */

import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import {
  type MessageID,
  type PartID,
  type MessageInfo,
  type MessagePart,
  type MessageWithParts,
  type MessageV2Row,
  type PartV2Row,
  type ToolPart,
  type ToolStatePending,
  type ToolStateRunning,
  type ToolStateCompleted,
  type ToolStateError,
  type AssistantErrorObject,
  tryMessageInfoFromRow,
  tryPartFromRow,
  type PageResult,
  type MessageCursor,
} from './message-v2-schema.js';
import { buildUiToolPartReadState } from '../tools/tool-state-read-model.js';
import {
  normalizeToolResultOutputForStorage,
  stringifyToolResultOutput,
} from '../tools/tool-result-contract.js';
import { emitEvent, MessageEvents } from '../session/sync-event.js';
import { appendSessionEvent } from '../session/session-entry-store.js';
import { makeSessionEventId } from '../session/session-event.js';
// Side-effect import: registers the message/part projectors that translate
// the events emitted below into INSERT/UPDATE/DELETE on message_v2/part_v2.
// Without this the unified SyncEvent write path would silently no-op.
import './message-v2-projectors.js';

// ─── Corrupt-row-tolerant row mappers ───
// Map DB rows to the read model while skipping any row whose `data` column is
// corrupt JSON, so a single bad row can't throw and make an entire page /
// session of messages unreadable. See `try*FromRow` in message-v2-schema.ts.
function mapMessageInfoRows(rows: MessageV2Row[]): MessageInfo[] {
  const out: MessageInfo[] = [];
  for (const row of rows) {
    const info = tryMessageInfoFromRow(row);
    if (info) out.push(info);
  }
  return out;
}

function mapPartRows(rows: PartV2Row[]): MessagePart[] {
  const out: MessagePart[] = [];
  for (const row of rows) {
    const part = tryPartFromRow(row);
    if (part) out.push(part);
  }
  return out;
}

// ─── Message CRUD ───

export function insertMessage(input: {
  sessionId: string;
  userId: string;
  info: MessageInfo;
}): void {
  // Phase 2.1 — single write path: every V2 mutation flows through
  // emitEvent → projector (see message-v2-projectors.ts) so the
  // event_log captures it and downstream subscribers stay in sync.
  emitEvent({
    definition: MessageEvents.Created,
    aggregateID: input.sessionId,
    data: { sessionID: input.sessionId, info: input.info },
  });
}

export function updateMessage(input: {
  sessionId: string;
  userId: string;
  info: MessageInfo;
}): void {
  emitEvent({
    definition: MessageEvents.Updated,
    aggregateID: input.sessionId,
    data: { sessionID: input.sessionId, info: input.info },
  });
}

export function deleteMessage(input: {
  sessionId: string;
  userId: string;
  messageId: MessageID;
}): void {
  emitEvent({
    definition: MessageEvents.Removed,
    aggregateID: input.sessionId,
    data: { sessionID: input.sessionId, messageID: input.messageId },
  });
}

export function getMessage(input: {
  sessionId: string;
  messageId: MessageID;
}): MessageInfo | undefined {
  const row = sqliteGet<MessageV2Row>('SELECT * FROM message_v2 WHERE id = ? AND session_id = ?', [
    input.messageId,
    input.sessionId,
  ]);
  return row ? (tryMessageInfoFromRow(row) ?? undefined) : undefined;
}

export function listMessages(input: {
  sessionId: string;
  userId: string;
  afterTime?: number;
  limit?: number;
}): MessageInfo[] {
  const limit = input.limit ?? 100;
  const limitClause = limit > 0 ? `LIMIT ${limit}` : '';

  const rows =
    input.afterTime !== undefined
      ? sqliteAll<MessageV2Row>(
          `SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? AND time_created > ? ORDER BY time_created ASC, id ASC ${limitClause}`,
          [input.sessionId, input.userId, input.afterTime],
        )
      : sqliteAll<MessageV2Row>(
          `SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC ${limitClause}`,
          [input.sessionId, input.userId],
        );
  return mapMessageInfoRows(rows);
}

/**
 * Return the last N conversation turns (measured by user-message count) and all
 * messages that follow each turn boundary.  This guarantees complete assistant
 * responses regardless of how many raw messages they span.
 *
 * Algorithm:
 *   1. Find the Nth-from-last user message (ORDER BY time_created DESC LIMIT 1 OFFSET N-1).
 *   2. Return every message whose time_created >= that boundary, in chronological order.
 */
export function listMessagesByTurnLimit(input: {
  sessionId: string;
  userId: string;
  turnLimit: number;
}): MessageInfo[] {
  const boundary = sqliteGet<Pick<MessageV2Row, 'time_created'>>(
    `SELECT time_created FROM message_v2
     WHERE session_id = ? AND user_id = ? AND data LIKE '%"role":"user"%'
     ORDER BY time_created DESC, id DESC
     LIMIT 1 OFFSET ?`,
    [input.sessionId, input.userId, input.turnLimit - 1],
  );

  if (!boundary) {
    // Fewer turns than requested — return everything
    return listMessages({ sessionId: input.sessionId, userId: input.userId, limit: -1 });
  }

  const rows = sqliteAll<MessageV2Row>(
    `SELECT * FROM message_v2
     WHERE session_id = ? AND user_id = ? AND time_created >= ?
     ORDER BY time_created ASC, id ASC`,
    [input.sessionId, input.userId, boundary.time_created],
  );
  return mapMessageInfoRows(rows);
}

export function countMessages(input: { sessionId: string; userId: string }): number {
  const row = sqliteGet<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM message_v2 WHERE session_id = ? AND user_id = ?',
    [input.sessionId, input.userId],
  );
  return row?.cnt ?? 0;
}

export function countUserMessages(input: { sessionId: string; userId: string }): number {
  const row = sqliteGet<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM message_v2 WHERE session_id = ? AND user_id = ? AND data LIKE '%"role":"user"%'`,
    [input.sessionId, input.userId],
  );
  return row?.cnt ?? 0;
}

// ─── Part CRUD ───

function getPartTimeCreated(part: MessagePart): number {
  if ('time' in part && part.time && typeof part.time === 'object' && 'start' in part.time) {
    return part.time.start;
  }
  return Date.now();
}

export function insertPart(input: { sessionId: string; userId: string; part: MessagePart }): void {
  emitEvent({
    definition: MessageEvents.PartCreated,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      part: input.part,
      time: getPartTimeCreated(input.part),
    } as { sessionID: string; part: unknown; time?: number },
  });
}

export function updatePart(input: { sessionId: string; userId: string; part: MessagePart }): void {
  emitEvent({
    definition: MessageEvents.PartUpdated,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      part: input.part,
      time: getPartTimeCreated(input.part),
    } as { sessionID: string; part: unknown; time: number },
  });
}

export function deletePart(input: { sessionId: string; partId: PartID }): void {
  // Resolve the messageId so the projector payload stays well-formed —
  // the partRemoved projector deletes by (id, message_id, session_id).
  const row = sqliteGet<{ message_id: string }>(
    'SELECT message_id FROM part_v2 WHERE id = ? AND session_id = ?',
    [input.partId, input.sessionId],
  );
  if (!row) return;
  emitEvent({
    definition: MessageEvents.PartRemoved,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: row.message_id,
      partID: input.partId,
    },
  });
}

export function getPart(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
}): MessagePart | undefined {
  const row = sqliteGet<PartV2Row>(
    'SELECT * FROM part_v2 WHERE id = ? AND message_id = ? AND session_id = ?',
    [input.partId, input.messageId, input.sessionId],
  );
  return row ? (tryPartFromRow(row) ?? undefined) : undefined;
}

export function listPartsForMessage(input: {
  sessionId: string;
  messageId: MessageID;
}): MessagePart[] {
  const rows = sqliteAll<PartV2Row>(
    'SELECT * FROM part_v2 WHERE message_id = ? AND session_id = ? ORDER BY id ASC',
    [input.messageId, input.sessionId],
  );
  return mapPartRows(rows);
}

export function listPartsForSession(input: {
  sessionId: string;
  afterTime?: number;
}): MessagePart[] {
  const rows =
    input.afterTime !== undefined
      ? sqliteAll<PartV2Row>(
          'SELECT * FROM part_v2 WHERE session_id = ? AND time_created > ? ORDER BY time_created ASC, id ASC',
          [input.sessionId, input.afterTime],
        )
      : sqliteAll<PartV2Row>(
          'SELECT * FROM part_v2 WHERE session_id = ? ORDER BY time_created ASC, id ASC',
          [input.sessionId],
        );
  return mapPartRows(rows);
}

// ─── Incremental Part Delta ───

export function updatePartDelta(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
  field: string;
  delta: string;
}): void {
  emitEvent({
    definition: MessageEvents.PartDelta,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: input.messageId,
      partID: input.partId,
      field: input.field,
      delta: input.delta,
    },
  });
}

// ─── Read Model: MessageWithParts ───

export function listMessagesWithParts(input: {
  sessionId: string;
  userId: string;
  limit?: number;
}): MessageWithParts[] {
  // Default to unlimited — filterCompacted() handles the actual boundary,
  // matching opencode's pattern where stream() reads all messages and
  // filterCompacted() trims pre-compaction history.
  const limit = input.limit ?? -1;
  const messages = listMessages({ ...input, limit });
  return attachPartsToMessages(input.sessionId, messages);
}

export function listMessagesWithPartsByTurnLimit(input: {
  sessionId: string;
  userId: string;
  turnLimit: number;
}): MessageWithParts[] {
  const messages = listMessagesByTurnLimit(input);
  return attachPartsToMessages(input.sessionId, messages);
}

function attachPartsToMessages(sessionId: string, messages: MessageInfo[]): MessageWithParts[] {
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const placeholders = messageIds.map(() => '?').join(',');
  const partRows = sqliteAll<PartV2Row>(
    `SELECT * FROM part_v2 WHERE session_id = ? AND message_id IN (${placeholders}) ORDER BY message_id, id ASC`,
    [sessionId, ...messageIds],
  );

  const partsByMessage = new Map<string, MessagePart[]>();
  for (const row of partRows) {
    const part = tryPartFromRow(row);
    if (!part) continue;
    const existing = partsByMessage.get(row.message_id) ?? [];
    existing.push(part);
    partsByMessage.set(row.message_id, existing);
  }

  return messages.map((info) => ({
    info,
    parts: partsByMessage.get(info.id) ?? [],
  }));
}

// ─── Tool State Transitions ───

export function findToolPartByCallID(input: {
  sessionId: string;
  callID: string;
}): ToolPart | undefined {
  // Search parts with type='tool' by scanning data JSON
  const rows = sqliteAll<PartV2Row>(
    'SELECT * FROM part_v2 WHERE session_id = ? AND data LIKE ? LIMIT 10',
    [input.sessionId, `%"callID":"${input.callID}"%`],
  );
  for (const row of rows) {
    const part = tryPartFromRow(row);
    if (part && part.type === 'tool' && part.callID === input.callID) {
      return part;
    }
  }
  return undefined;
}

export function transitionToolToRunning(input: {
  sessionId: string;
  userId: string;
  callID: string;
  title?: string;
  metadata?: Record<string, unknown>;
}): ToolPart | undefined {
  const part = findToolPartByCallID({ sessionId: input.sessionId, callID: input.callID });
  if (!part || part.type !== 'tool') return undefined;

  const pending = part.state as ToolStatePending;
  const nextState: ToolStateRunning = {
    status: 'running',
    input: pending.input,
    title: input.title,
    metadata: input.metadata,
    time: { start: Date.now() },
  };

  const updated: ToolPart = { ...part, state: nextState };
  updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });

  // Phase 2.2 — mirror the dispatch as a typed `tool.called` SessionEvent so
  // `replaySessionEntries` can transition the aggregator's ToolPart from
  // `pending` to `running` (matches opencode's tool.called → tool.success
  // / tool.error pipeline). Failures are swallowed: the tool transition
  // itself is the source of truth.
  try {
    const ts = nextState.time.start;
    appendSessionEvent({
      sessionId: input.sessionId,
      userId: input.userId,
      event: {
        id: makeSessionEventId(ts),
        type: 'tool.called',
        timestamp: ts,
        callID: input.callID,
        tool: part.tool,
        input: pending.input,
        provider: { executed: true, ...(input.metadata ? { metadata: input.metadata } : {}) },
      },
    });
  } catch {
    // best-effort persistence; never fail the tool dispatch because of it.
  }

  return updated;
}

export function transitionToolToCompleted(input: {
  sessionId: string;
  userId: string;
  callID: string;
  output: string;
  title: string;
  metadata: Record<string, unknown>;
  startTime: number;
}): ToolPart | undefined {
  const part = findToolPartByCallID({ sessionId: input.sessionId, callID: input.callID });
  if (!part || part.type !== 'tool') return undefined;

  const running = part.state as ToolStateRunning;
  const output = stringifyToolResultOutput(normalizeToolResultOutputForStorage(input.output));
  const nextState: ToolStateCompleted = {
    status: 'completed',
    input: running.input,
    output,
    title: input.title,
    metadata: input.metadata,
    time: { start: input.startTime, end: Date.now() },
  };

  const updated: ToolPart = { ...part, state: nextState };
  updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });
  return updated;
}

export function transitionToolToError(input: {
  sessionId: string;
  userId: string;
  callID: string;
  error: string;
  startTime: number;
}): ToolPart | undefined {
  const part = findToolPartByCallID({ sessionId: input.sessionId, callID: input.callID });
  if (!part || part.type !== 'tool') return undefined;

  const running = part.state as ToolStateRunning;
  const error = stringifyToolResultOutput(normalizeToolResultOutputForStorage(input.error));
  const nextState: ToolStateError = {
    status: 'error',
    input: running.input,
    error,
    time: { start: input.startTime, end: Date.now() },
  };

  const updated: ToolPart = { ...part, state: nextState };
  updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });
  return updated;
}

// ─── Truncate (for retry / permission resume) ───

export function truncateMessagesAfter(input: {
  sessionId: string;
  userId: string;
  messageId: MessageID;
}): MessageID[] {
  const rows = sqliteAll<{ id: string }>(
    'SELECT id FROM message_v2 WHERE session_id = ? AND user_id = ? AND time_created >= (SELECT time_created FROM message_v2 WHERE id = ?) AND id >= ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId, input.messageId, input.messageId],
  );

  const ids = rows.map((r) => r.id);
  // Phase 2.1 — emit a Removed event per truncated message; the projector
  // takes care of cascading the part_v2 cleanup. We keep the bulk SQL for
  // backward compatibility just below in case some message rows are not
  // covered by the projector (e.g. when sessions row is missing).
  for (const id of ids) {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: input.sessionId,
      data: { sessionID: input.sessionId, messageID: id },
    });
  }
  // Defensive sweep — if any rows survived projector deletion (e.g. due to
  // FK constraints during a partially-migrated session), purge them with
  // explicit SQL so the caller's invariant ``no messages after messageId
  // remain'' still holds.
  for (const id of ids) {
    sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [id, input.sessionId]);
  }
  sqliteRun(
    'DELETE FROM message_v2 WHERE session_id = ? AND user_id = ? AND id IN (' +
      ids.map(() => '?').join(',') +
      ')',
    [input.sessionId, input.userId, ...ids],
  );

  return ids as MessageID[];
}

// ─── Cursor-based Pagination (opencode pattern) ───

export function encodeCursor(cursor: MessageCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(encoded: string): MessageCursor {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as MessageCursor;
}

export function pageMessagesWithParts(input: {
  sessionId: string;
  userId: string;
  limit: number;
  before?: string; // encoded cursor
}): PageResult {
  const before = input.before ? decodeCursor(input.before) : undefined;

  // Fetch limit+1 to detect if there are more pages
  const rows =
    before !== undefined
      ? sqliteAll<MessageV2Row>(
          'SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? AND (time_created < ? OR (time_created = ? AND id < ?)) ORDER BY time_created DESC, id DESC LIMIT ?',
          [input.sessionId, input.userId, before.time, before.time, before.id, input.limit + 1],
        )
      : sqliteAll<MessageV2Row>(
          'SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created DESC, id DESC LIMIT ?',
          [input.sessionId, input.userId, input.limit + 1],
        );

  const more = rows.length > input.limit;
  const slice = more ? rows.slice(0, input.limit) : rows;

  if (slice.length === 0) {
    return { items: [], more: false };
  }

  const messages = mapMessageInfoRows(slice);
  const messageIds = messages.map((m) => m.id);
  const placeholders = messageIds.map(() => '?').join(',');
  const partRows = sqliteAll<PartV2Row>(
    `SELECT * FROM part_v2 WHERE session_id = ? AND message_id IN (${placeholders}) ORDER BY message_id, id ASC`,
    [input.sessionId, ...messageIds],
  );

  const partsByMessage = new Map<string, MessagePart[]>();
  for (const row of partRows) {
    const part = tryPartFromRow(row);
    if (!part) continue;
    const existing = partsByMessage.get(row.message_id) ?? [];
    existing.push(part);
    partsByMessage.set(row.message_id, existing);
  }

  // Return in chronological order (oldest first)
  const items = messages.reverse().map((info) => ({
    info,
    parts: partsByMessage.get(info.id) ?? [],
  }));

  const tail = slice.at(-1);
  return {
    items,
    more,
    cursor:
      more && tail
        ? encodeCursor({ id: tail.id as MessageID, time: tail.time_created })
        : undefined,
  };
}

// ─── Streaming Iterator (opencode pattern) ───

export function* streamMessagesWithParts(input: {
  sessionId: string;
  userId: string;
  pageSize?: number;
}): Generator<MessageWithParts, void, unknown> {
  const pageSize = input.pageSize ?? 50;
  let before: string | undefined;

  while (true) {
    const page = pageMessagesWithParts({
      sessionId: input.sessionId,
      userId: input.userId,
      limit: pageSize,
      before,
    });

    if (page.items.length === 0) break;

    for (let i = page.items.length - 1; i >= 0; i--) {
      yield page.items[i]!;
    }

    if (!page.more || !page.cursor) break;
    before = page.cursor;
  }
}

// ─── Parts for a single message (opencode pattern) ───

export function partsForMessage(messageId: MessageID): MessagePart[] {
  const rows = sqliteAll<PartV2Row>('SELECT * FROM part_v2 WHERE message_id = ? ORDER BY id ASC', [
    messageId,
  ]);
  return mapPartRows(rows);
}

// ─── Get single message with parts (opencode pattern) ───

export function getMessageWithParts(input: {
  sessionID: string;
  messageID: MessageID;
}): MessageWithParts | null {
  const row = sqliteGet<MessageV2Row>('SELECT * FROM message_v2 WHERE id = ? AND session_id = ?', [
    input.messageID,
    input.sessionID,
  ]);
  if (!row) return null;
  const info = tryMessageInfoFromRow(row);
  if (!info) return null;
  return {
    info,
    parts: partsForMessage(input.messageID),
  };
}

// ─── toUIMessages (opencode pattern) ───
// Converts V2 MessageWithParts[] into AI SDK compatible UIMessage[] format
// for frontend UI projection. Distinct from toModelMessages() in
// message-to-model-messages.ts, which produces UnifiedMessage[] for
// upstream LLM requests.

export interface UIMessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  mediaType?: string;
  url?: string;
  filename?: string;
  providerMetadata?: Record<string, unknown>;
  callProviderMetadata?: Record<string, unknown>;
  providerExecuted?: boolean;
}

export interface UIMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: UIMessagePart[];
}

export function toUIMessages(input: MessageWithParts[]): UIMessage[] {
  const result: UIMessage[] = [];

  for (const msg of input) {
    if (msg.parts.length === 0) continue;

    if (msg.info.role === 'user') {
      const userMessage: UIMessage = { id: msg.info.id, role: 'user', parts: [] };
      result.push(userMessage);

      for (const part of msg.parts) {
        if (part.type === 'text' && !part.ignored) {
          userMessage.parts.push({ type: 'text', text: part.text });
        }
        if (
          part.type === 'file' &&
          part.mime !== 'text/plain' &&
          part.mime !== 'application/x-directory'
        ) {
          userMessage.parts.push({
            type: 'file',
            url: part.url,
            mediaType: part.mime,
            filename: part.filename,
          });
        }
        if (part.type === 'compaction') {
          userMessage.parts.push({ type: 'text', text: 'What did we do so far?' });
        }
        if (part.type === 'subtask') {
          userMessage.parts.push({
            type: 'text',
            text: 'The following tool was executed by the user',
          });
        }
      }
    }

    if (msg.info.role === 'assistant') {
      // Skip messages with errors that have no useful parts
      if (
        msg.info.error &&
        !msg.parts.some((p) => p.type !== 'step-start' && p.type !== 'reasoning')
      ) {
        continue;
      }

      const assistantMessage: UIMessage = { id: msg.info.id, role: 'assistant', parts: [] };

      for (const part of msg.parts) {
        if (part.type === 'text') {
          assistantMessage.parts.push({
            type: 'text',
            text: part.text,
            providerMetadata: part.metadata,
          });
        }
        if (part.type === 'step-start') {
          assistantMessage.parts.push({ type: 'step-start' });
        }
        if (part.type === 'reasoning') {
          assistantMessage.parts.push({
            type: 'reasoning',
            text: part.text,
            providerMetadata: part.metadata,
          });
        }
        if (part.type === 'tool') {
          const toolType = `tool-${part.tool}` as const;
          const readState = buildUiToolPartReadState(part);
          assistantMessage.parts.push({
            type: toolType,
            state: readState.state,
            toolCallId: part.callID,
            input: part.state.input,
            ...(readState.output
              ? {
                  output:
                    'attachments' in part.state &&
                    part.state.attachments &&
                    part.state.attachments.length > 0
                      ? { text: readState.output, attachments: part.state.attachments }
                      : readState.output,
                }
              : {}),
            ...(readState.errorText ? { errorText: readState.errorText } : {}),
            ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
            callProviderMetadata: part.metadata,
          });
        }
      }

      if (assistantMessage.parts.length > 0) {
        result.push(assistantMessage);
      }
    }
  }

  return result;
}

// ─── fromError (opencode pattern) ───
// Converts an error into the structured AssistantMessage.error format.
// Modelled after opencode's MessageV2.fromError but expressed as a plain
// TypeScript discriminated union (no Effect-TS NamedError dependency).

const AUTH_ERROR_PATTERNS: RegExp[] = [
  /api[\s_-]?key/i,
  /unauthorized/i,
  /\b401\b/,
  /\b403\b/,
  /forbidden/i,
  /authenticat(?:ion|ed)/i,
  /invalid token/i,
];

const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /context[\s_-]?length[\s_-]?exceeded/i,
  /context window/i,
  /maximum context length/i,
  /max(?:imum)?\s+(?:input|prompt)?\s*tokens?/i,
  /too many input tokens/i,
  /token limit/i,
  /prompt(?:\s+is)?\s+too long/i,
  /input(?:\s+is)?\s+too long/i,
  /exceeds.*context/i,
];

const OUTPUT_LENGTH_PATTERNS: RegExp[] = [
  /output[\s_-]+too long/i,
  /max[\s_-]?(?:completion|output)[\s_-]?tokens?/i,
  /max_tokens.*reached/i,
  /completion.*too long/i,
  /content_length_exceeded/i,
  /response.*too long/i,
];

const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function readErrorCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readErrorStatusCode(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const candidates = ['statusCode', 'status', 'httpStatus'] as const;
  for (const key of candidates) {
    const value = (e as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function fromError(
  e: unknown,
  ctx: { providerID?: string; aborted?: boolean },
): AssistantErrorObject {
  // 1. Aborted flows take precedence — DOM AbortError or explicit ctx.aborted
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { name: 'AbortedError', message: e.message };
  }

  if (e instanceof Error) {
    const message = e.message || String(e);
    const code = readErrorCode(e);
    const statusCode = readErrorStatusCode(e);

    // 2. Network / decompression errors (always retryable)
    if (code && RETRYABLE_NETWORK_CODES.has(code)) {
      return {
        name: 'APIError',
        message: code === 'ECONNRESET' ? 'Connection reset by server' : message,
        isRetryable: true,
        code,
      };
    }

    // 3. Aborted during stream
    if (ctx.aborted) {
      return { name: 'AbortedError', message };
    }

    // 4. Auth — auth issues should not be retried
    if (matchesAny(message, AUTH_ERROR_PATTERNS)) {
      return {
        name: 'AuthError',
        message: ctx.providerID ? `Provider ${ctx.providerID}: ${message}` : message,
        ...(ctx.providerID ? { providerID: ctx.providerID } : {}),
      };
    }

    // 5. Output length
    if (matchesAny(message, OUTPUT_LENGTH_PATTERNS)) {
      return { name: 'OutputLengthError', message };
    }

    // 6. Context overflow
    if (matchesAny(message, CONTEXT_OVERFLOW_PATTERNS)) {
      return {
        name: 'ContextOverflowError',
        message,
        ...(statusCode !== undefined ? { statusCode } : {}),
      };
    }

    // 7. Generic API error — retryable when 5xx is reported on the cause
    const isRetryable =
      statusCode !== undefined && statusCode >= 500 && statusCode <= 599 ? true : undefined;
    return {
      name: 'APIError',
      message,
      ...(statusCode !== undefined ? { statusCode } : {}),
      ...(isRetryable !== undefined ? { isRetryable } : {}),
      ...(code !== undefined ? { code } : {}),
    };
  }

  return { name: 'UnknownError', message: JSON.stringify(e) };
}
