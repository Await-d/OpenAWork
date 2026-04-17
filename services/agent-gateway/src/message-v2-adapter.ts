/**
 * V2 Message Adapter — V2 storage is the authoritative source.
 *
 * Purpose:
 * - Provides V1-compatible functions that internally use the V2 Session→Message→Part model
 * - V1 dual-write has been removed; all reads/writes go through V2 tables
 * - All request-scope operations are now V2-native
 * - Key benefit: ToolState machine (pending→running→completed/error) replaces
 *   the pendingPermissionRequestId hack
 */

import type {
  FileDiffContent,
  Message,
  MessageContent,
  MessageRole,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import { randomUUID } from 'node:crypto';
import { sqliteAll, sqliteRun } from './db.js';
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
    ...(info.clientRequestId ? { clientRequestId: info.clientRequestId } : {}),
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

  // ── V2 write: message_v2 + part_v2 via SyncEvent ──
  const baseInfo = {
    id: msgId,
    sessionID: input.sessionId,
    ...(input.clientRequestId ? { clientRequestId: input.clientRequestId } : {}),
    ...(input.status ? { status: input.status as MessageInfo['status'] } : {}),
  };
  const info: MessageInfo =
    input.role === 'user'
      ? { ...baseInfo, role: 'user', time: { created: timeCreated } }
      : input.role === 'assistant'
        ? {
            ...baseInfo,
            role: 'assistant',
            time: { created: timeCreated },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          }
        : input.role === 'tool'
          ? { ...baseInfo, role: 'tool', time: { created: timeCreated } }
          : { ...baseInfo, role: 'system', time: { created: timeCreated } };

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

  // Return a V1-compatible Message object
  return {
    id: msgId,
    role: input.role,
    createdAt: timeCreated,
    content: input.content,
  };
}

const COMPACTION_MARKER_TYPE = 'compaction_marker';
const INTERNAL_ASSISTANT_EVENT_SOURCE = 'openAwork';

export function appendCompactionMarkerMessageV2(input: {
  legacyMessagesJson?: string;
  omittedMessages?: number;
  persistedMemory?: unknown;
  sessionId: string;
  signature?: string;
  summary: string;
  trigger: string;
  userId: string;
}): Message {
  const payload = {
    source: INTERNAL_ASSISTANT_EVENT_SOURCE,
    type: COMPACTION_MARKER_TYPE,
    payload: {
      summary: input.summary,
      trigger: input.trigger,
      ...(input.persistedMemory ? { persistedMemory: input.persistedMemory } : {}),
      ...(typeof input.signature === 'string' && input.signature.length > 0
        ? { signature: input.signature }
        : {}),
      ...(typeof input.omittedMessages === 'number'
        ? { omittedMessages: input.omittedMessages }
        : {}),
    },
  };

  return appendSessionMessageV2({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    legacyMessagesJson: input.legacyMessagesJson,
    clientRequestId: `compaction-marker:${input.signature ?? randomUUID()}`,
  });
}

export function listSessionMessagesV2(input: {
  sessionId: string;
  userId: string;
  legacyMessagesJson?: string;
  statuses?: string[];
  limit?: number;
}): Message[] {
  // V2 is now the authoritative read source
  const statusSet = input.statuses ? new Set(input.statuses) : null;
  return listMessagesWithParts({
    sessionId: input.sessionId,
    userId: input.userId,
    limit: input.limit,
  })
    .filter((message) => {
      if (!statusSet) return true;
      // message.info.status defaults to 'final' when unset for backward compatibility
      const status = message.info.status ?? 'final';
      return statusSet.has(status);
    })
    .map((message) => v2ToV1Message(message))
    .filter((message) => message.content.length > 0);
}

export function truncateSessionMessagesAfterV2(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  legacyMessagesJson?: string;
  inclusive?: boolean;
}): Message[] {
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

  // Return remaining messages from V2
  return listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId });
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

// ─── V2-native request-scope operations ───

export function getSessionMessageByRequestId(input: {
  clientRequestId: string;
  role: MessageRole;
  sessionId: string;
  userId: string;
}): { message: Message; status: 'final' | 'error' } | null {
  const messages = listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId });
  const msg = messages.find(
    (m) => m.role === input.role && m.clientRequestId === input.clientRequestId,
  );
  if (!msg) return null;
  return {
    message: msg,
    status: (msg as Message & { status?: string }).status === 'error' ? 'error' : 'final',
  };
}

export function listSessionMessagesByRequestScope(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): Message[] {
  const messages = listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId });
  return messages.filter(
    (m) =>
      m.clientRequestId === input.clientRequestId ||
      m.clientRequestId?.startsWith(`${input.clientRequestId}:`) === true,
  );
}

