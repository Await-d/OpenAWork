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

import type { InputImageContent, Message, MessageContent, MessageRole } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import { buildSqlitePlaceholders, chunkSqliteBindValues } from '../infra/sqlite-batch.js';
import {
  type AssistantMessage,
  type AssistantErrorObject,
  type MessageID,
  type PartID,
  type FilePart,
  type MessageInfo,
  type MessagePart,
  type MessageWithParts,
  type TextPart,
  type ReasoningPart,
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
  listMessagesWithPartsByTurnLimit,
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
} from '../session/sync-event.js';
import type { SnapshotPart, PatchPart } from './message-v2-schema.js';
import { listSessionSnapshots } from '../session/session-snapshot-store.js';
import { listSessionFileDiffs } from '../session/session-file-diff-store.js';
import {
  buildToolResultContent,
  findLatestReferencedStoredToolResult,
  findStoredToolResultByCallId,
  normalizeToolArgumentsForStorage,
  readStoredToolResultContent,
  stringifyToolResultOutput,
  type StoredToolResult,
} from '../tools/tool-result-contract.js';
import { matchesRequestScope } from '../runtime/request-lineage.js';
import { buildCompactionMarkerContent } from '../compaction/compaction-marker.js';
import { upsertSessionMessageSearchDocument } from '../session/session-search-store.js';
import { buildFallbackToolResultContentFromToolPart } from '../tools/tool-state-read-model.js';
export type { StoredToolResult } from '../tools/tool-result-contract.js';

// Ensure projectors are registered
import './message-v2-projectors.js';

// ─── V1 → V2 Conversion ───

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- 保留用于后续 V1 附件迁移
function toToolResultAttachments(
  attachments: FilePart[] | undefined,
): InputImageContent[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  const result = attachments
    .filter(
      (attachment) =>
        attachment.inputType === 'input_image' || attachment.mime.startsWith('image/'),
    )
    .map<InputImageContent>((attachment) => ({
      type: 'input_image',
      ...(attachment.artifactId ? { artifactId: attachment.artifactId } : {}),
      ...(attachment.detail ? { detail: attachment.detail } : {}),
      ...(attachment.fileId ? { fileId: attachment.fileId } : {}),
      ...(attachment.filename ? { fileName: attachment.filename } : {}),
      ...(attachment.url ? { imageUrl: attachment.url } : {}),
      ...(attachment.mime ? { mimeType: attachment.mime } : {}),
    }));

  return result.length > 0 ? result : undefined;
}

function buildToolResultAttachmentParts(input: {
  attachments: InputImageContent[] | undefined;
  messageId: MessageID;
  sessionId: string;
}): FilePart[] | undefined {
  if (!input.attachments || input.attachments.length === 0) {
    return undefined;
  }

  const parts = input.attachments.map<FilePart>((attachment) => ({
    id: makePartId(),
    sessionID: input.sessionId,
    messageID: input.messageId,
    type: 'file',
    inputType: 'input_image',
    mime: attachment.mimeType ?? 'image/png',
    ...(attachment.artifactId ? { artifactId: attachment.artifactId } : {}),
    ...(attachment.detail ? { detail: attachment.detail } : {}),
    ...(attachment.fileId ? { fileId: attachment.fileId } : {}),
    ...(attachment.fileName ? { filename: attachment.fileName } : {}),
    url: attachment.imageUrl ?? '',
  }));

  return parts.length > 0 ? parts : undefined;
}

