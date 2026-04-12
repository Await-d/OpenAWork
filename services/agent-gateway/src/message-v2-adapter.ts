/**
 * V2 Message Adapter — bridges V1 API surface to V2 storage.
 *
 * Purpose:
 * - Provides V1-compatible functions (appendSessionMessage, listSessionMessages, etc.)
 *   that internally use the V2 Session→Message→Part model
 * - Allows gradual migration: existing code calls V1 API, V2 storage handles the data
 * - Key benefit: ToolState machine (pending→running→completed/error) replaces
 *   the pendingPermissionRequestId hack
 */

import type { Message, MessageContent, MessageRole } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';
import {
  appendSessionMessage as v1AppendSessionMessage,
  listSessionMessages as v1ListSessionMessages,
  truncateSessionMessagesAfter as v1TruncateSessionMessagesAfter,
} from './session-message-store.js';
import {
  type MessageID,
  type PartID,
  type MessageInfo,
  type MessagePart,
  type MessageWithParts,
  type TextPart,
  type ToolPart,
  type ModifiedFilesSummaryPart,
  type ToolStatePending,
  type ToolStateRunning,
  makeMessageId,
  makePartId,
} from './message-v2-schema.js';
import {
  updatePart,
  getPart,
  listMessagesWithParts,
  findToolPartByCallID,
  transitionToolToRunning,
} from './message-store-v2.js';
import {
  emitEvent,
  MessageEvents,
  SessionEvents,
  type SessionInfo,
  type DeepPartial,
  publishBusEvent,
  SessionBusEvents,
  TodoBusEvents,
} from './sync-event.js';
import type { SnapshotPart, PatchPart } from './message-v2-schema.js';
import { listSessionSnapshots } from './session-snapshot-store.js';
import { listSessionFileDiffs } from './session-file-diff-store.js';

// Ensure projectors are registered
import './message-v2-projectors.js';

// ─── V1 → V2 Conversion ───

function v2ToV1Message(withParts: MessageWithParts): Message {
  const { info, parts } = withParts;
  const content: MessageContent[] = [];

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        content.push({ type: 'text', text: part.text });
        break;
      case 'reasoning':
        // Reasoning is embedded in assistant trace content, not a separate MessageContent
        // Skip here — handled by buildAssistantTraceContent
        break;
      case 'tool': {
        const toolPart = part;
        // Emit tool_call
        content.push({
          type: 'tool_call',
          toolCallId: toolPart.callID,
          toolName: toolPart.tool,
          input: (toolPart.state as ToolStatePending | ToolStateRunning).input,
          rawArguments: (toolPart.state as ToolStatePending).raw,
        });
        // Emit tool_result if completed or error
        if (toolPart.state.status === 'completed') {
          const completed = toolPart.state;
          content.push({
            type: 'tool_result',
            toolCallId: toolPart.callID,
            toolName: toolPart.tool,
            output: completed.output,
            isError: false,
            fileDiffs: [],
          });
        } else if (toolPart.state.status === 'error') {
          const errored = toolPart.state;
          content.push({
            type: 'tool_result',
            toolCallId: toolPart.callID,
            toolName: toolPart.tool,
            output: errored.error,
            isError: true,
          });
        } else if (toolPart.state.status === 'pending') {
          // Tool is pending permission — this is the V2 equivalent of pendingPermissionRequestId
          content.push({
            type: 'tool_result',
            toolCallId: toolPart.callID,
            toolName: toolPart.tool,
            output: `Tool "${toolPart.tool}" is waiting for approval.`,
            isError: true,
            pendingPermissionRequestId: toolPart.callID, // Use callID as permission ref
          });
        }
        break;
      }
      case 'modified_files_summary': {
        const summary = part;
        content.push({
          type: 'modified_files_summary',
          title: summary.title,
          summary: summary.summary,
          files: summary.files,
        });
        break;
      }
      // step-start, step-finish, compaction, subtask, retry, snapshot, patch
      // are not V1 MessageContent types — skip
    }
  }

  return {
    id: info.id,
    role: info.role,
    createdAt: info.time.created,
    content,
  };
}

