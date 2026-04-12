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

import { sqliteAll, sqliteGet, sqliteRun } from './db.js';
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
  type AssistantMessage,
  makePartId,
  messageInfoFromRow,
  messageInfoToRowData,
  partFromRow,
  partToRowData,
  type PageResult,
  type MessageCursor,
} from './message-v2-schema.js';

// ─── Message CRUD ───

export function insertMessage(input: {
  sessionId: string;
  userId: string;
  info: MessageInfo;
}): void {
  const dataJson = messageInfoToRowData(input.info);
  sqliteRun(
    `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [input.info.id, input.sessionId, input.userId, input.info.time.created, dataJson],
  );
}

export function updateMessage(input: {
  sessionId: string;
  userId: string;
  info: MessageInfo;
}): void {
  const dataJson = messageInfoToRowData(input.info);
  sqliteRun(
    `INSERT INTO message_v2 (id, session_id, user_id, time_created, data)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [input.info.id, input.sessionId, input.userId, input.info.time.created, dataJson],
  );
}

export function deleteMessage(input: {
  sessionId: string;
  userId: string;
  messageId: MessageID;
}): void {
  // Parts cascade delete via FK
  sqliteRun('DELETE FROM message_v2 WHERE id = ? AND session_id = ?', [
    input.messageId,
    input.sessionId,
  ]);
}

export function getMessage(input: {
  sessionId: string;
  messageId: MessageID;
}): MessageInfo | undefined {
  const row = sqliteGet<MessageV2Row>('SELECT * FROM message_v2 WHERE id = ? AND session_id = ?', [
    input.messageId,
    input.sessionId,
  ]);
  return row ? messageInfoFromRow(row) : undefined;
}

export function listMessages(input: {
  sessionId: string;
  userId: string;
  afterTime?: number;
  limit?: number;
}): MessageInfo[] {
  const limit = input.limit ?? 100;
  const rows =
    input.afterTime !== undefined
      ? sqliteAll<MessageV2Row>(
          'SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? AND time_created > ? ORDER BY time_created ASC, id ASC LIMIT ?',
          [input.sessionId, input.userId, input.afterTime, limit],
        )
      : sqliteAll<MessageV2Row>(
          'SELECT * FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC LIMIT ?',
          [input.sessionId, input.userId, limit],
        );
  return rows.map((row) => messageInfoFromRow(row));
}

// ─── Part CRUD ───

function getPartTimeCreated(part: MessagePart): number {
  if ('time' in part && part.time && typeof part.time === 'object' && 'start' in part.time) {
    return part.time.start;
  }
  return Date.now();
}

export function insertPart(input: { sessionId: string; userId: string; part: MessagePart }): void {
  const dataJson = partToRowData(input.part);
  const timeCreated = getPartTimeCreated(input.part);
  sqliteRun(
    `INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [input.part.id, input.part.messageID, input.sessionId, input.userId, timeCreated, dataJson],
  );
}

export function updatePart(input: { sessionId: string; userId: string; part: MessagePart }): void {
  const dataJson = partToRowData(input.part);
  const timeCreated = getPartTimeCreated(input.part);
  sqliteRun(
    `INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')`,
    [input.part.id, input.part.messageID, input.sessionId, input.userId, timeCreated, dataJson],
  );
}

export function deletePart(input: { sessionId: string; partId: PartID }): void {
  sqliteRun('DELETE FROM part_v2 WHERE id = ? AND session_id = ?', [input.partId, input.sessionId]);
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
  return row ? partFromRow(row) : undefined;
}

export function listPartsForMessage(input: {
  sessionId: string;
  messageId: MessageID;
}): MessagePart[] {
  const rows = sqliteAll<PartV2Row>(
    'SELECT * FROM part_v2 WHERE message_id = ? AND session_id = ? ORDER BY id ASC',
    [input.messageId, input.sessionId],
  );
  return rows.map((row) => partFromRow(row));
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
  return rows.map((row) => partFromRow(row));
}

// ─── Incremental Part Delta ───

export function updatePartDelta(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
  field: string;
  delta: string;
}): void {
  const row = sqliteGet<PartV2Row>(
    'SELECT * FROM part_v2 WHERE id = ? AND message_id = ? AND session_id = ?',
    [input.partId, input.messageId, input.sessionId],
  );
  if (!row) return;

  const data = JSON.parse(row.data) as Record<string, unknown>;
  const existing = typeof data[input.field] === 'string' ? (data[input.field] as string) : '';
  data[input.field] = existing + input.delta;

  sqliteRun("UPDATE part_v2 SET data = ?, updated_at = datetime('now') WHERE id = ?", [
    JSON.stringify(data),
    input.partId,
  ]);
}