export function updateSessionMessagesStatusByRequestScope(input: {
  clientRequestId: string;
  roles?: MessageRole[];
  sessionId: string;
  status: 'final' | 'error';
  userId: string;
}): void {
  const roleFilter = input.roles ? new Set(input.roles) : null;
  const rows = sqliteAll<{ id: string; data: string }>(
    'SELECT id, data FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId],
  );
  const targetIds = rows
    .filter((row) => {
      const data = JSON.parse(row.data) as MessageInfo;
      const matchesRequest =
        data.clientRequestId === input.clientRequestId ||
        data.clientRequestId?.startsWith(`${input.clientRequestId}:`) === true;
      const matchesRole = roleFilter ? roleFilter.has(data.role) : true;
      return matchesRequest && matchesRole;
    })
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return;
  }

  for (const id of targetIds) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const data = JSON.parse(row.data) as MessageInfo;
    const updated = { ...data, status: input.status };
    sqliteRun("UPDATE message_v2 SET data = ?, updated_at = datetime('now') WHERE id = ?", [
      JSON.stringify(updated),
      id,
    ]);
  }
}

export function deleteSessionMessagesByRequestScope(input: {
  clientRequestId: string;
  roles?: MessageRole[];
  sessionId: string;
  userId: string;
}): void {
  const roleFilter = input.roles ? new Set(input.roles) : null;
  const rows = sqliteAll<{ id: string; data: string }>(
    'SELECT id, data FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId],
  );
  const targetIds = rows
    .filter((row) => {
      const data = JSON.parse(row.data) as MessageInfo;
      const matchesRequest =
        data.clientRequestId === input.clientRequestId ||
        data.clientRequestId?.startsWith(`${input.clientRequestId}:`) === true;
      const matchesRole = roleFilter ? roleFilter.has(data.role) : true;
      return matchesRequest && matchesRole;
    })
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return;
  }

  for (const id of targetIds) {
    sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [id, input.sessionId]);
  }
  const placeholders = targetIds.map(() => '?').join(',');
  sqliteRun(
    `DELETE FROM message_v2 WHERE session_id = ? AND user_id = ? AND id IN (${placeholders})`,
    [input.sessionId, input.userId, ...targetIds],
  );
}

// ─── V2-native implementations (no V1 dependency) ───

export interface StoredToolResult {
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  isError: boolean;
  output: unknown;
  pendingPermissionRequestId?: string;
  resumedAfterApproval?: boolean;
  observability?: ToolCallObservabilityAnnotation;
  toolCallId: string;
  toolName?: string;
}

const MAX_INLINE_TOOL_OUTPUT_BYTES = 8 * 1024;

function shouldReferenceToolOutput(
  output: unknown,
  serialized = typeof output === 'string' ? output : JSON.stringify(output),
  sizeBytes = Buffer.byteLength(serialized, 'utf8'),
): boolean {
  return sizeBytes > MAX_INLINE_TOOL_OUTPUT_BYTES;
}

export function getSessionToolResultByCallId(input: {
  sessionId: string;
  toolCallId: string;
  userId: string;
}): StoredToolResult | null {
  const messages = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
  });

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool') {
      continue;
    }

    for (const content of message.content) {
      if (content.type !== 'tool_result' || content.toolCallId !== input.toolCallId) {
        continue;
      }

      return {
        toolCallId: content.toolCallId,
        toolName: content.toolName,
        clientRequestId: content.clientRequestId,
        output: content.output,
        isError: content.isError,
        fileDiffs: content.fileDiffs,
        pendingPermissionRequestId: content.pendingPermissionRequestId,
        resumedAfterApproval: content.resumedAfterApproval,
        observability: content.observability,
      };
    }
  }

  return null;
}

export function getLatestReferencedToolResult(input: {
  sessionId: string;
  userId: string;
}): StoredToolResult | null {
  const messages = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
  });

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== 'tool') {
      continue;
    }

    for (let contentIndex = message.content.length - 1; contentIndex >= 0; contentIndex -= 1) {
      const content = message.content[contentIndex];
      if (content?.type !== 'tool_result' || !shouldReferenceToolOutput(content.output)) {
        continue;
      }

      return {
        toolCallId: content.toolCallId,
        toolName: content.toolName,
        clientRequestId: content.clientRequestId,
        output: content.output,
        isError: content.isError,
        fileDiffs: content.fileDiffs,
        pendingPermissionRequestId: content.pendingPermissionRequestId,
        resumedAfterApproval: content.resumedAfterApproval,
        observability: content.observability,
      };
    }
  }

  return null;
}