// ─── V1-Compatible API ───

export function appendSessionMessageV2(input: {
  sessionId: string;
  userId: string;
  role: MessageRole;
  content: MessageContent[];
  legacyMessagesJson?: string;
  clientRequestId?: string | null;
  createdAt?: number;
  messageId?: string;
  replaceExisting?: boolean;
  status?: string;
}): Message {
  const msgId = (input.messageId ?? makeMessageId()) as MessageID;
  const timeCreated = input.createdAt ?? Date.now();

  // ── Dual-write: V1 (session_messages) for backward compatibility ──
  const v1Result = v1AppendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: input.role,
    content: input.content,
    legacyMessagesJson: input.legacyMessagesJson,
    clientRequestId: input.clientRequestId,
    createdAt: input.createdAt,
    messageId: msgId,
    replaceExisting: input.replaceExisting,
    status: input.status as 'final' | 'error' | undefined,
  });

  // ── V2 write: message_v2 + part_v2 via SyncEvent ──
  const info: MessageInfo =
    input.role === 'user'
      ? { id: msgId, sessionID: input.sessionId, role: 'user', time: { created: timeCreated } }
      : input.role === 'assistant'
        ? {
            id: msgId,
            sessionID: input.sessionId,
            role: 'assistant',
            time: { created: timeCreated },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
        : input.role === 'tool'
          ? { id: msgId, sessionID: input.sessionId, role: 'tool', time: { created: timeCreated } }
          : {
              id: msgId,
              sessionID: input.sessionId,
              role: 'system',
              time: { created: timeCreated },
            };

  // Emit event → projector writes to V2 DB
  emitEvent({
    definition: MessageEvents.Created,
    aggregateID: input.sessionId,
    data: { sessionID: input.sessionId, info },
  });

  // Create parts from content
  for (const c of input.content) {
    const partId = makePartId();

    if (c.type === 'text') {
      const part: TextPart = {
        id: partId,
        sessionID: input.sessionId,
        messageID: msgId,
        type: 'text',
        text: c.text,
      };
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: { sessionID: input.sessionId, part },
      });
    } else if (c.type === 'tool_call') {
      const part: ToolPart = {
        id: partId,
        sessionID: input.sessionId,
        messageID: msgId,
        type: 'tool',
        callID: c.toolCallId,
        tool: c.toolName,
        state: {
          status: 'pending',
          input: c.input,
          raw: c.rawArguments ?? JSON.stringify(c.input),
        },
      };
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: { sessionID: input.sessionId, part },
      });
    } else if (c.type === 'tool_result') {
      // Find the existing ToolPart and transition its state
      const toolPart = findToolPartByCallID({
        sessionId: input.sessionId,
        callID: c.toolCallId,
      });

      if (toolPart) {
        let updatedPart: ToolPart;
        if (c.isError) {
          updatedPart = {
            ...toolPart,
            state: {
              status: 'error',
              input: (toolPart.state as ToolStatePending).input,
              error: typeof c.output === 'string' ? c.output : JSON.stringify(c.output),
              time: { start: timeCreated, end: timeCreated },
            },
          };
        } else {
          updatedPart = {
            ...toolPart,
            state: {
              status: 'completed',
              input: (toolPart.state as ToolStatePending).input,
              output: typeof c.output === 'string' ? c.output : JSON.stringify(c.output),
              title: c.toolName ?? c.toolCallId,
              metadata: {},
              time: { start: timeCreated, end: timeCreated },
            },
          };
        }
        emitEvent({
          definition: MessageEvents.PartUpdated,
          aggregateID: input.sessionId,
          data: { sessionID: input.sessionId, part: updatedPart, time: Date.now() },
        });
      }
    } else if (c.type === 'modified_files_summary') {
      const part: ModifiedFilesSummaryPart = {
        id: partId,
        sessionID: input.sessionId,
        messageID: msgId,
        type: 'modified_files_summary',
        title: c.title,
        summary: c.summary,
        files: c.files,
      };
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: { sessionID: input.sessionId, part },
      });
    }
  }

  // Return the V1 result (authoritative for backward compat)
  return v1Result;
}