// ─── Read Model: MessageWithParts ───

export function listMessagesWithParts(input: {
  sessionId: string;
  userId: string;
  limit?: number;
}): MessageWithParts[] {
  const messages = listMessages({ ...input, limit: input.limit });
  if (messages.length === 0) return [];

  const messageIds = messages.map((m) => m.id);
  const placeholders = messageIds.map(() => '?').join(',');
  const partRows = sqliteAll<PartV2Row>(
    `SELECT * FROM part_v2 WHERE session_id = ? AND message_id IN (${placeholders}) ORDER BY message_id, id ASC`,
    [input.sessionId, ...messageIds],
  );

  const partsByMessage = new Map<string, MessagePart[]>();
  for (const row of partRows) {
    const existing = partsByMessage.get(row.message_id) ?? [];
    existing.push(partFromRow(row));
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
    const part = partFromRow(row);
    if (part.type === 'tool' && part.callID === input.callID) {
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
  const nextState: ToolStateCompleted = {
    status: 'completed',
    input: running.input,
    output: input.output,
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
  const nextState: ToolStateError = {
    status: 'error',
    input: running.input,
    error: input.error,
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
  // Delete parts first (though FK cascade should handle it)
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

// ─── V1 → V2 Migration ───

export async function migrateV1ToV2(input: { sessionId: string; userId: string }): Promise<number> {
  // Import V1 store lazily to avoid circular deps
  const { listSessionMessages } = await import('./session-message-store.js');
  const v1Messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
  });

  let migrated = 0;
  for (const v1Msg of v1Messages) {
    const msgId = v1Msg.id as MessageID;
    const timeCreated = v1Msg.createdAt;

    // Create message row
    const info: MessageInfo =
      v1Msg.role === 'user'
        ? { id: msgId, sessionID: input.sessionId, role: 'user', time: { created: timeCreated } }
        : v1Msg.role === 'assistant'
          ? {
              id: msgId,
              sessionID: input.sessionId,
              role: 'assistant',
              time: { created: timeCreated },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            }
          : v1Msg.role === 'tool'
            ? {
                id: msgId,
                sessionID: input.sessionId,
                role: 'tool',
                time: { created: timeCreated },
              }
            : {
                id: msgId,
                sessionID: input.sessionId,
                role: 'system',
                time: { created: timeCreated },
              };

    insertMessage({ sessionId: input.sessionId, userId: input.userId, info });

    // Create part rows from content
    for (const content of v1Msg.content) {
      const partId = makePartId();
      let part: MessagePart;

      if (content.type === 'text') {
        part = {
          id: partId,
          sessionID: input.sessionId,
          messageID: msgId,
          type: 'text',
          text: content.text,
        };
      } else if (content.type === 'tool_call') {
        part = {
          id: partId,
          sessionID: input.sessionId,
          messageID: msgId,
          type: 'tool',
          callID: content.toolCallId,
          tool: content.toolName,
          state: {
            status: 'pending',
            input: content.input,
            raw: content.rawArguments ?? JSON.stringify(content.input),
          },
        };
      } else if (content.type === 'tool_result') {
        // Tool result → transition the existing ToolPart to completed/error
        const toolPart = findToolPartByCallID({
          sessionId: input.sessionId,
          callID: content.toolCallId,
        });
        if (toolPart) {
          const pending = toolPart.state as ToolStatePending;
          const nextState: ToolStateCompleted | ToolStateError = content.isError
            ? {
                status: 'error',
                input: pending.input,
                error:
                  typeof content.output === 'string'
                    ? content.output
                    : JSON.stringify(content.output),
                time: { start: timeCreated, end: timeCreated },
              }
            : {
                status: 'completed',
                input: pending.input,
                output:
                  typeof content.output === 'string'
                    ? content.output
                    : JSON.stringify(content.output),
                title: content.toolName ?? content.toolCallId,
                metadata: {},
                time: { start: timeCreated, end: timeCreated },
              };
          const updated: ToolPart = { ...toolPart, state: nextState };
          updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });
        }
        continue; // Don't create a separate part for tool_result
      } else if (content.type === 'modified_files_summary') {
        part = {
          id: partId,
          sessionID: input.sessionId,
          messageID: msgId,
          type: 'modified_files_summary',
          title: content.title,
          summary: content.summary,
          files: content.files,
        };
      } else {
        continue; // Skip unknown content types
      }

      insertPart({ sessionId: input.sessionId, userId: input.userId, part });
      migrated++;
    }

    migrated++;
  }

  return migrated;
}

// ─── filterCompacted (opencode pattern) ───
// When an assistant message has summary=true + finish + no error,
// its parentID is considered "compacted" (superseded by the summary).
// Also breaks on user messages with compaction part that are already completed.

export function filterCompacted(messages: Iterable<MessageWithParts>): MessageWithParts[] {
  const result: MessageWithParts[] = [];
  const completed = new Set<string>();

  for (const msg of messages) {
    result.push(msg);
    if (
      msg.info.role === 'user' &&
      completed.has(msg.info.id) &&
      msg.parts.some((part) => part.type === 'compaction')
    ) {
      break;
    }
    if (msg.info.role === 'assistant' && msg.info.summary && msg.info.finish && !msg.info.error) {
      completed.add(msg.info.parentID ?? '');
    }
  }

  result.reverse();
  return result;
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

  const messages = slice.map((row) => messageInfoFromRow(row));
  const messageIds = messages.map((m) => m.id);
  const placeholders = messageIds.map(() => '?').join(',');
  const partRows = sqliteAll<PartV2Row>(
    `SELECT * FROM part_v2 WHERE session_id = ? AND message_id IN (${placeholders}) ORDER BY message_id, id ASC`,
    [input.sessionId, ...messageIds],
  );

  const partsByMessage = new Map<string, MessagePart[]>();
  for (const row of partRows) {
    const existing = partsByMessage.get(row.message_id) ?? [];
    existing.push(partFromRow(row));
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
  return rows.map((row) => partFromRow(row));
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
  return {
    info: messageInfoFromRow(row),
    parts: partsForMessage(input.messageID),
  };
}

// ─── toModelMessages (opencode pattern) ───
// Converts V2 MessageWithParts[] into AI SDK compatible UIMessage[] format
// for sending to upstream providers.

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

export function toModelMessages(input: MessageWithParts[]): UIMessage[] {
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
          if (part.state.status === 'completed') {
            const outputText = part.state.time.compacted
              ? '[Old tool result content cleared]'
              : part.state.output;
            assistantMessage.parts.push({
              type: toolType,
              state: 'output-available',
              toolCallId: part.callID,
              input: part.state.input,
              output:
                part.state.attachments && part.state.attachments.length > 0
                  ? { text: outputText, attachments: part.state.attachments }
                  : outputText,
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              callProviderMetadata: part.metadata,
            });
          }
          if (part.state.status === 'error') {
            const interruptedOutput =
              part.state.metadata?.interrupted === true ? part.state.metadata.output : undefined;
            if (typeof interruptedOutput === 'string') {
              assistantMessage.parts.push({
                type: toolType,
                state: 'output-available',
                toolCallId: part.callID,
                input: part.state.input,
                output: interruptedOutput,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                callProviderMetadata: part.metadata,
              });
            } else {
              assistantMessage.parts.push({
                type: toolType,
                state: 'output-error',
                toolCallId: part.callID,
                input: part.state.input,
                errorText: part.state.error,
                ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
                callProviderMetadata: part.metadata,
              });
            }
          }
          // Handle pending/running tool calls — treat as interrupted
          if (part.state.status === 'pending' || part.state.status === 'running') {
            assistantMessage.parts.push({
              type: toolType,
              state: 'output-error',
              toolCallId: part.callID,
              input: part.state.input,
              errorText: '[Tool execution was interrupted]',
              ...(part.metadata?.providerExecuted ? { providerExecuted: true } : {}),
              callProviderMetadata: part.metadata,
            });
          }
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

export function fromError(
  e: unknown,
  ctx: { providerID?: string; aborted?: boolean },
): NonNullable<AssistantMessage['error']> {
  if (e instanceof DOMException && e.name === 'AbortError') {
    return { name: 'AbortedError', message: e.message };
  }
  if (e instanceof Error) {
    const message = e.message || String(e);
    // Check for auth/key errors
    if (message.includes('API key') || message.includes('api_key') || message.includes('apiKey')) {
      return { name: 'AuthError', message: `Provider ${ctx.providerID ?? 'unknown'}: ${message}` };
    }
    // Check for context overflow / token limit
    if (
      message.includes('context_length_exceeded') ||
      message.includes('max_tokens') ||
      message.includes('token limit')
    ) {
      return { name: 'ContextOverflowError', message };
    }
    // Check for connection errors
    if ((e as NodeJS.ErrnoException).code === 'ECONNRESET') {
      return { name: 'APIError', message: 'Connection reset by server' };
    }
    // Check for abort during stream
    if (ctx.aborted) {
      return { name: 'AbortedError', message };
    }
    // Generic API error
    return { name: 'APIError', message };
  }
  return { name: 'UnknownError', message: JSON.stringify(e) };
}