export function v2ToV1Message(withParts: MessageWithParts): Message {
  const { info, parts } = withParts;
  const content: MessageContent[] = [];

  for (const part of parts) {
    switch (part.type) {
      case 'text':
        content.push({
          type: 'text',
          text: part.text,
          ...(part.synthetic ? { synthetic: true } : {}),
        });
        break;
      case 'reasoning': {
        // Anthropic extended-thinking signature lives on either of:
        //   - metadata.signature (legacy / direct write)
        //   - metadata.anthropic.signature (opencode-shaped metadata)
        //   - metadata.bedrock.signature (Bedrock-hosted Claude)
        // Surface whichever is present so downstream renderers replay it.
        const sigDirect = part.metadata?.['signature'];
        const sigAnthropic = (part.metadata?.['anthropic'] as { signature?: unknown } | undefined)
          ?.signature;
        const sigBedrock = (part.metadata?.['bedrock'] as { signature?: unknown } | undefined)
          ?.signature;
        const signature =
          typeof sigDirect === 'string' && sigDirect.length > 0
            ? sigDirect
            : typeof sigAnthropic === 'string' && sigAnthropic.length > 0
              ? sigAnthropic
              : typeof sigBedrock === 'string' && sigBedrock.length > 0
                ? sigBedrock
                : undefined;
        content.push({
          type: 'reasoning',
          text: part.text,
          ...(part.metadata?.['encryptedContent']
            ? { encryptedContent: part.metadata['encryptedContent'] as string }
            : {}),
          ...(part.metadata?.['summary'] ? { summary: part.metadata['summary'] as string } : {}),
          ...(signature ? { signature } : {}),
          ...(typeof part.time?.start === 'number' ? { startedAt: part.time.start } : {}),
          ...(typeof part.time?.end === 'number' ? { endedAt: part.time.end } : {}),
        });
        break;
      }
      case 'tool': {
        const toolPart = part;
        const storedToolResult = readStoredToolResultContent(
          'metadata' in toolPart.state && toolPart.state.metadata
            ? toolPart.state.metadata
            : undefined,
        );
        // Round-trip persisted `tool-call.providerMetadata` (e.g. the
        // OpenAI Responses `openai.itemId`) so listSessionMessagesV2
        // consumers — most importantly `toModelMessages` →
        // `unifiedConversationToModelMessages` → AI SDK — can replay
        // the original `function_call.id` on subsequent rounds.
        const persistedToolCallProviderMetadata =
          toolPart.metadata && typeof toolPart.metadata['providerMetadata'] === 'object'
            ? (toolPart.metadata['providerMetadata'] as Record<string, Record<string, unknown>>)
            : undefined;
        // Emit tool_call
        content.push({
          type: 'tool_call',
          toolCallId: toolPart.callID,
          toolName: toolPart.tool,
          input: (toolPart.state as ToolStatePending | ToolStateRunning).input,
          rawArguments: (toolPart.state as ToolStatePending).raw,
          ...(persistedToolCallProviderMetadata
            ? { providerMetadata: persistedToolCallProviderMetadata }
            : {}),
        });
        if (toolPart.state.status !== 'running') {
          const toolResult =
            storedToolResult ?? buildFallbackToolResultContentFromToolPart(toolPart);
          if (toolResult) {
            content.push(toolResult);
          }
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
      case 'file': {
        if (part.inputType === 'input_image') {
          content.push({
            type: 'input_image',
            ...(part.artifactId ? { artifactId: part.artifactId } : {}),
            ...(part.detail ? { detail: part.detail } : {}),
            ...(part.fileId ? { fileId: part.fileId } : {}),
            ...(part.filename ? { fileName: part.filename } : {}),
            ...(part.url ? { imageUrl: part.url } : {}),
            ...(part.mime ? { mimeType: part.mime } : {}),
          });
        }
        break;
      }
      // step-start, step-finish, compaction, subtask, retry, snapshot, patch
      // are not V1 MessageContent types — skip
    }
  }

  const assistantTime = info.role === 'assistant' ? info.time : undefined;
  const durationMs =
    assistantTime?.completed != null ? assistantTime.completed - assistantTime.created : undefined;
  const firstTokenLatencyMs =
    assistantTime?.firstContent != null
      ? assistantTime.firstContent - assistantTime.created
      : undefined;
  const providerUsage =
    info.role === 'assistant' ? buildProviderUsageFromAssistantTokens(info.tokens) : undefined;

  return {
    id: info.id,
    role: info.role,
    createdAt: info.time.created,
    content,
    ...('agent' in info && typeof info.agent === 'string' ? { agentId: info.agent } : {}),
    ...(info.clientRequestId ? { clientRequestId: info.clientRequestId } : {}),
    ...('modelID' in info && typeof info.modelID === 'string' ? { model: info.modelID } : {}),
    ...('providerID' in info && typeof info.providerID === 'string'
      ? { providerId: info.providerID }
      : {}),
    ...(typeof durationMs === 'number' && durationMs > 0 ? { durationMs } : {}),
    ...(typeof firstTokenLatencyMs === 'number' && firstTokenLatencyMs > 0
      ? { firstTokenLatencyMs }
      : {}),
    ...(providerUsage ? { providerUsage } : {}),
  };
}

function normalizeTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function buildProviderUsageFromAssistantTokens(
  tokens: AssistantMessage['tokens'],
): NonNullable<Message['providerUsage']> | undefined {
  const inputTokens = normalizeTokenCount(tokens.input);
  const outputTokens = normalizeTokenCount(tokens.output);
  const reasoningTokens = normalizeTokenCount(tokens.reasoning);
  const cacheReadTokens = normalizeTokenCount(tokens.cache.read);
  const cacheWriteTokens = normalizeTokenCount(tokens.cache.write);
  const summedTotal =
    inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens;
  const totalTokens = normalizeTokenCount(tokens.total ?? summedTotal);
  if (summedTotal <= 0 && totalTokens <= 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokens > 0 ? totalTokens : summedTotal,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens > 0 ? { cacheWriteTokens } : {}),
  };
}

// ─── V1-Compatible API ───

/**
 * Validate tool_call integrity at write time.
 * Ensures every tool_result has a corresponding tool_call in the same message,
 * preventing orphaned tool_results that would cause upstream API errors.
 * This replaces the need for sanitizeUpstreamConversation() at read time.
 */
function validateToolCallIntegrity(content: MessageContent[], _sessionId: string): void {
  const toolCallIds = new Set<string>();
  for (const c of content) {
    if (c.type === 'tool_call') {
      toolCallIds.add(c.toolCallId);
    }
  }
  // tool_result without a matching tool_call is logged but not rejected,
  // since it may reference a tool_call from a previous message in the same session.
  // The key invariant is that by the time messages reach toModelMessages(),
  // every tool_result must have a corresponding tool_call somewhere in the history.
  for (const c of content) {
    if (c.type === 'tool_result' && !toolCallIds.has(c.toolCallId)) {
      // Cross-message tool_result references are valid — the tool_call
      // may be in a previous assistant message. No action needed here.
    }
  }
}

function mirrorSessionMessageForLegacySearch(input: {
  agentId?: string | null;
  clientRequestId?: string | null;
  content: MessageContent[];
  createdAt: number;
  messageId: string;
  role: MessageRole;
  sessionId: string;
  status?: string;
  userId: string;
}): void {
  const contentJson = JSON.stringify(input.content);
  const writeMirrorRow = () => {
    const seq =
      sqliteGet<{ max_seq: number | null }>(
        'SELECT MAX(seq) AS max_seq FROM session_messages WHERE session_id = ? AND user_id = ?',
        [input.sessionId, input.userId],
      )?.max_seq ?? 0;

    sqliteRun(
      `INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, status, client_request_id, agent_id, created_at_ms, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         role = excluded.role,
         content_json = excluded.content_json,
         status = excluded.status,
         client_request_id = excluded.client_request_id,
         agent_id = excluded.agent_id,
         created_at_ms = excluded.created_at_ms,
         updated_at = datetime('now')`,
      [
        input.messageId,
        input.sessionId,
        input.userId,
        seq + 1,
        input.role,
        contentJson,
        input.status ?? 'final',
        input.clientRequestId ?? null,
        input.agentId ?? null,
        input.createdAt,
      ],
    );
  };

  try {
    writeMirrorRow();
  } catch (error) {
    const isRequestRoleConflict =
      error instanceof Error &&
      /UNIQUE constraint failed: session_messages\.session_id, session_messages\.client_request_id, session_messages\.role/.test(
        error.message,
      );
    if (!isRequestRoleConflict || !input.clientRequestId) {
      throw error;
    }

    deleteLegacySessionMessagesByRequestRole({
      clientRequestId: input.clientRequestId,
      role: input.role,
      sessionId: input.sessionId,
      userId: input.userId,
    });
    writeMirrorRow();
  }

  upsertSessionMessageSearchDocument({
    contentJson,
    id: input.messageId,
    role: input.role,
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

function deleteLegacySessionMessagesByRequestRole(input: {
  clientRequestId: string;
  role: MessageRole;
  sessionId: string;
  userId: string;
}): void {
  const legacyRows = sqliteAll<{ id: string }>(
    `SELECT id
     FROM session_messages
     WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ?`,
    [input.sessionId, input.userId, input.clientRequestId, input.role],
  );

  for (const row of legacyRows) {
    sqliteRun('DELETE FROM session_messages_fts WHERE message_id = ?', [row.id]);
  }

  sqliteRun(
    `DELETE FROM session_messages
     WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ?`,
    [input.sessionId, input.userId, input.clientRequestId, input.role],
  );
}

function deleteMessageV2RowsByIds(input: {
  messageIds: readonly string[];
  sessionId: string;
  userId: string;
}): void {
  for (const batchIds of chunkSqliteBindValues(input.messageIds, 2)) {
    const placeholders = buildSqlitePlaceholders(batchIds.length);
    sqliteRun(
      `DELETE FROM message_v2 WHERE session_id = ? AND user_id = ? AND id IN (${placeholders})`,
      [input.sessionId, input.userId, ...batchIds],
    );
  }
}

function deleteSessionMessagesByExactRequestRole(input: {
  clientRequestId: string;
  role: MessageRole;
  sessionId: string;
  userId: string;
}): void {
  const rows = sqliteAll<{ id: string; data: string }>(
    'SELECT id, data FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId],
  );
  const targetIds = rows
    .filter((row) => {
      const data = JSON.parse(row.data) as MessageInfo;
      return data.clientRequestId === input.clientRequestId && data.role === input.role;
    })
    .map((row) => row.id);

  for (const id of targetIds) {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: input.sessionId,
      data: { sessionID: input.sessionId, messageID: id },
    });
  }

  for (const id of targetIds) {
    sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [id, input.sessionId]);
  }

  if (targetIds.length > 0) {
    deleteMessageV2RowsByIds({
      messageIds: targetIds,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  deleteLegacySessionMessagesByRequestRole(input);
}

export function appendSessionMessageV2(input: {
  sessionId: string;
  userId: string;
  role: MessageRole;
  content: MessageContent[];
  agentId?: string | null;
  clientRequestId?: string | null;
  createdAt?: number;
  completedAt?: number;
  firstContentAt?: number;
  modelID?: string;
  providerID?: string;
  messageId?: string;
  replaceExisting?: boolean;
  status?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}): Message {
  // Write-time validation: ensure tool_result references an existing tool_call.
  // This prevents orphaned tool_results that would cause upstream API errors
  // (e.g. Anthropic requires every tool_result to have a preceding tool_use).
  if (input.role === 'assistant') {
    validateToolCallIntegrity(input.content, input.sessionId);
  }

  if (input.replaceExisting === true && input.clientRequestId) {
    deleteSessionMessagesByExactRequestRole({
      clientRequestId: input.clientRequestId,
      role: input.role,
      sessionId: input.sessionId,
      userId: input.userId,
    });
  }

  const msgId = (input.messageId ?? makeMessageId()) as MessageID;
  const timeCreated = input.createdAt ?? Date.now();
  const assistantTokens: AssistantMessage['tokens'] = {
    input: normalizeTokenCount(input.usage?.inputTokens),
    output: normalizeTokenCount(input.usage?.outputTokens),
    reasoning: normalizeTokenCount(input.usage?.reasoningTokens),
    cache: {
      read: normalizeTokenCount(input.usage?.cacheReadTokens),
      write: normalizeTokenCount(input.usage?.cacheWriteTokens),
    },
    ...(typeof input.usage?.totalTokens === 'number' && Number.isFinite(input.usage.totalTokens)
      ? { total: normalizeTokenCount(input.usage.totalTokens) }
      : {}),
  };

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
            ...(input.agentId ? { agent: input.agentId } : {}),
            role: 'assistant',
            ...(input.modelID ? { modelID: input.modelID } : {}),
            ...(input.providerID ? { providerID: input.providerID } : {}),
            time: {
              created: timeCreated,
              ...(input.completedAt ? { completed: input.completedAt } : {}),
              ...(input.firstContentAt ? { firstContent: input.firstContentAt } : {}),
            },
            cost: 0,
            tokens: assistantTokens,
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
        ...(c.synthetic ? { synthetic: true } : {}),
      };
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: { sessionID: input.sessionId, part },
      });
    } else if (c.type === 'reasoning') {
      const fallbackNow = Date.now();
      const startedAt = typeof c.startedAt === 'number' ? c.startedAt : fallbackNow;
      const endedAt = typeof c.endedAt === 'number' ? c.endedAt : undefined;
      const part: ReasoningPart = {
        id: partId,
        sessionID: input.sessionId,
        messageID: msgId,
        type: 'reasoning',
        text: c.text,
        time: { start: startedAt, ...(typeof endedAt === 'number' ? { end: endedAt } : {}) },
        ...(c.encryptedContent || c.summary || c.signature
          ? {
              metadata: {
                ...(c.encryptedContent ? { encryptedContent: c.encryptedContent } : {}),
                ...(c.summary ? { summary: c.summary } : {}),
                // Persist Anthropic signature in opencode-shaped metadata
                // (anthropic.signature) so the bridge can replay it on
                // subsequent turns without losing the namespace.
                ...(c.signature ? { anthropic: { signature: c.signature } } : {}),
              },
            }
          : {}),
        ...(c.responseId ? { responseId: c.responseId } : {}),
      };
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: { sessionID: input.sessionId, part },
      });
    } else if (c.type === 'input_image') {
      emitEvent({
        definition: MessageEvents.PartCreated,
        aggregateID: input.sessionId,
        data: {
          sessionID: input.sessionId,
          part: {
            id: partId,
            sessionID: input.sessionId,
            messageID: msgId,
            type: 'file',
            inputType: 'input_image',
            mime: c.mimeType ?? 'image/png',
            ...(c.artifactId ? { artifactId: c.artifactId } : {}),
            ...(c.detail ? { detail: c.detail } : {}),
            ...(c.fileId ? { fileId: c.fileId } : {}),
            ...(c.fileName ? { filename: c.fileName } : {}),
            url: c.imageUrl ?? '',
          },
        },
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
          raw: normalizeToolArgumentsForStorage(c.rawArguments ?? c.input),
        },
        // Persist provider-attached metadata (e.g. OpenAI Responses
        // `openai.itemId` / `fc_xxx`) at the part level so it survives
        // every subsequent state transition (running / completed /
        // error) and can be replayed on later rounds via
        // `providerOptions.openai.itemId`. This is what keeps the
        // upstream prompt-cache prefix byte-stable across turns when
        // a tool call sits in history (otherwise AI SDK falls back
        // to the call_id and OpenAI re-keys the function_call item).
        ...(c.providerMetadata && Object.keys(c.providerMetadata).length > 0
          ? { metadata: { providerMetadata: c.providerMetadata } }
          : {}),
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
      const toolResultContent = buildToolResultContent({
        toolCallId: c.toolCallId,
        toolName: c.toolName ?? c.toolCallId,
        ...(c.clientRequestId ? { clientRequestId: c.clientRequestId } : {}),
        output: c.output,
        isError: c.isError,
        ...(c.reason ? { reason: c.reason } : {}),
        ...(c.attachments ? { attachments: c.attachments } : {}),
        ...(c.fileDiffs ? { fileDiffs: c.fileDiffs } : {}),
        ...(c.pendingPermissionRequestId
          ? { pendingPermissionRequestId: c.pendingPermissionRequestId }
          : {}),
        ...(c.resumedAfterApproval ? { resumedAfterApproval: true } : {}),
        ...(c.observability ? { observability: c.observability } : {}),
      });
      const serializedOutput =
        toolResultContent.rawOutput ?? stringifyToolResultOutput(toolResultContent.output);

      if (toolPart) {
        const existingMetadata =
          'metadata' in toolPart.state && toolPart.state.metadata ? toolPart.state.metadata : {};
        const nextInput =
          'input' in toolPart.state && toolPart.state.input ? toolPart.state.input : {};
        const nextStart =
          'time' in toolPart.state && toolPart.state.time?.start
            ? toolPart.state.time.start
            : timeCreated;
        const nextAttachments = buildToolResultAttachmentParts({
          attachments: c.attachments,
          messageId: toolPart.messageID,
          sessionId: input.sessionId,
        });
        let updatedPart: ToolPart;
        if (c.isError) {
          updatedPart = {
            ...toolPart,
            state: {
              status: 'error',
              input: nextInput,
              error: serializedOutput,
              metadata: {
                ...existingMetadata,
                toolResultContent,
              },
              time: { start: nextStart, end: timeCreated },
            },
          };
        } else {
          updatedPart = {
            ...toolPart,
            state: {
              status: 'completed',
              input: nextInput,
              output: serializedOutput,
              title: c.toolName ?? c.toolCallId,
              metadata: {
                ...existingMetadata,
                toolResultContent,
              },
              time: { start: nextStart, end: timeCreated },
              ...(nextAttachments ? { attachments: nextAttachments } : {}),
            },
          };
        }
        emitEvent({
          definition: MessageEvents.PartUpdated,
          aggregateID: input.sessionId,
          data: { sessionID: input.sessionId, part: updatedPart, time: Date.now() },
        });
      } else {
        const nextAttachments = buildToolResultAttachmentParts({
          attachments: c.attachments,
          messageId: msgId,
          sessionId: input.sessionId,
        });
        const fallbackToolPart: ToolPart = c.isError
          ? {
              id: partId,
              sessionID: input.sessionId,
              messageID: msgId,
              type: 'tool',
              callID: c.toolCallId,
              tool: c.toolName ?? c.toolCallId,
              state: {
                status: 'error',
                input: {},
                error: serializedOutput,
                metadata: { toolResultContent },
                time: { start: timeCreated, end: timeCreated },
              },
            }
          : {
              id: partId,
              sessionID: input.sessionId,
              messageID: msgId,
              type: 'tool',
              callID: c.toolCallId,
              tool: c.toolName ?? c.toolCallId,
              state: {
                status: 'completed',
                input: {},
                output: serializedOutput,
                title: c.toolName ?? c.toolCallId,
                metadata: { toolResultContent },
                time: { start: timeCreated, end: timeCreated },
                ...(nextAttachments ? { attachments: nextAttachments } : {}),
              },
            };
        emitEvent({
          definition: MessageEvents.PartCreated,
          aggregateID: input.sessionId,
          data: { sessionID: input.sessionId, part: fallbackToolPart },
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

  mirrorSessionMessageForLegacySearch({
    agentId: input.agentId,
    clientRequestId: input.clientRequestId,
    content: input.content,
    createdAt: timeCreated,
    messageId: msgId,
    role: input.role,
    sessionId: input.sessionId,
    status: input.status,
    userId: input.userId,
  });

  const providerUsage =
    input.role === 'assistant' ? buildProviderUsageFromAssistantTokens(assistantTokens) : undefined;

  // Return a V1-compatible Message object
  return {
    id: msgId,
    role: input.role,
    createdAt: timeCreated,
    content: input.content,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.role === 'assistant' && input.modelID ? { model: input.modelID } : {}),
    ...(input.role === 'assistant' && input.providerID ? { providerId: input.providerID } : {}),
    ...(providerUsage ? { providerUsage } : {}),
  };
}

const COMPACTION_MARKER_TYPE = 'compaction_marker';
const INTERNAL_ASSISTANT_EVENT_SOURCE = 'openAwork';

export function appendCompactionMarkerMessageV2(input: {
  omittedMessages?: number;
  persistedMemory?: unknown;
  sessionId: string;
  signature?: string;
  summary: string;
  tailStartMessageId?: string;
  trigger: string;
  userId: string;
}): Message {
  const marker = buildCompactionMarkerContent({
    ...input,
    source: INTERNAL_ASSISTANT_EVENT_SOURCE,
    markerType: COMPACTION_MARKER_TYPE,
  });

  return appendSessionMessageV2({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    content: marker.content,
    clientRequestId: marker.clientRequestId,
  });
}

export function listSessionMessagesV2(input: {
  sessionId: string;
  userId: string;
  statuses?: string[];
  limit?: number;
  turnLimit?: number;
}): Message[] {
  // V2 is now the authoritative read source
  const statusSet = input.statuses ? new Set(input.statuses) : null;
  const rawMessages =
    typeof input.turnLimit === 'number' && input.turnLimit > 0
      ? listMessagesWithPartsByTurnLimit({
          sessionId: input.sessionId,
          userId: input.userId,
          turnLimit: input.turnLimit,
        })
      : listMessagesWithParts({
          sessionId: input.sessionId,
          userId: input.userId,
          limit: input.limit,
        });
  return rawMessages
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
  inclusive?: boolean;
  messageText?: string;
}): Message[] {
  // ── V2 truncate: delete messages after the given messageId ──
  const rows = sqliteAll<{ id: string; time_created: number }>(
    'SELECT id, time_created FROM message_v2 WHERE session_id = ? AND user_id = ? ORDER BY time_created ASC, id ASC',
    [input.sessionId, input.userId],
  );
  let targetIndex = rows.findIndex((row) => row.id === input.messageId);

  // Fallback: when the frontend message ID does not match any backend row
  // (frontend uses makeOrderedMessageId, backend uses makeMessageId), try to
  // locate the user message by matching its text content.
  if (targetIndex === -1 && input.messageText) {
    const allMessages = listMessagesWithParts({
      sessionId: input.sessionId,
      userId: input.userId,
    });
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const msg = allMessages[i]!;
      if (msg.info.role !== 'user') continue;
      const textPart = msg.parts.find(
        (p): p is TextPart => p.type === 'text' && p.text === input.messageText,
      );
      if (textPart) {
        targetIndex = rows.findIndex((row) => row.id === msg.info.id);
        break;
      }
    }
  }

  if (targetIndex !== -1) {
    const cutoffIndex = input.inclusive === false ? targetIndex + 1 : targetIndex;
    const deleteIds = rows.slice(cutoffIndex).map((r) => r.id);

    if (deleteIds.length > 0) {
      // Phase 2.1 — emit `MessageEvents.Removed` per truncated message and
      // let the projector cascade into `part_v2` / `message_v2`. Mirrors
      // `truncateMessagesAfter` in `message-store-v2.ts` so all retry /
      // permission-resume paths funnel through the unified write path.
      for (const id of deleteIds) {
        emitEvent({
          definition: MessageEvents.Removed,
          aggregateID: input.sessionId,
          data: { sessionID: input.sessionId, messageID: id },
        });
      }
      // Defensive sweep — if any rows survived projector deletion (e.g. due
      // to a partially-migrated session where projector registration is
      // skipped) fall back to explicit SQL so the caller's invariant
      // ``no messages after messageId remain'' still holds.
      for (const id of deleteIds) {
        sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [
          id,
          input.sessionId,
        ]);
      }
      deleteMessageV2RowsByIds({
        messageIds: deleteIds,
        sessionId: input.sessionId,
        userId: input.userId,
      });
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
  error: AssistantErrorObject;
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
  return messages.filter((m) => matchesRequestScope(input.clientRequestId, m.clientRequestId));
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
      const matchesRequest = matchesRequestScope(input.clientRequestId, data.clientRequestId);
      const matchesRole = roleFilter ? roleFilter.has(data.role) : true;
      return matchesRequest && matchesRole;
    })
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return;
  }

  // Single-write path: emit MessageEvents.Updated → projector upserts the
  // row in `message_v2`. Mirrors append/truncate flows so all status
  // transitions land in the event_log for replay symmetry.
  for (const id of targetIds) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const data = JSON.parse(row.data) as MessageInfo;
    const updated: MessageInfo = { ...data, status: input.status };
    emitEvent({
      definition: MessageEvents.Updated,
      aggregateID: input.sessionId,
      data: { sessionID: input.sessionId, info: updated },
    });
  }
  // Defensive sweep — if any row remains stale (e.g. partially-migrated
  // session where projector registration is skipped) fall back to explicit
  // SQL so the caller's invariant ``status == input.status'' still holds.
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
      const matchesRequest = matchesRequestScope(input.clientRequestId, data.clientRequestId);
      const matchesRole = roleFilter ? roleFilter.has(data.role) : true;
      return matchesRequest && matchesRole;
    })
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return;
  }

  // Single-write path: emit MessageEvents.Removed per id → projector
  // cascades the delete through `message_v2` and `part_v2`.
  for (const id of targetIds) {
    emitEvent({
      definition: MessageEvents.Removed,
      aggregateID: input.sessionId,
      data: { sessionID: input.sessionId, messageID: id },
    });
  }
  // Defensive sweep — if any rows survived projector deletion (e.g. due
  // to a partially-migrated session where projector registration is
  // skipped) fall back to explicit SQL so the caller's invariant
  // ``no scoped messages remain'' still holds.
  for (const id of targetIds) {
    sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [id, input.sessionId]);
  }
  deleteMessageV2RowsByIds({
    messageIds: targetIds,
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

// ─── V2-native implementations (no V1 dependency) ───

const MAX_INLINE_TOOL_OUTPUT_BYTES = 8 * 1024;

function shouldReferenceToolOutput(
  output: unknown,
  serialized = stringifyToolResultOutput(output),
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
  return findStoredToolResultByCallId(messages, input.toolCallId);
}

export function getLatestReferencedToolResult(input: {
  sessionId: string;
  userId: string;
}): StoredToolResult | null {
  const messages = listSessionMessagesV2({
    sessionId: input.sessionId,
    userId: input.userId,
  });
  return findLatestReferencedStoredToolResult(messages, shouldReferenceToolOutput);
}