export function listSessionMessagesV2(input: {
  sessionId: string;
  userId: string;
  legacyMessagesJson?: string;
  statuses?: string[];
  limit?: number;
}): Message[] {
  // During dual-write transition, V1 is the authoritative read source
  return v1ListSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.legacyMessagesJson,
    statuses: input.statuses as ('final' | 'error')[] | undefined,
  });
}

export function truncateSessionMessagesAfterV2(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  legacyMessagesJson?: string;
  inclusive?: boolean;
}): Message[] {
  // ── Dual-write: truncate V1 table ──
  const v1Result = v1TruncateSessionMessagesAfter({
    sessionId: input.sessionId,
    userId: input.userId,
    messageId: input.messageId,
    legacyMessagesJson: input.legacyMessagesJson,
    inclusive: input.inclusive,
  });

  // ── V2 truncate: delete messages after the given messageId ──
  const rows = sqliteAll<{ id: string; time_created: number }>(
    'SELECT id, time_created FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId],
  );
  const targetIndex = rows.findIndex((row) => row.id === input.messageId);
  if (targetIndex !== -1) {
    const cutoffIndex = input.inclusive === false ? targetIndex + 1 : targetIndex;
    const deleteIds = rows.slice(cutoffIndex).map((r) => r.id);

    if (deleteIds.length > 0) {
      for (const id of deleteIds) {
        sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [
          id,
          input.sessionId,
        ]);
      }
      const placeholders = deleteIds.map(() => '?').join(',');
      sqliteRun(
        `DELETE FROM message_v2 WHERE session_id = ? AND user_id = ? AND id IN (${placeholders})`,
        [input.sessionId, input.userId, ...deleteIds],
      );
    }
  }

  // Return V1 result (authoritative for backward compat)
  return v1Result;
}

// ─── Tool Permission Flow (V2 native) ───

/**
 * In V2, tool permission pause is handled natively by ToolState:
 * - ToolPart.state = { status: 'pending' } → tool needs permission
 * - No need for pendingPermissionRequestId hack
 * - Approval → transitionToolToRunning → transitionToolToCompleted
 * - Rejection → transitionToolToError
 */
export function isToolPendingPermission(input: { sessionId: string; callID: string }): boolean {
  const part = findToolPartByCallID({ sessionId: input.sessionId, callID: input.callID });
  return part?.type === 'tool' && part.state.status === 'pending';
}

export function approveToolPermission(input: {
  sessionId: string;
  userId: string;
  callID: string;
  title?: string;
}): ToolPart | undefined {
  return transitionToolToRunning({
    sessionId: input.sessionId,
    userId: input.userId,
    callID: input.callID,
    title: input.title,
  });
}

export function rejectToolPermission(input: {
  sessionId: string;
  userId: string;
  callID: string;
  error: string;
}): ToolPart | undefined {
  const part = findToolPartByCallID({ sessionId: input.sessionId, callID: input.callID });
  if (!part || part.type !== 'tool') return undefined;

  const pending = part.state as ToolStatePending;
  const updated: ToolPart = {
    ...part,
    state: {
      status: 'error',
      input: pending.input,
      error: input.error,
      time: { start: Date.now(), end: Date.now() },
    },
  };
  updatePart({ sessionId: input.sessionId, userId: input.userId, part: updated });
  return updated;
}

// ─── Part Delta (streaming) ───

export function appendTextDelta(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
  delta: string;
}): void {
  emitEvent({
    definition: MessageEvents.PartDelta,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: input.messageId,
      partID: input.partId,
      field: 'text',
      delta: input.delta,
    },
  });
}

function isAssistantEventText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' && parsed.source === 'openawork_internal';
  } catch {
    return false;
  }
}

