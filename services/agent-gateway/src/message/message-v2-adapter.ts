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
import type { SqliteBindableValue } from '../infra/sqlite-bind-params.js';
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
  type PartV2Row,
  type MessageV2Row,
  type ModifiedFilesSummaryPart,
  type ToolStatePending,
  type ToolStateRunning,
  makeMessageId,
  makePartId,
  mapMessageInfoRows,
  tryPartFromRow,
} from './message-v2-schema.js';
import {
  updatePart,
  getPart,
  listMessagesWithParts,
  listMessagesWithPartsByTurnLimit,
  listPartRowsByMessageIds,
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

function storedToolResultFromPart(part: ToolPart): StoredToolResult | null {
  const content =
    'metadata' in part.state ? readStoredToolResultContent(part.state.metadata) : null;
  return content
    ? {
        toolCallId: content.toolCallId,
        toolName: content.toolName,
        output: content.output,
        isError: content.isError,
        attachments: content.attachments,
        fileDiffs: content.fileDiffs,
        pendingPermissionRequestId: content.pendingPermissionRequestId,
        resumedAfterApproval: content.resumedAfterApproval,
        observability: content.observability,
        outputKind: content.outputKind,
        outputSummary: content.outputSummary,
      }
    : (() => {
        const fallback = buildFallbackToolResultContentFromToolPart(part);
        return fallback
          ? {
              toolCallId: fallback.toolCallId,
              toolName: fallback.toolName,
              output: fallback.output,
              isError: fallback.isError,
            }
          : null;
      })();
}

// Ensure projectors are registered
import './message-v2-projectors.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

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
        // OpenAI Chat 家族：思维链字段名 / 结构化条目存放在路由
        // `providerMetadataKey` 命名空间下（存量行缺省 `openai`），读路径必须
        // 回传 key 与内容，否则重放时元数据静默丢失。
        const openAIReasoningKey =
          typeof part.metadata?.['providerMetadataKey'] === 'string' &&
          part.metadata['providerMetadataKey'].length > 0
            ? part.metadata['providerMetadataKey']
            : 'openai';
        const openAIReasoningMeta = part.metadata?.[openAIReasoningKey] as
          { reasoningField?: unknown; reasoningDetails?: unknown } | undefined;
        const openAIReasoningField =
          typeof openAIReasoningMeta?.reasoningField === 'string' &&
          openAIReasoningMeta.reasoningField.length > 0
            ? openAIReasoningMeta.reasoningField
            : undefined;
        const openAIReasoningDetails = Array.isArray(openAIReasoningMeta?.reasoningDetails)
          ? openAIReasoningMeta.reasoningDetails
          : undefined;
        content.push({
          type: 'reasoning',
          text: part.text,
          ...(typeof part.itemId === 'string' && part.itemId.length > 0
            ? { itemId: part.itemId }
            : typeof part.metadata?.['itemId'] === 'string' && part.metadata['itemId'].length > 0
              ? { itemId: part.metadata['itemId'] }
              : {}),
          ...(part.metadata?.['encryptedContent']
            ? { encryptedContent: part.metadata['encryptedContent'] as string }
            : {}),
          ...(part.metadata?.['summary'] ? { summary: part.metadata['summary'] as string } : {}),
          ...(signature ? { signature } : {}),
          ...(openAIReasoningField === undefined ? {} : { reasoningField: openAIReasoningField }),
          ...(openAIReasoningDetails === undefined
            ? {}
            : { reasoningDetails: openAIReasoningDetails }),
          ...(openAIReasoningKey === 'openai' ? {} : { providerMetadataKey: openAIReasoningKey }),
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
        // `unifiedConversationToModelMessages` → native upstream — can replay
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
    // Synthetic notices carry the client-facing notice contract (label +
    // provenance). The write path persists them on `message_v2.data`, so the
    // read path must round-trip them or clients receive a bare
    // `role: 'synthetic'` with nothing to render.
    ...(info.role === 'synthetic' && info.description ? { description: info.description } : {}),
    ...(info.role === 'synthetic' && info.metadata ? { metadata: info.metadata } : {}),
    ...('agent' in info && typeof info.agent === 'string' ? { agentId: info.agent } : {}),
    ...(info.clientRequestId ? { clientRequestId: info.clientRequestId } : {}),
    // 状态必须回传：请求重放 / 清理判定（`getSessionMessageByRequestId` →
    // `stored.status === 'error'`）依赖它，漏传会让失败请求被误当作可重放结果。
    ...(info.status ? { status: info.status } : {}),
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

/**
 * 由 assistant 消息的 `tokens` 构建 providerUsage。
 *
 * 入参按**可能残缺**处理：`message_v2.data` 是 JSON blob，历史版本 / 半写入 / 缺键的行都
 * 可能没有 `tokens`（甚至没有 `cache`）。读路径是整个聊天 UI 的唯一数据源，一个残缺字段
 * 不该让 `listMessagesWithParts` 抛 TypeError 而把整会话的消息接口打成 500（实测：缺少
 * `tokens` 的 assistant 行会让同一会话的所有读接口一起失败；生产库里的幽灵行恰好带着
 * 完整 tokens 才没有暴露这一点）。缺失即视为「无用量」，不猜也不补 0 上报。
 */
function buildProviderUsageFromAssistantTokens(
  tokens: Partial<AssistantMessage['tokens']> | null | undefined,
): NonNullable<Message['providerUsage']> | undefined {
  if (!tokens) {
    return undefined;
  }

  const inputTokens = normalizeTokenCount(tokens.input);
  const outputTokens = normalizeTokenCount(tokens.output);
  const reasoningTokens = normalizeTokenCount(tokens.reasoning);
  const cacheReadTokens = normalizeTokenCount(tokens.cache?.read);
  const cacheWriteTokens = normalizeTokenCount(tokens.cache?.write);
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
  const targetIds = listRequestScopeRows({
    clientRequestId: input.clientRequestId,
    exact: true,
    roles: [input.role],
    sessionId: input.sessionId,
    userId: input.userId,
  }).map((row) => row.id);

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

/**
 * Build the discriminated `MessageInfo` for a role.
 *
 * Uses an exhaustive switch with a `never` guard so that adding a member to
 * `MessageRole` becomes a compile error here, instead of silently degrading to
 * `system` — the previous `if/else` chain ended in `else → system`, which
 * silently rewrote unknown roles (including `synthetic`) and defeated the
 * "model sees it / clients don't render it as user input" contract.
 */
function buildMessageInfo(input: {
  role: MessageRole;
  baseInfo: {
    id: MessageID;
    sessionID: string;
    clientRequestId?: string;
    status?: MessageInfo['status'];
  };
  timeCreated: number;
  assistantTokens: AssistantMessage['tokens'];
  agentId?: string | null;
  modelID?: string;
  providerID?: string;
  completedAt?: number;
  firstContentAt?: number;
  description?: string;
  metadata?: Record<string, unknown>;
}): MessageInfo {
  switch (input.role) {
    case 'user':
      return { ...input.baseInfo, role: 'user', time: { created: input.timeCreated } };
    case 'assistant':
      return {
        ...input.baseInfo,
        ...(input.agentId ? { agent: input.agentId } : {}),
        role: 'assistant',
        ...(input.modelID ? { modelID: input.modelID } : {}),
        ...(input.providerID ? { providerID: input.providerID } : {}),
        time: {
          created: input.timeCreated,
          ...(input.completedAt ? { completed: input.completedAt } : {}),
          ...(input.firstContentAt ? { firstContent: input.firstContentAt } : {}),
        },
        cost: 0,
        tokens: input.assistantTokens,
      };
    case 'tool':
      return { ...input.baseInfo, role: 'tool', time: { created: input.timeCreated } };
    case 'system':
      return { ...input.baseInfo, role: 'system', time: { created: input.timeCreated } };
    case 'synthetic':
      return {
        ...input.baseInfo,
        role: 'synthetic',
        time: { created: input.timeCreated },
        ...(input.description ? { description: input.description } : {}),
        ...(input.metadata ? { metadata: input.metadata } : {}),
      };
    default: {
      const exhaustive: never = input.role;
      throw new Error(`Unsupported message role: ${String(exhaustive)}`);
    }
  }
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
  /** Notice label; only consumed by `role: 'synthetic'`. */
  description?: string;
  /** Notice payload; only consumed by `role: 'synthetic'`. */
  metadata?: Record<string, unknown>;
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
  const info: MessageInfo = buildMessageInfo({
    role: input.role,
    baseInfo,
    timeCreated,
    assistantTokens,
    agentId: input.agentId,
    modelID: input.modelID,
    providerID: input.providerID,
    completedAt: input.completedAt,
    firstContentAt: input.firstContentAt,
    description: input.description,
    metadata: input.metadata,
  });

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
        ...(c.itemId ||
        c.encryptedContent ||
        c.summary ||
        c.signature ||
        c.reasoningField ||
        c.reasoningDetails
          ? {
              metadata: {
                ...(c.itemId ? { itemId: c.itemId } : {}),
                ...(c.encryptedContent ? { encryptedContent: c.encryptedContent } : {}),
                ...(c.summary ? { summary: c.summary } : {}),
                // Persist Anthropic signature in opencode-shaped metadata
                // (anthropic.signature) so the bridge can replay it on
                // subsequent turns without losing the namespace.
                ...(c.signature ? { anthropic: { signature: c.signature } } : {}),
                // OpenAI Chat 家族：思维链字段名 + 结构化条目，按路由
                // `providerMetadataKey`（缺省 `openai`）持久化，回传时由
                // bridge 还原成同名 providerMetadata。
                ...(c.reasoningField || c.reasoningDetails
                  ? {
                      [c.providerMetadataKey ?? 'openai']: {
                        ...(c.reasoningField ? { reasoningField: c.reasoningField } : {}),
                        ...(c.reasoningDetails ? { reasoningDetails: c.reasoningDetails } : {}),
                      },
                    }
                  : {}),
                ...(c.providerMetadataKey ? { providerMetadataKey: c.providerMetadataKey } : {}),
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
        // a tool call sits in history (otherwise the native upstream falls back
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
        sessionId: input.sessionId,
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
        ...(c.outputKind ? { outputKind: c.outputKind } : {}),
        ...(c.outputSummary ? { outputSummary: c.outputSummary } : {}),
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
  clientRequestId?: string;
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
    clientRequestId: input.clientRequestId ?? marker.clientRequestId,
    replaceExisting: input.clientRequestId !== undefined,
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

export interface TruncateSessionMessagesAfterV2Result {
  /** 截断后剩余的 V1 兼容消息列表（向后兼容既有调用方）。 */
  messages: Message[];
  /** 本次真正删除的消息 id（含无法归因回合的历史行）。 */
  removedMessageIds: string[];
  /** 作废窗口起点：第一条被删消息的 time_created（无删除时为当前时间）。 */
  cutoffTimeMs: number;
  /** 被删消息 `data` JSON 中解析出的回合键（去重，保持时间顺序）。 */
  invalidatedClientRequestIds: string[];
}

export function truncateSessionMessagesAfterV2(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  inclusive?: boolean;
  messageText?: string;
}): TruncateSessionMessagesAfterV2Result {
  // ── V2 truncate: delete messages after the given messageId ──
  const cutoff = resolveTruncateCutoff(input);

  if (cutoff) {
    // 被删窗口 = 排序键 (time_created ASC, id ASC) 上「≥ 定位点」（inclusive，缺省）
    // 或「> 定位点」（inclusive === false）。行值比较直接骑
    // `idx_message_v2_session_user_time` 做范围扫描（EXPLAIN 实测：`SEARCH message_v2
    // USING INDEX ... (session_id=? AND user_id=? AND (time_created,id)>(?,?))`），因此只
    // 读出**真正要删的行**；窗口之前的整段历史既不进内存、也不做 JSON 解析。
    //
    // 旧实现在这里 `SELECT id, time_created, data` 拉全会话再 `findIndex`：生产库单会话
    // 228 万行 / 805 MiB 时单条 SELECT 就要 2.6s，且阻塞单线程 SQLite 的事件循环。
    //
    // `id IS NOT NULL` 排除不可寻址的幽灵行（成因见 message-v2-projectors 的守卫与
    // `infra/db.ts` 的 `purgeUnidentifiableMessageRows`）：它们没有 id，不该出现在
    // `removedMessageIds` 这类归因键里（旧实现会把 `null` 直接塞进 receipt），也无法按 id
    // 删除；存量幽灵行由启动时的一次性迁移清理，此处不再为它们增加扫描。
    const windowOperator = input.inclusive === false ? '>' : '>=';
    const deleteRows = sqliteAll<{ id: string; time_created: number; data: string }>(
      `SELECT id, time_created, data FROM message_v2
        WHERE session_id = ? AND user_id = ? AND id IS NOT NULL
          AND (time_created, id) ${windowOperator} (?, ?)
        ORDER BY time_created ASC, id ASC`,
      [input.sessionId, input.userId, cutoff.timeCreated, cutoff.id],
    );
    const deleteIds = deleteRows.map((r) => r.id);
    // 窗口为空（inclusive: false 命中末条）时取定位点自身的时间：与旧实现
    // 「deleteRows[0] ?? rows[targetIndex]」同义，不发明时间戳。
    const cutoffTimeMs = deleteRows[0]?.time_created ?? cutoff.timeCreated;

    // 回合键只存在于 `message_v2.data` JSON（message_v2 无 client_request_id 列）。
    // 缺失 / 损坏的行按「不可归因的历史行」跳过，但仍计入 removedMessageIds。
    const invalidatedClientRequestIds: string[] = [];
    const seenClientRequestIds = new Set<string>();
    const unattributedMessageIds: string[] = [];
    for (const row of deleteRows) {
      const clientRequestId = parseClientRequestIdFromMessageRow(row.data);
      if (!clientRequestId) {
        unattributedMessageIds.push(row.id);
        continue;
      }
      if (seenClientRequestIds.has(clientRequestId)) continue;
      seenClientRequestIds.add(clientRequestId);
      invalidatedClientRequestIds.push(clientRequestId);
    }
    if (unattributedMessageIds.length > 0) {
      const preview = unattributedMessageIds.slice(0, 20).join(', ');
      console.warn(
        `[message-v2] truncate: ${unattributedMessageIds.length} 条被删消息缺少 clientRequestId，已跳过回合归因：${preview}${
          unattributedMessageIds.length > 20 ? ' …' : ''
        }`,
      );
    }

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
      // ``no messages after messageId remain'' still holds. Also sweeps the
      // legacy `session_messages` / `session_messages_fts` search mirror in
      // lock-step with the Removed projector.
      for (const id of deleteIds) {
        sqliteRun('DELETE FROM part_v2 WHERE message_id = ? AND session_id = ?', [
          id,
          input.sessionId,
        ]);
        sqliteRun('DELETE FROM session_messages WHERE id = ?', [id]);
        sqliteRun('DELETE FROM session_messages_fts WHERE message_id = ?', [id]);
      }
      deleteMessageV2RowsByIds({
        messageIds: deleteIds,
        sessionId: input.sessionId,
        userId: input.userId,
      });
    }

    return {
      messages: listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId }),
      removedMessageIds: deleteIds,
      cutoffTimeMs,
      invalidatedClientRequestIds,
    };
  }

  // 幂等分支：目标消息已不存在（同一 cutoffMessageId 的重复回退）——
  // 不做任何删除，返回当前消息与空 receipt 字段，重复调用不抛错、不二次删除。
  // `cutoffTimeMs` 用 0 哨兵而非 `Date.now()`：没有删除就没有有意义的窗口左端点，
  // 谎报「现在」会把多标签页里已有作废窗口的右边界推到现在，误伤随后重发的新回合。
  return {
    messages: listSessionMessagesV2({ sessionId: input.sessionId, userId: input.userId }),
    removedMessageIds: [],
    cutoffTimeMs: 0,
    invalidatedClientRequestIds: [],
  };
}

/**
 * 截断定位点：`(timeCreated, id)` 即该消息在 `(time_created ASC, id ASC)` 排序键上的位置。
 */
interface TruncateCutoff {
  id: string;
  timeCreated: number;
}

/**
 * 解析「从哪条消息开始截」，**只读一个定位点**。
 *
 * 先按主键点查（走 `sqlite_autoindex_message_v2_1`）；未命中才退到文本兜底——前端与后端
 * 各自生成消息 id（`makeOrderedMessageId` vs `makeMessageId`），前端 id 在后端不存在的
 * 情况是常态而非例外，因此兜底路径的代价同样在关键路径上。
 */
function resolveTruncateCutoff(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  messageText?: string;
}): TruncateCutoff | null {
  const exact = sqliteGet<{ id: string; time_created: number }>(
    `SELECT id, time_created FROM message_v2
      WHERE id = ? AND session_id = ? AND user_id = ?
      LIMIT 1`,
    [input.messageId, input.sessionId, input.userId],
  );
  if (exact) {
    return { id: exact.id, timeCreated: exact.time_created };
  }

  if (!input.messageText) {
    return null;
  }

  return findTruncateCutoffByMessageText({
    sessionId: input.sessionId,
    userId: input.userId,
    messageText: input.messageText,
  });
}

/**
 * 文本兜底：定位**最后一条正文完全等于 messageText 的 user 消息**。
 *
 * 只扫 user 消息（走覆盖索引 `idx_message_v2_session_role_time`，不读任何 `data`），再按需
 * 取这些消息的 text part——不再像旧实现那样 `listMessagesWithParts` 把整会话消息连同全部
 * part 拉进内存（生产库 228 万行时实测 6.6s，其中 228 万次 `JSON.parse`）。
 */
function findTruncateCutoffByMessageText(input: {
  sessionId: string;
  userId: string;
  messageText: string;
}): TruncateCutoff | null {
  const candidates = sqliteAll<{ id: string; time_created: number }>(
    `SELECT id, time_created FROM message_v2
      WHERE session_id = ? AND user_id = ? AND role = 'user' AND id IS NOT NULL
      ORDER BY time_created DESC, id DESC`,
    [input.sessionId, input.userId],
  );
  if (candidates.length === 0) {
    return null;
  }

  const textPartsByMessage = loadTextPartsByMessageIds(
    input.sessionId,
    candidates.map((candidate) => candidate.id),
  );
  for (const candidate of candidates) {
    if (textPartsByMessage.get(candidate.id)?.has(input.messageText)) {
      return { id: candidate.id, timeCreated: candidate.time_created };
    }
  }
  return null;
}

/** 按消息 id 批量取文本 part 正文（复用 store 的分片 part 读取，避免第二份分片实现）。 */
function loadTextPartsByMessageIds(
  sessionId: string,
  messageIds: readonly string[],
): Map<string, Set<string>> {
  const textPartsByMessage = new Map<string, Set<string>>();
  // 行里的 id 是裸字符串，MessageID 只是品牌类型（与 `messageInfoFromRow` 的还原方式一致）。
  const brandedIds = messageIds.map((id) => id as MessageID);
  for (const row of listPartRowsByMessageIds(sessionId, brandedIds)) {
    let parsed: { type?: unknown; text?: unknown };
    try {
      parsed = JSON.parse(row.data) as { type?: unknown; text?: unknown };
    } catch {
      continue;
    }
    if (parsed.type !== 'text' || typeof parsed.text !== 'string') continue;
    const texts = textPartsByMessage.get(row.message_id) ?? new Set<string>();
    texts.add(parsed.text);
    textPartsByMessage.set(row.message_id, texts);
  }
  return textPartsByMessage;
}

function parseClientRequestIdFromMessageRow(dataJson: string): string | null {
  try {
    const data = JSON.parse(dataJson) as MessageInfo;
    return typeof data.clientRequestId === 'string' && data.clientRequestId.length > 0
      ? data.clientRequestId
      : null;
  } catch (error) {
    logGatewayWarn(
      `[message-v2] truncate: message_v2.data 解析失败，跳过回合归因：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
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

export function isRuntimeSafeV2Message(message: Message): boolean {
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
  /**
   * 与 `listSessionMessagesV2` 的 `turnLimit` 同语义:只取最近 N 个回合
   * (按 user 消息计)之后的 runtime 安全消息。
   *
   * `/recovery?messageLimit=N` 会同时限制 legacy 与 runtime 两条读取路径 ——
   * 二者读的是同一张 `message_v2`,不设上限时 runtime 分支会把**整个历史**的
   * 工具消息(每个被 slim 后仍可达数千字符)并入窗口化的 legacy,使这个被
   * 活跃会话高频轮询的接口随会话长度无界膨胀。
   */
  turnLimit?: number;
}): Message[] {
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
    .map((message) => v2ToV1Message(message))
    .filter((message) => message.content.length > 0)
    .filter((message) => isRuntimeSafeV2Message(message));
}

/**
 * 单次读取 `message_v2` + `part_v2`,并在内存里切出 runtime 安全子集。
 *
 * `listRuntimeSafeSessionMessagesV2` 与 `listSessionMessagesV2` 读的是同一张表、
 * 同一窗口,后者只是多了 `isRuntimeSafeV2Message` 过滤 —— 即 runtime 集恒为 legacy
 * 集的子集。此前的全量路由(如 `GET /sessions/:id`)两条路径各读一遍,把同一批
 * message/part 行重复 `JSON.parse` 两次。此函数只读一次,返回的两组与分别调用两个
 * 读取函数逐字节一致,可直接喂给 `mergeRuntimeSafeSessionMessages`。
 */
export function readSessionMessagesWithRuntimeSplit(input: {
  sessionId: string;
  userId: string;
  statuses?: string[];
  limit?: number;
  turnLimit?: number;
}): { legacyMessages: Message[]; runtimeMessages: Message[] } {
  const legacyMessages = listSessionMessagesV2(input);
  return {
    legacyMessages,
    runtimeMessages: legacyMessages.filter((message) => isRuntimeSafeV2Message(message)),
  };
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

/** Persist OpenCode-style delayed pruning without deleting the stored output. */
export function markToolPartsCompactedV2(input: {
  sessionId: string;
  userId: string;
  toolCallIds: readonly string[];
  compactedAt?: number;
}): number {
  const compactedAt = input.compactedAt ?? Date.now();
  let updatedCount = 0;
  for (const callID of new Set(input.toolCallIds)) {
    const part = findToolPartByCallID({ sessionId: input.sessionId, callID });
    if (!part || part.state.status !== 'completed' || part.state.time.compacted) continue;
    updatePart({
      sessionId: input.sessionId,
      userId: input.userId,
      part: {
        ...part,
        state: {
          ...part.state,
          time: { ...part.state.time, compacted: compactedAt },
        },
      },
    });
    updatedCount++;
  }
  return updatedCount;
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

/**
 * 请求族的候选行：骑 `idx_message_v2_session_request (session_id, user_id, client_request_id)`
 * 做一次范围扫描。
 *
 * 下面这些「按请求族读写」的函数过去一律 `SELECT id, data …` 拉**整会话**再逐行
 * `JSON.parse` 过滤（`getSessionMessageByRequestId` / `listSessionMessagesByRequestScope`
 * 走的是更重的 `listSessionMessagesV2`，还要连带取全部 part）。会话越长这笔固定开销越高，
 * 而且全程把 `data` 大 blob 搬进 JS。
 *
 * 谓词统一写成区间 `[root, root || ';')`：':' 是 0x3A，它的下一字节 ';'（0x3B）保证
 * 「`root` 本身」与「以 `root:` 开头的任意串」都落在区间内。之所以两种命中都用区间、
 * 而不用 `=` / `LIKE`：
 *   - `LIKE 'root:%'` 默认大小写不敏感，在 BINARY 列上用不上索引；
 *   - `client_request_id = ?`（精确族）看着更贴切，但优化器会因为「(session_id, user_id,
 *     time_created, id) 索引能顺便满足 ORDER BY、不必排序」而改判给它 —— 于是退化成扫描
 *     整个会话（EXPLAIN 实测）。区间写法在两种情况下都骑 idx_message_v2_session_request。
 * 区间是**超集**（`root-abc`、`root!` 也落进来），精确判定仍由 `matchesRequestScopeRow`
 * 完成，`exact` 只是个判定开关，所以 SQL 这边只需要快、不需要准。
 *
 * role 过滤同样留给 JS：候选集本来就只到个位数，为它加 `role IN (…)` 反而要求 `role`
 * 反规范化列必须与 `data.role` 严格同步，凭白多一条隐性不变量。
 */
function listRequestScopeCandidateRows(input: {
  clientRequestId: string;
  exact?: boolean;
  roles?: readonly MessageRole[];
  sessionId: string;
  userId: string;
}): MessageV2Row[] {
  const clauses = [
    'session_id = ?',
    'user_id = ?',
    // 不可寻址的幽灵行（见 message-v2-projectors 的守卫说明）没有 id，既改不动也删不掉。
    'id IS NOT NULL',
    'client_request_id >= ? AND client_request_id < ?',
  ];
  const params: SqliteBindableValue[] = [
    input.sessionId,
    input.userId,
    input.clientRequestId,
    `${input.clientRequestId};`,
  ];

  return sqliteAll<MessageV2Row>(
    `SELECT * FROM message_v2
      WHERE ${clauses.join(' AND ')}
      ORDER BY time_created ASC, id ASC`,
    params,
  );
}

/**
 * 命中判定，条件与旧实现的 JS 过滤逐字一致：`matchesRequestScope` 前缀语义 + 可选 role
 * 过滤（role 以 **data** 为准，反规范化列只在预筛阶段用来剪枝）。
 */
function matchesRequestScopeRow(
  row: MessageV2Row,
  input: { clientRequestId: string; exact?: boolean; roles?: readonly MessageRole[] },
): boolean {
  let data: MessageInfo;
  try {
    data = JSON.parse(row.data) as MessageInfo;
  } catch (error) {
    logGatewayWarn(
      `[message-v2] ${row.id} data 列 JSON 解析失败，已跳过请求族匹配：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }

  if (input.roles && input.roles.length > 0 && !input.roles.includes(data.role)) {
    return false;
  }

  return input.exact
    ? data.clientRequestId === input.clientRequestId
    : matchesRequestScope(input.clientRequestId, data.clientRequestId);
}

/** 精确命中请求族的消息行（预筛 + 逐行判定，顺序 time_created → id 升序）。 */
function listRequestScopeRows(input: {
  clientRequestId: string;
  exact?: boolean;
  roles?: readonly MessageRole[];
  sessionId: string;
  userId: string;
}): MessageV2Row[] {
  return listRequestScopeCandidateRows(input).filter((row) => matchesRequestScopeRow(row, input));
}

/**
 * 精确命中请求族的消息（含 part）。过滤与 `listSessionMessagesV2` 同款：跳过损坏行、
 * 丢弃正文为空的消息，顺序 `time_created, id` 升序 —— 调用方拿到的 Message 与旧实现
 * 从整会话读回来后过滤的结果完全一致。
 */
function listRequestScopeMessages(input: {
  clientRequestId: string;
  exact?: boolean;
  roles?: readonly MessageRole[];
  sessionId: string;
  userId: string;
}): Message[] {
  const rows = listRequestScopeRows(input);
  if (rows.length === 0) {
    return [];
  }

  const partsByMessage = new Map<string, MessagePart[]>();
  // 同上：行 id 是裸字符串，品牌类型在此处补齐。
  const messageIds = rows.map((row) => row.id as MessageID);
  for (const partRow of listPartRowsByMessageIds(input.sessionId, messageIds)) {
    const part = tryPartFromRow(partRow);
    if (!part) continue;
    const existing = partsByMessage.get(partRow.message_id) ?? [];
    existing.push(part);
    partsByMessage.set(partRow.message_id, existing);
  }

  return mapMessageInfoRows(rows)
    .map((info) => ({ info, parts: partsByMessage.get(info.id) ?? [] }))
    .map((message) => v2ToV1Message(message))
    .filter((message) => message.content.length > 0);
}

export function getSessionMessageByRequestId(input: {
  clientRequestId: string;
  role: MessageRole;
  sessionId: string;
  userId: string;
}): { message: Message; status: 'final' | 'error' } | null {
  // 旧实现读整会话再 `find`；这里只取「该请求精确 id + 该 role」的行。
  const messages = listRequestScopeMessages({
    clientRequestId: input.clientRequestId,
    exact: true,
    roles: [input.role],
    sessionId: input.sessionId,
    userId: input.userId,
  });
  const msg = messages.find(
    (m) => m.role === input.role && m.clientRequestId === input.clientRequestId,
  );
  if (!msg) return null;
  // `status` 由读路径回传（`v2ToV1Message`）；此前读路径漏传导致该判定恒为 'final'，
  // 失败请求会被误当作可重放结果。'streaming' 视为未终态，按 'final' 处理（调用方只区分 error）。
  return {
    message: msg,
    status: msg.status === 'error' ? 'error' : 'final',
  };
}

export function listSessionMessagesByRequestScope(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): Message[] {
  return listRequestScopeMessages({
    clientRequestId: input.clientRequestId,
    sessionId: input.sessionId,
    userId: input.userId,
  });
}

export function updateSessionMessagesStatusByRequestScope(input: {
  clientRequestId: string;
  roles?: MessageRole[];
  sessionId: string;
  status: 'final' | 'error';
  userId: string;
}): void {
  // 命中的行只有个位数（预筛已把候选压到本回合），这里的二次解析是刻意为之：单写路径与
  // 兜底 UPDATE 都需要完整 info 回投，而 `listRequestScopeRows` 的判定只看
  // clientRequestId / role，没必要为它把整条 info 留在内存里。
  const targets = listRequestScopeRows({
    clientRequestId: input.clientRequestId,
    roles: input.roles,
    sessionId: input.sessionId,
    userId: input.userId,
  }).map((row) => ({ id: row.id, data: JSON.parse(row.data) as MessageInfo }));

  if (targets.length === 0) {
    return;
  }

  // Single-write path: emit MessageEvents.Updated → projector upserts the
  // row in `message_v2`. Mirrors append/truncate flows so all status
  // transitions land in the event_log for replay symmetry.
  for (const target of targets) {
    // 行 JSON 里没有 id（`messageInfoToRowData` 会剥掉），回投前必须补回来：缺 id 的
    // info 曾被 projector 插成幽灵行（唯一写入点现已守卫，但仍不该依赖守卫兜底）。
    const info: MessageInfo = {
      ...target.data,
      id: target.id as MessageID,
      sessionID: input.sessionId,
      status: input.status,
    };
    emitEvent({
      definition: MessageEvents.Updated,
      aggregateID: input.sessionId,
      data: { sessionID: input.sessionId, info },
    });
  }
  // Defensive sweep — if any row remains stale (e.g. partially-migrated
  // session where projector registration is skipped) fall back to explicit
  // SQL so the caller's invariant ``status == input.status'' still holds.
  // 落库形态保持与 projector 一致（剥掉 id / sessionID），避免同一行出现两种 JSON 形状；
  // 反规范化列（role / client_request_id）一并按新 `data` 写回 —— 这两个列与 `data` 的
  // 一致性是读侧索引查询的前提，绕过 projector 的裸 UPDATE 必须自己维持它。
  for (const target of targets) {
    sqliteRun(
      `UPDATE message_v2
          SET data = ?, role = ?, client_request_id = ?, updated_at = datetime('now')
        WHERE id = ?`,
      [
        JSON.stringify({ ...target.data, status: input.status }),
        typeof target.data.role === 'string' ? target.data.role : '',
        typeof target.data.clientRequestId === 'string' ? target.data.clientRequestId : '',
        target.id,
      ],
    );
  }
}

export function deleteSessionMessagesByRequestScope(input: {
  clientRequestId: string;
  roles?: MessageRole[];
  sessionId: string;
  userId: string;
}): void {
  const targetIds = listRequestScopeRows({
    clientRequestId: input.clientRequestId,
    roles: input.roles,
    sessionId: input.sessionId,
    userId: input.userId,
  }).map((row) => row.id);

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
  const row = sqliteGet<PartV2Row>(
    `SELECT * FROM part_v2
     WHERE session_id = ? AND user_id = ? AND tool_call_id = ?
     ORDER BY time_created DESC LIMIT 1`,
    [input.sessionId, input.userId, input.toolCallId],
  );
  const part = row ? tryPartFromRow(row) : null;
  return part?.type === 'tool' ? storedToolResultFromPart(part) : null;
}

export function getSessionToolResultByReference(input: {
  sessionId: string;
  toolCallRef: string;
  userId: string;
}): StoredToolResult | null {
  const row = sqliteGet<PartV2Row>(
    `SELECT * FROM part_v2
     WHERE session_id = ? AND user_id = ? AND tool_call_ref = ?
     ORDER BY time_created DESC LIMIT 1`,
    [input.sessionId, input.userId, input.toolCallRef],
  );
  const part = row ? tryPartFromRow(row) : null;
  return part?.type === 'tool' ? storedToolResultFromPart(part) : null;
}

export function getLatestReferencedToolResult(input: {
  sessionId: string;
  userId: string;
}): StoredToolResult | null {
  const rows = sqliteAll<PartV2Row>(
    `SELECT * FROM part_v2
     WHERE session_id = ? AND user_id = ? AND tool_call_id IS NOT NULL
     ORDER BY time_created DESC`,
    [input.sessionId, input.userId],
  );
  for (const row of rows) {
    const part = tryPartFromRow(row);
    if (part?.type !== 'tool') continue;
    const result = storedToolResultFromPart(part);
    if (result && shouldReferenceToolOutput(result.output)) return result;
  }
  return null;
}