function isRuntimeSafeV2Message(message: Message): boolean {
  if (message.role === 'tool') {
    return true;
  }

  return message.content.some((content) => {
    if (content.type === 'tool_call' || content.type === 'tool_result') {
      return true;
    }
    if (content.type === 'modified_files_summary') {
      return true;
    }
    return content.type === 'text' && isAssistantEventText(content.text);
  });
}

export function listRuntimeSafeSessionMessagesV2(input: {
  sessionId: string;
  userId: string;
  limit?: number;
}): Message[] {
  return listMessagesWithParts({
    sessionId: input.sessionId,
    userId: input.userId,
    limit: input.limit,
  })
    .map((message) => v2ToV1Message(message))
    .filter((message) => message.content.length > 0)
    .filter((message) => isRuntimeSafeV2Message(message));
}

export function appendReasoningDelta(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
  delta: string;
}): void {
  emitEvent({
    definition: MessageEvents.PartDelta,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: input.messageId,
      partID: input.partId,
      field: 'text',
      delta: input.delta,
    },
  });
}

// ─── Event-sourced removeMessage (opencode pattern) ───

export function removeMessageV2(input: { sessionId: string; messageID: MessageID }): void {
  emitEvent({
    definition: MessageEvents.Removed,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: input.messageID,
    },
  });
}

// ─── Event-sourced removePart (opencode pattern) ───

export function removePartV2(input: {
  sessionId: string;
  messageID: MessageID;
  partID: PartID;
}): void {
  emitEvent({
    definition: MessageEvents.PartRemoved,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      messageID: input.messageID,
      partID: input.partID,
    },
  });
}

// ─── Event-sourced updatePart (opencode pattern) ───

export function updatePartV2(input: { sessionId: string; part: MessagePart; time?: number }): void {
  emitEvent({
    definition: MessageEvents.PartUpdated,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      part: input.part,
      time: input.time ?? Date.now(),
    },
  });
}

// ─── Event-sourced updatePartDelta (opencode pattern) ───

export function updatePartDeltaV2(input: {
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

// ─── getPart (opencode pattern) ───

export function getPartV2(input: {
  sessionId: string;
  messageId: MessageID;
  partId: PartID;
}): MessagePart | undefined {
  return getPart({
    sessionId: input.sessionId,
    messageId: input.messageId,
    partId: input.partId,
  });
}

// ─── findMessage (opencode pattern) ───

export function findMessageV2(input: {
  sessionId: string;
  userId: string;
  predicate: (msg: MessageWithParts) => boolean;
}): MessageWithParts | undefined {
  const messages = listMessagesWithParts({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    if (input.predicate(msg)) {
      return msg;
    }
  }
  return undefined;
}

// ─── Snapshot/Patch Part Integration (opencode pattern) ───
// In opencode, step-start creates a SnapshotPart and step-finish creates a PatchPart.
// These Parts link messages to file storage, enabling revert and diff tracking.

export function appendSnapshotPart(input: {
  sessionId: string;
  messageId: MessageID;
  snapshotRef: string;
}): void {
  const part: SnapshotPart = {
    type: 'snapshot',
    id: makePartId(),
    sessionID: input.sessionId,
    messageID: input.messageId,
    snapshot: input.snapshotRef,
  };
  emitEvent({
    definition: MessageEvents.PartCreated,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      part,
    },
  });
}

export function appendPatchPart(input: {
  sessionId: string;
  messageId: MessageID;
  hash: string;
  files: string[];
}): void {
  const part: PatchPart = {
    type: 'patch',
    id: makePartId(),
    sessionID: input.sessionId,
    messageID: input.messageId,
    hash: input.hash,
    files: input.files,
  };
  emitEvent({
    definition: MessageEvents.PartCreated,
    aggregateID: input.sessionId,
    data: {
      sessionID: input.sessionId,
      part,
    },
  });
}

// Build a PatchPart from session file diffs for a given request
export function buildPatchPartFromDiffs(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
  messageId: MessageID;
}): PatchPart | null {
  const diffs = listSessionFileDiffs({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const requestDiffs = diffs.filter((d) => d.clientRequestId === input.clientRequestId);
  if (requestDiffs.length === 0) return null;

  const files = requestDiffs.map((d) => d.file);
  const hash = requestDiffs.map((d) => `${d.file}:${d.additions}:${d.deletions}`).join('|');
  return {
    type: 'patch',
    id: makePartId(),
    sessionID: input.sessionId,
    messageID: input.messageId,
    hash,
    files,
  };
}

// Build a SnapshotPart from session snapshot for a given request
export function buildSnapshotPartFromSnapshot(input: {
  sessionId: string;
  userId: string;
  clientRequestId: string;
  messageId: MessageID;
}): SnapshotPart | null {
  const snapshots = listSessionSnapshots({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const requestSnapshots = snapshots.filter((s) => s.clientRequestId === input.clientRequestId);
  if (requestSnapshots.length === 0) return null;

  const snapshot = requestSnapshots[0]!;
  return {
    type: 'snapshot',
    id: makePartId(),
    sessionID: input.sessionId,
    messageID: input.messageId,
    snapshot: snapshot.snapshotRef,
  };
}

// ─── Session Event Adapters (opencode pattern) ───

export function emitSessionCreated(input: { sessionID: string; info: SessionInfo }): void {
  emitEvent({
    definition: SessionEvents.Created,
    aggregateID: input.sessionID,
    data: {
      sessionID: input.sessionID,
      info: input.info,
    },
  });
}

export function emitSessionUpdated(input: {
  sessionID: string;
  info: DeepPartial<SessionInfo>;
}): void {
  emitEvent({
    definition: SessionEvents.Updated,
    aggregateID: input.sessionID,
    data: {
      sessionID: input.sessionID,
      info: input.info,
    },
  });
}

export function emitSessionDeleted(input: { sessionID: string; info: SessionInfo }): void {
  emitEvent({
    definition: SessionEvents.Deleted,
    aggregateID: input.sessionID,
    data: {
      sessionID: input.sessionID,
      info: input.info,
    },
  });
}

// ─── Session Revert (opencode pattern) ───
// Reverts the session to the state at a specific message/part.
// Stores revert info on the session for later undo.

export function sessionRevert(input: {
  sessionID: string;
  messageID: string;
  partID?: string;
  snapshot?: string;
  diff?: string;
}): void {
  emitSessionUpdated({
    sessionID: input.sessionID,
    info: {
      revert: {
        messageID: input.messageID,
        partID: input.partID,
        snapshot: input.snapshot,
        diff: input.diff,
      },
    },
  });
}

export function sessionUnrevert(input: { sessionID: string }): void {
  emitSessionUpdated({
    sessionID: input.sessionID,
    info: {
      revert: null,
    },
  });
}

// ─── Session Diff/Error BusEvents (opencode pattern) ───

export function publishSessionDiff(input: {
  sessionID: string;
  diffs: Array<{ file: string; patch: string }>;
}): void {
  publishBusEvent(SessionBusEvents.Diff.type, {
    sessionID: input.sessionID,
    diff: input.diffs,
  });
}

export function publishSessionError(input: {
  sessionID?: string;
  error: { name: string; message: string };
}): void {
  publishBusEvent(SessionBusEvents.Error.type, {
    sessionID: input.sessionID,
    error: input.error,
  });
}

export function publishSessionCompacted(input: { sessionID: string }): void {
  publishBusEvent(SessionBusEvents.Compacted.type, {
    sessionID: input.sessionID,
  });
}

export function publishSessionStatus(input: { sessionID: string; status: string }): void {
  publishBusEvent(SessionBusEvents.Status.type, {
    sessionID: input.sessionID,
    status: input.status,
  });
}

export function publishTodoUpdated(input: {
  sessionID: string;
  todos: Array<{ content: string; status: string; priority: string }>;
}): void {
  publishBusEvent(TodoBusEvents.Updated.type, {
    sessionID: input.sessionID,
    todos: input.todos,
  });
}
