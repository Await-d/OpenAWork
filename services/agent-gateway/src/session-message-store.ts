import { createHash, randomUUID } from 'node:crypto';
import type {
  FileBackupRef,
  FileDiffContent,
  Message,
  MessageContent,
  MessageRole,
  ToolCallObservabilityAnnotation,
} from '@openAwork/shared';
import {
  mergePersistedCompactionMemory,
  renderPersistedCompactionMemory,
  type CompactionSummaryFields,
  type CompactionTrigger,
  type PersistedCompactionMemory,
} from './compaction-metadata.js';
import { buildReadToolOutputHint } from './tool-output-tools.js';
import { sqliteAll, sqliteGet, sqliteRun } from './db.js';

type SessionMessageStatus = 'final' | 'error';

interface SessionMessageRow {
  id: string;
  session_id: string;
  user_id: string;
  seq: number;
  role: MessageRole;
  content_json: string;
  status: SessionMessageStatus;
  client_request_id: string | null;
  created_at_ms: number;
}

const MAX_INLINE_TOOL_OUTPUT_BYTES = 8 * 1024;
const INTERNAL_ASSISTANT_EVENT_SOURCE = 'openawork_internal';
const INTERNAL_CLIENT_REQUEST_ID_KEY = '__openAworkClientRequestId';

export interface UpstreamChatMessage {
  role: 'assistant' | 'system' | 'tool' | 'user';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface PreparedUpstreamConversation {
  messages: UpstreamChatMessage[];
}

export interface BuildPreparedUpstreamConversationOptions {
  contextWindow?: number;
  llmCompactionSummary?: string;
  maxMessages?: number;
  persistedMemory?: PersistedCompactionMemory | null;
}

export interface DurableCompactionSummary {
  newlySummarizedMessages: number;
  persistedMemory: PersistedCompactionMemory;
  signature: string;
  structuredSummary: string;
  totalRepresentedMessages: number;
}

export function hasToolOutputReference(messages: UpstreamChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' &&
      typeof message.content === 'string' &&
      message.content.startsWith('[tool_output_reference]'),
  );
}

export interface StoredToolResult {
  clientRequestId?: string;
  fileDiffs?: FileDiffContent[];
  isError: boolean;
  output: unknown;
  pendingPermissionRequestId?: string;
  observability?: ToolCallObservabilityAnnotation;
  toolCallId: string;
  toolName?: string;
}

export function isAssistantUiEventText(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' && parsed.source === INTERNAL_ASSISTANT_EVENT_SOURCE;
  } catch {
    return false;
  }
}

function isAssistantUiEventMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  return message.content.every(
    (content) => content.type === 'text' && isAssistantUiEventTextForMessage(content.text, message),
  );
}

function isAssistantUiEventTextForMessage(value: string, message: Message): boolean {
  if (isAssistantUiEventText(value)) {
    return true;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string') {
    return false;
  }

  if (
    !clientRequestId.startsWith('assistant_event:') &&
    !clientRequestId.startsWith('task-reminder:')
  ) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown };
    return parsed.type === 'assistant_event';
  } catch {
    return false;
  }
}

function isCommandCardPayload(value: string): boolean {
  const normalized = value.trim();
  if (!normalized.startsWith('{') || !normalized.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(normalized) as { type?: unknown; payload?: unknown };
    return (
      typeof parsed.type === 'string' &&
      typeof parsed.payload === 'object' &&
      parsed.payload !== null
    );
  } catch {
    return false;
  }
}

function isCommandCardMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  const clientRequestId = (message as Message & { [INTERNAL_CLIENT_REQUEST_ID_KEY]?: unknown })[
    INTERNAL_CLIENT_REQUEST_ID_KEY
  ];
  if (typeof clientRequestId !== 'string' || !clientRequestId.startsWith('command-card:')) {
    return false;
  }

  return message.content.every(
    (content) => content.type === 'text' && isCommandCardPayload(content.text),
  );
}

function isContextArtifactMessage(message: Message): boolean {
  return isAssistantUiEventMessage(message) || isCommandCardMessage(message);
}

export function listSessionMessages(input: {
  sessionId: string;
  userId: string;
  legacyMessagesJson?: string;
  statuses?: SessionMessageStatus[];
}): Message[] {
  hydrateLegacyMessages(input.sessionId, input.userId, input.legacyMessagesJson);
  const rows = readSessionMessageRows(input);
  return rows.map((row) => rowToMessage(row));
}

export function appendSessionMessage(input: {
  sessionId: string;
  userId: string;
  role: MessageRole;
  content: MessageContent[];
  legacyMessagesJson?: string;
  status?: SessionMessageStatus;
  clientRequestId?: string | null;
  createdAt?: number;
  messageId?: string;
  replaceExisting?: boolean;
}): Message {
  hydrateLegacyMessages(input.sessionId, input.userId, input.legacyMessagesJson);

  if (input.clientRequestId) {
    const existing = sqliteGet<SessionMessageRow>(
      'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ? LIMIT 1',
      [input.sessionId, input.userId, input.clientRequestId, input.role],
    );
    if (existing) {
      const nextStatus = input.status ?? 'final';
      if (
        input.replaceExisting === true ||
        (existing.status === 'error' && nextStatus === 'final')
      ) {
        sqliteRun(
          "UPDATE session_messages SET content_json = ?, status = 'final', updated_at = datetime('now') WHERE id = ?",
          [JSON.stringify(input.content), existing.id],
        );
        touchSession(input.sessionId, input.userId);
        return {
          id: existing.id,
          role: existing.role,
          createdAt: existing.created_at_ms,
          content: input.content,
        };
      }
      return rowToMessage(existing);
    }
  }

  const nextSeq =
    sqliteGet<{ next_seq: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM session_messages WHERE session_id = ? AND user_id = ?',
      [input.sessionId, input.userId],
    )?.next_seq ?? 1;
  const createdAt = input.createdAt ?? Date.now();
  const messageId = input.messageId ?? randomUUID();

  sqliteRun(
    "INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    [
      messageId,
      input.sessionId,
      input.userId,
      nextSeq,
      input.role,
      JSON.stringify(input.content),
      input.status ?? 'final',
      input.clientRequestId ?? null,
      createdAt,
    ],
  );

  touchSession(input.sessionId, input.userId);

  return {
    id: messageId,
    role: input.role,
    createdAt,
    content: input.content,
  };
}

export function buildUpstreamConversation(
  messages: Message[],
  maxMessages = 12,
): UpstreamChatMessage[] {
  const history = selectSafeConversationWindow(
    messages.filter((message) => !isContextArtifactMessage(message)),
    maxMessages,
  );
  return buildUpstreamConversationFromHistory(history);
}

export function buildPreparedUpstreamConversation(
  messages: Message[],
  options: number | BuildPreparedUpstreamConversationOptions = 12,
): PreparedUpstreamConversation {
  const maxMessages = typeof options === 'number' ? options : (options.maxMessages ?? 12);
  const contextWindow = typeof options === 'number' ? undefined : options.contextWindow;
  const llmCompactionSummary =
    typeof options === 'number' ? undefined : options.llmCompactionSummary;
  const persistedMemory = typeof options === 'number' ? null : (options.persistedMemory ?? null);
  const normalizedMessages = messages.filter((message) => !isContextArtifactMessage(message));
  const historySinceBoundary = selectMessagesSinceCompactionBoundary(
    normalizedMessages,
    persistedMemory,
    llmCompactionSummary,
  );
  const history =
    contextWindow && contextWindow > 0
      ? historySinceBoundary
      : selectSafeConversationWindow(historySinceBoundary, maxMessages);
  const upstreamMessages = buildUpstreamConversationFromHistory(history);

  if (!llmCompactionSummary || llmCompactionSummary.trim().length === 0) {
    return { messages: upstreamMessages };
  }

  return {
    messages: [
      {
        role: 'system',
        content: [
          '[COMPACT BOUNDARY]',
          'Earlier conversation history has been compacted by an LLM summary.',
          'Use this summary as the authoritative context before the remaining verbatim messages.',
          llmCompactionSummary,
        ].join('\n\n'),
      },
      ...upstreamMessages,
    ],
  };
}

export function isContextOverflow(
  usage: { inputTokens: number },
  contextWindow: number,
  reserved?: number,
): boolean {
  if (contextWindow <= 0) {
    return false;
  }

  const buffer = reserved ?? Math.min(20_000, Math.floor(contextWindow * 0.15));
  return usage.inputTokens >= contextWindow - buffer;
}

function buildUpstreamConversationFromHistory(messages: Message[]): UpstreamChatMessage[] {
  const upstreamMessages: UpstreamChatMessage[] = [];

  messages.forEach((message) => {
    if (message.role === 'tool') {
      message.content.forEach((content) => {
        if (content.type !== 'tool_result') return;
        upstreamMessages.push({
          role: 'tool',
          tool_call_id: content.toolCallId,
          content: serializeToolOutput({
            isError: content.isError,
            output: content.output,
            toolCallId: content.toolCallId,
          }),
        });
      });
      return;
    }

    const textContent = message.content
      .filter(
        (content): content is Extract<MessageContent, { type: 'text' }> =>
          content.type === 'text' &&
          (message.role !== 'assistant' ||
            !isAssistantUiEventTextForMessage(content.text, message)),
      )
      .map((content) => content.text)
      .join('\n')
      .trim();

    const modifiedFilesSummaryText = message.content
      .flatMap((content) => buildModifiedFilesSummaryContext(content))
      .join('\n\n')
      .trim();

    const assistantContextText = [textContent, modifiedFilesSummaryText]
      .filter((value) => value.length > 0)
      .join('\n\n')
      .trim();

    if (message.role === 'assistant') {
      const toolCalls = message.content.flatMap((content) => {
        if (content.type !== 'tool_call') return [];
        return [
          {
            id: content.toolCallId,
            type: 'function' as const,
            function: {
              name: content.toolName,
              arguments: JSON.stringify(content.input),
            },
          },
        ];
      });

      if (toolCalls.length === 0 && assistantContextText.length === 0) return;
      upstreamMessages.push({
        role: 'assistant',
        content: assistantContextText.length > 0 ? assistantContextText : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      return;
    }

    if (textContent.length === 0) return;
    upstreamMessages.push({ role: message.role, content: textContent });
  });

  return upstreamMessages;
}

export function buildStructuredCompactionSummary(input: {
  messages: Message[];
  recentMessagesKept: number;
  trigger: 'automatic' | 'manual';
}): string {
  const fields = buildCompactionSummaryFields(input.messages);

  return [
    `Structured summary of earlier conversation history (${input.trigger} compaction).`,
    `- Summarized messages: ${input.messages.length}`,
    `- Recent verbatim messages kept: ${input.recentMessagesKept}`,
    '',
    formatSummarySection('User goals', fields.userGoals),
    '',
    formatSummarySection('Assistant progress and decisions', fields.assistantProgress),
    '',
    formatSummarySection('Tool activity', fields.toolActivity),
    '',
    formatSummarySection('Files referenced', fields.filesReferenced),
    '',
    formatSummarySection(
      'Latest summarized user request',
      fields.latestUserRequest ? [fields.latestUserRequest] : [],
    ),
  ]
    .join('\n')
    .trim();
}

export function buildCompactionSummaryFields(messages: Message[]): CompactionSummaryFields {
  const normalizedMessages = messages.filter((message) => !isContextArtifactMessage(message));
  const latestUserRequest = collectCompactSummaryLines(
    normalizedMessages
      .filter((message) => message.role === 'user')
      .slice(-1)
      .map((message) => summarizeCompactMessage(message)),
    1,
  )[0];

  return {
    userGoals: collectCompactSummaryLines(
      normalizedMessages
        .filter((message) => message.role === 'user')
        .map((message) => summarizeCompactMessage(message)),
      3,
    ),
    assistantProgress: collectCompactSummaryLines(
      normalizedMessages
        .filter((message) => message.role === 'assistant')
        .map((message) => summarizeCompactMessage(message)),
      4,
    ),
    toolActivity: collectToolActivitySummary(normalizedMessages),
    filesReferenced: collectModifiedFilesForSummary(normalizedMessages),
    ...(latestUserRequest ? { latestUserRequest } : {}),
  };
}

export function buildDurableCompactionSummary(input: {
  existingMemory?: PersistedCompactionMemory | null;
  messages: Message[];
  recentMessagesKept: number;
  trigger: CompactionTrigger;
}): DurableCompactionSummary | null {
  const normalizedMessages = input.messages.filter((message) => !isContextArtifactMessage(message));
  if (normalizedMessages.length === 0) {
    return null;
  }

  const { deltaMessages, effectiveExistingMemory } = resolveCompactionDeltaMessages(
    normalizedMessages,
    input.existingMemory ?? null,
  );
  const coveredUntilMessageId =
    deltaMessages.at(-1)?.id ??
    effectiveExistingMemory?.coveredUntilMessageId ??
    normalizedMessages.at(-1)?.id;

  if (!coveredUntilMessageId) {
    return null;
  }

  const signature = buildCompactionSignature({
    coveredUntilMessageId,
    previousCoveredUntilMessageId: effectiveExistingMemory?.coveredUntilMessageId,
    recentMessagesKept: input.recentMessagesKept,
    representedMessages: normalizedMessages.length,
  });
  const newlySummarizedMessages =
    deltaMessages.length > 0
      ? deltaMessages.length
      : effectiveExistingMemory
        ? 0
        : normalizedMessages.length;
  const persistedMemory =
    deltaMessages.length > 0 || !effectiveExistingMemory
      ? mergePersistedCompactionMemory(effectiveExistingMemory, {
          coveredUntilMessageId,
          fields: buildCompactionSummaryFields(
            deltaMessages.length > 0 ? deltaMessages : normalizedMessages,
          ),
          newlySummarizedMessages,
          signature,
          trigger: input.trigger,
        })
      : effectiveExistingMemory;

  return {
    newlySummarizedMessages,
    persistedMemory,
    signature,
    structuredSummary: renderPersistedCompactionMemory({
      memory: persistedMemory,
      omittedMessages: normalizedMessages.length,
      recentMessagesKept: input.recentMessagesKept,
      trigger: input.trigger,
    }),
    totalRepresentedMessages: normalizedMessages.length,
  };
}

function resolveCompactionDeltaMessages(
  messages: Message[],
  existingMemory: PersistedCompactionMemory | null,
): {
  deltaMessages: Message[];
  effectiveExistingMemory: PersistedCompactionMemory | null;
} {
  if (!existingMemory) {
    return { deltaMessages: messages, effectiveExistingMemory: null };
  }

  const coveredIndex = messages.findIndex(
    (message) => message.id === existingMemory.coveredUntilMessageId,
  );
  if (coveredIndex === -1) {
    return { deltaMessages: messages, effectiveExistingMemory: null };
  }

  return {
    deltaMessages: messages.slice(coveredIndex + 1),
    effectiveExistingMemory: existingMemory,
  };
}

function buildCompactionSignature(input: {
  coveredUntilMessageId: string;
  previousCoveredUntilMessageId?: string;
  recentMessagesKept: number;
  representedMessages: number;
}): string {
  return [
    input.previousCoveredUntilMessageId ?? 'none',
    input.coveredUntilMessageId,
    String(input.representedMessages),
    String(input.recentMessagesKept),
  ].join(':');
}

function summarizeCompactMessage(message: Message): string {
  const textParts = message.content
    .flatMap((content) => {
      if (content.type === 'text') return [content.text];
      if (content.type === 'modified_files_summary') {
        return [`${content.title}: ${content.summary}`];
      }
      return [];
    })
    .join('\n')
    .trim();

  if (textParts.length > 0) {
    return normalizeCompactText(textParts, 220);
  }

  if (message.role === 'tool') {
    const toolSummaries = message.content.flatMap((content) => {
      if (content.type !== 'tool_result') return [];
      const toolName = content.toolName ?? content.toolCallId;
      return [content.isError ? `${toolName} (error)` : `${toolName} (ok)`];
    });
    return normalizeCompactText(toolSummaries.join(', '), 220);
  }

  return normalizeCompactText(extractMessageText(message), 220);
}

function collectCompactSummaryLines(items: string[], limit: number): string[] {
  const deduped = new Set<string>();
  const lines: string[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const value = items[index]?.trim();
    if (!value || deduped.has(value)) {
      continue;
    }
    deduped.add(value);
    lines.unshift(value);
    if (lines.length >= limit) {
      break;
    }
  }
  return lines;
}

function collectToolActivitySummary(messages: Message[]): string[] {
  const aggregated = new Map<string, { errors: number; successes: number }>();

  messages.forEach((message) => {
    if (message.role !== 'tool') {
      return;
    }

    message.content.forEach((content) => {
      if (content.type !== 'tool_result') {
        return;
      }

      const toolName = content.toolName ?? content.toolCallId;
      const current = aggregated.get(toolName) ?? { errors: 0, successes: 0 };
      if (content.isError) {
        current.errors += 1;
      } else {
        current.successes += 1;
      }
      aggregated.set(toolName, current);
    });
  });

  return Array.from(aggregated.entries())
    .slice(0, 5)
    .map(([toolName, counts]) => {
      const parts = [] as string[];
      if (counts.successes > 0) {
        parts.push(`ok×${counts.successes}`);
      }
      if (counts.errors > 0) {
        parts.push(`error×${counts.errors}`);
      }
      return `${toolName}: ${parts.join(', ')}`;
    });
}

function collectModifiedFilesForSummary(messages: Message[]): string[] {
  const files = new Set<string>();
  messages.forEach((message) => {
    message.content.forEach((content) => {
      if (content.type !== 'modified_files_summary') {
        return;
      }
      content.files.forEach((file) => {
        files.add(file.file);
      });
    });
  });
  return Array.from(files).slice(0, 6);
}

function formatSummarySection(title: string, lines: string[]): string {
  if (lines.length === 0) {
    return `${title}:\n- None recorded.`;
  }
  return `${title}:\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function normalizeCompactText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

export function extractMessageText(message: Message | undefined): string {
  if (!message) return '';
  return message.content
    .map((content) => {
      if (content.type === 'text') return content.text;
      if (content.type === 'tool_call') {
        return `${content.toolName}: ${JSON.stringify(content.input)}`;
      }
      if (content.type === 'tool_result') {
        return JSON.stringify(content.output);
      }
      return `${content.title}: ${content.summary}`;
    })
    .join('\n')
    .trim();
}

export function getSessionToolResultByCallId(input: {
  sessionId: string;
  toolCallId: string;
  userId: string;
  legacyMessagesJson?: string;
}): StoredToolResult | null {
  const messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.legacyMessagesJson,
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
        observability: content.observability,
      };
    }
  }

  return null;
}

export function getLatestReferencedToolResult(input: {
  sessionId: string;
  userId: string;
  legacyMessagesJson?: string;
}): StoredToolResult | null {
  const messages = listSessionMessages({
    sessionId: input.sessionId,
    userId: input.userId,
    legacyMessagesJson: input.legacyMessagesJson,
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
        observability: content.observability,
      };
    }
  }

  return null;
}

function serializeToolOutput(input: {
  isError: boolean;
  output: unknown;
  toolCallId: string;
}): string {
  const serialized = stringifyToolOutputValue(input.output);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');
  if (!shouldReferenceToolOutput(input.output, serialized, sizeBytes)) {
    return input.isError ? `[tool_error] ${serialized}` : serialized;
  }

  const meta = buildLargeToolOutputReference({
    output: input.output,
    serialized,
    sizeBytes,
    toolCallId: input.toolCallId,
    isError: input.isError,
  });

  return `[tool_output_reference] 完整输出已保存在会话记录中，未裁剪；为避免上下文膨胀，本轮仅向模型提供结构化引用。${JSON.stringify(meta)}`;
}

function stringifyToolOutputValue(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }

  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function shouldReferenceToolOutput(
  output: unknown,
  serialized = stringifyToolOutputValue(output),
  sizeBytes = Buffer.byteLength(serialized, 'utf8'),
): boolean {
  return sizeBytes > MAX_INLINE_TOOL_OUTPUT_BYTES;
}

function buildLargeToolOutputReference(input: {
  output: unknown;
  serialized: string;
  sizeBytes: number;
  toolCallId: string;
  isError: boolean;
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: 'tool_output_reference',
    fullOutputPreserved: true,
    storage: 'session_message',
    retrievalTool: 'read_tool_output',
    toolCallId: input.toolCallId,
    isError: input.isError,
    sha256: createHash('sha256').update(input.serialized).digest('hex').slice(0, 16),
    sizeBytes: input.sizeBytes,
    valueType: Array.isArray(input.output) ? 'array' : typeof input.output,
    hint: buildReadToolOutputHint(input.toolCallId),
  };

  if (typeof input.output === 'string') {
    return {
      ...base,
      lineCount: input.output.split(/\r?\n/).length,
      nonWhitespaceChars: input.output.trim().length,
    };
  }

  if (Array.isArray(input.output)) {
    return {
      ...base,
      itemCount: input.output.length,
    };
  }

  if (input.output && typeof input.output === 'object') {
    const record = input.output as Record<string, unknown>;
    return {
      ...base,
      keyCount: Object.keys(record).length,
    };
  }

  return base;
}

export function getSessionMessageByRequestId(input: {
  clientRequestId: string;
  role: MessageRole;
  sessionId: string;
  userId: string;
}): { message: Message; status: SessionMessageStatus } | null {
  const row = sqliteGet<SessionMessageRow>(
    'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? AND client_request_id = ? AND role = ? LIMIT 1',
    [input.sessionId, input.userId, input.clientRequestId, input.role],
  );
  if (!row) return null;
  return {
    message: rowToMessage(row),
    status: row.status,
  };
}

export function listSessionMessagesByRequestScope(input: {
  clientRequestId: string;
  sessionId: string;
  userId: string;
}): Message[] {
  const rows = sqliteAll<SessionMessageRow>(
    'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? ORDER BY seq ASC',
    [input.sessionId, input.userId],
  );
  return rows
    .filter(
      (row) =>
        row.client_request_id === input.clientRequestId ||
        row.client_request_id?.startsWith(`${input.clientRequestId}:`) === true,
    )
    .map((row) => rowToMessage(row));
}

export function truncateSessionMessagesAfter(input: {
  sessionId: string;
  userId: string;
  messageId: string;
  legacyMessagesJson?: string;
  inclusive?: boolean;
}): Message[] {
  hydrateLegacyMessages(input.sessionId, input.userId, input.legacyMessagesJson);
  const rows = sqliteAll<SessionMessageRow>(
    'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? ORDER BY seq ASC',
    [input.sessionId, input.userId],
  );
  const targetIndex = rows.findIndex((row) => row.id === input.messageId);
  if (targetIndex === -1) {
    return rows.map((row) => rowToMessage(row));
  }

  const keepRows = rows.slice(0, input.inclusive === false ? targetIndex + 1 : targetIndex);
  const deleteFromSeq = rows[targetIndex]?.seq ?? Number.MAX_SAFE_INTEGER;
  const cutoffSeq = input.inclusive === false ? deleteFromSeq + 1 : deleteFromSeq;
  sqliteRun('DELETE FROM session_messages WHERE session_id = ? AND user_id = ? AND seq >= ?', [
    input.sessionId,
    input.userId,
    cutoffSeq,
  ]);
  sqliteRun(
    "UPDATE sessions SET messages_json = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
    [JSON.stringify(keepRows.map((row) => rowToMessage(row))), input.sessionId, input.userId],
  );

  return keepRows.map((row) => rowToMessage(row));
}

export function updateSessionMessagesStatusByRequestScope(input: {
  clientRequestId: string;
  roles?: MessageRole[];
  sessionId: string;
  status: SessionMessageStatus;
  userId: string;
}): void {
  const rows = sqliteAll<SessionMessageRow>(
    'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? ORDER BY seq ASC',
    [input.sessionId, input.userId],
  );
  const roleFilter = input.roles ? new Set(input.roles) : null;
  const targetIds = rows
    .filter(
      (row) =>
        (row.client_request_id === input.clientRequestId ||
          row.client_request_id?.startsWith(`${input.clientRequestId}:`) === true) &&
        (roleFilter ? roleFilter.has(row.role) : true),
    )
    .map((row) => row.id);

  if (targetIds.length === 0) {
    return;
  }

  const placeholders = targetIds.map(() => '?').join(', ');
  sqliteRun(
    `UPDATE session_messages SET status = ?, updated_at = datetime('now') WHERE id IN (${placeholders})`,
    [input.status, ...targetIds],
  );
  touchSession(input.sessionId, input.userId);
}

function selectSafeConversationWindow(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages;

  const selected: Message[] = [];
  const pendingToolCallIds = new Set<string>();
  let includedCount = 0;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    const toolCallIds = extractToolCallIds(message);
    const toolResultIds = extractToolResultIds(message);
    const needsPairing = toolCallIds.some((toolCallId) => pendingToolCallIds.has(toolCallId));
    const shouldInclude = includedCount < maxMessages || needsPairing || toolResultIds.length > 0;
    if (!shouldInclude) {
      if (includedCount >= maxMessages && pendingToolCallIds.size === 0) break;
      continue;
    }

    selected.push(message);
    includedCount += 1;
    toolResultIds.forEach((toolCallId) => {
      pendingToolCallIds.add(toolCallId);
    });
    toolCallIds.forEach((toolCallId) => {
      pendingToolCallIds.delete(toolCallId);
    });

    if (includedCount >= maxMessages && pendingToolCallIds.size === 0) {
      break;
    }
  }

  return ensureLatestUserMessage(selected.reverse(), messages);
}

function selectMessagesSinceCompactionBoundary(
  messages: Message[],
  persistedMemory: PersistedCompactionMemory | null,
  llmCompactionSummary: string | undefined,
): Message[] {
  if (messages.length === 0 || !llmCompactionSummary || llmCompactionSummary.trim().length === 0) {
    return messages;
  }

  const coveredUntilMessageId = persistedMemory?.coveredUntilMessageId;
  if (!coveredUntilMessageId) {
    return messages;
  }

  const coveredIndex = messages.findIndex((message) => message.id === coveredUntilMessageId);
  if (coveredIndex < 0) {
    return messages;
  }

  return messages.slice(coveredIndex + 1);
}

function ensureLatestUserMessage(selected: Message[], allMessages: Message[]): Message[] {
  if (selected.some((message) => message.role === 'user')) {
    return selected;
  }

  for (let index = allMessages.length - 1; index >= 0; index -= 1) {
    const candidate = allMessages[index];
    if (candidate?.role !== 'user') {
      continue;
    }

    return [candidate, ...selected];
  }

  return selected;
}

function buildModifiedFilesSummaryContext(content: MessageContent): string[] {
  if (content.type !== 'modified_files_summary') {
    return [];
  }

  const fileLines = content.files.map((file) => {
    const status = file.status ?? 'modified';
    return `- ${status}: ${file.file}`;
  });

  return [[`${content.title}: ${content.summary}`, ...fileLines].join('\n')];
}

function extractToolCallIds(message: Message): string[] {
  return message.content.flatMap((content) =>
    content.type === 'tool_call' ? [content.toolCallId] : [],
  );
}

function extractToolResultIds(message: Message): string[] {
  return message.content.flatMap((content) =>
    content.type === 'tool_result' ? [content.toolCallId] : [],
  );
}

function hydrateLegacyMessages(
  sessionId: string,
  userId: string,
  legacyMessagesJson: string | undefined,
): void {
  const existingCount =
    sqliteGet<{ count: number }>(
      'SELECT COUNT(1) AS count FROM session_messages WHERE session_id = ? AND user_id = ?',
      [sessionId, userId],
    )?.count ?? 0;
  if (existingCount > 0) return;

  const legacyMessages = parseLegacyMessages(legacyMessagesJson);
  if (legacyMessages.length === 0) return;

  legacyMessages.forEach((message, index) => {
    const existing = sqliteGet<{ id: string }>(
      'SELECT id FROM session_messages WHERE id = ? LIMIT 1',
      [message.id],
    );
    sqliteRun(
      "INSERT INTO session_messages (id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'final', NULL, ?, datetime('now'))",
      [
        existing ? randomUUID() : message.id,
        sessionId,
        userId,
        index + 1,
        message.role,
        JSON.stringify(message.content),
        normalizeCreatedAt(message.createdAt),
      ],
    );
  });
}

function parseLegacyMessages(raw: string | undefined): Message[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => parseLegacyMessage(item));
  } catch {
    return [];
  }
}

function parseLegacyMessage(raw: unknown): Message[] {
  if (!raw || typeof raw !== 'object') return [];
  const record = raw as Record<string, unknown>;
  const role = parseRole(record['role']);
  if (!role) return [];
  const id = typeof record['id'] === 'string' ? record['id'] : randomUUID();
  const createdAt = normalizeCreatedAt(record['createdAt']);

  if (Array.isArray(record['content'])) {
    const content = parseMessageContentArray(record['content']);
    if (content.length === 0) return [];
    return [{ id, role, createdAt, content }];
  }

  if (typeof record['content'] === 'string') {
    return [
      {
        id,
        role,
        createdAt,
        content: [{ type: 'text', text: record['content'] }],
      },
    ];
  }

  return [];
}

function parseMessageContentArray(raw: unknown[]): MessageContent[] {
  const items: MessageContent[] = [];

  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      items.push({ type: 'text', text: record['text'] });
      return;
    }

    if (
      record['type'] === 'tool_call' &&
      typeof record['toolCallId'] === 'string' &&
      typeof record['toolName'] === 'string' &&
      record['input'] &&
      typeof record['input'] === 'object' &&
      !Array.isArray(record['input'])
    ) {
      items.push({
        type: 'tool_call',
        toolCallId: record['toolCallId'],
        toolName: record['toolName'],
        input: record['input'] as Record<string, unknown>,
      });
      return;
    }

    if (
      record['type'] === 'tool_result' &&
      typeof record['toolCallId'] === 'string' &&
      typeof record['isError'] === 'boolean'
    ) {
      const observability = parseToolCallObservability(record['observability']);
      const fileDiffs = Array.isArray(record['fileDiffs'])
        ? record['fileDiffs'].flatMap((item) => parseFileDiffContent(item))
        : [];
      items.push({
        type: 'tool_result',
        toolCallId: record['toolCallId'],
        toolName: typeof record['toolName'] === 'string' ? record['toolName'] : undefined,
        clientRequestId:
          typeof record['clientRequestId'] === 'string' ? record['clientRequestId'] : undefined,
        output: record['output'],
        isError: record['isError'],
        ...(fileDiffs.length > 0 ? { fileDiffs } : {}),
        pendingPermissionRequestId:
          typeof record['pendingPermissionRequestId'] === 'string'
            ? record['pendingPermissionRequestId']
            : undefined,
        ...(observability ? { observability } : {}),
      });
      return;
    }

    if (
      record['type'] === 'modified_files_summary' &&
      typeof record['title'] === 'string' &&
      typeof record['summary'] === 'string' &&
      Array.isArray(record['files'])
    ) {
      const files = record['files'].flatMap((item) => parseFileDiffContent(item));
      if (files.length > 0) {
        items.push({
          type: 'modified_files_summary',
          title: record['title'],
          summary: record['summary'],
          files,
        });
      }
    }
  });

  return items;
}

function readSessionMessageRows(input: {
  sessionId: string;
  userId: string;
  statuses?: SessionMessageStatus[];
}): SessionMessageRow[] {
  if (!input.statuses || input.statuses.length === 0) {
    return sqliteAll<SessionMessageRow>(
      'SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? ORDER BY seq ASC',
      [input.sessionId, input.userId],
    );
  }

  const placeholders = input.statuses.map(() => '?').join(', ');
  return sqliteAll<SessionMessageRow>(
    `SELECT id, session_id, user_id, seq, role, content_json, status, client_request_id, created_at_ms FROM session_messages WHERE session_id = ? AND user_id = ? AND status IN (${placeholders}) ORDER BY seq ASC`,
    [input.sessionId, input.userId, ...input.statuses],
  );
}

function rowToMessage(row: SessionMessageRow): Message {
  const message: Message = {
    id: row.id,
    role: row.role,
    createdAt: row.created_at_ms,
    content: parseContentJson(row.content_json),
  };

  if (typeof row.client_request_id === 'string' && row.client_request_id.length > 0) {
    Object.defineProperty(message, INTERNAL_CLIENT_REQUEST_ID_KEY, {
      value: row.client_request_id,
      enumerable: false,
      configurable: true,
    });
  }

  return message;
}

function parseContentJson(raw: string): MessageContent[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parseMessageContentArray(parsed) : [];
  } catch {
    return [];
  }
}

function parseFileDiffContent(value: unknown): FileDiffContent[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record['file'] !== 'string' ||
    typeof record['before'] !== 'string' ||
    typeof record['after'] !== 'string' ||
    typeof record['additions'] !== 'number' ||
    typeof record['deletions'] !== 'number'
  ) {
    return [];
  }

  return [
    {
      file: record['file'],
      before: record['before'],
      after: record['after'],
      additions: record['additions'],
      deletions: record['deletions'],
      clientRequestId:
        typeof record['clientRequestId'] === 'string' ? record['clientRequestId'] : undefined,
      requestId: typeof record['requestId'] === 'string' ? record['requestId'] : undefined,
      toolName: typeof record['toolName'] === 'string' ? record['toolName'] : undefined,
      toolCallId: typeof record['toolCallId'] === 'string' ? record['toolCallId'] : undefined,
      status:
        record['status'] === 'added' ||
        record['status'] === 'deleted' ||
        record['status'] === 'modified'
          ? record['status']
          : undefined,
      sourceKind: isFileChangeSourceKind(record['sourceKind']) ? record['sourceKind'] : undefined,
      guaranteeLevel: isFileChangeGuaranteeLevel(record['guaranteeLevel'])
        ? record['guaranteeLevel']
        : undefined,
      backupBeforeRef: parseFileBackupRef(record['backupBeforeRef']),
      backupAfterRef: parseFileBackupRef(record['backupAfterRef']),
      observability: parseToolCallObservability(record['observability']),
    },
  ];
}

function parseToolCallObservability(value: unknown): ToolCallObservabilityAnnotation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const parsed: ToolCallObservabilityAnnotation = {};

  if (typeof record['presentedToolName'] === 'string') {
    parsed.presentedToolName = record['presentedToolName'];
  }
  if (typeof record['canonicalToolName'] === 'string') {
    parsed.canonicalToolName = record['canonicalToolName'];
  }
  if (
    record['toolSurfaceProfile'] === 'openawork' ||
    record['toolSurfaceProfile'] === 'claude_code_simple' ||
    record['toolSurfaceProfile'] === 'claude_code_default'
  ) {
    parsed.toolSurfaceProfile = record['toolSurfaceProfile'];
  }
  if (typeof record['adapterVersion'] === 'string') {
    parsed.adapterVersion = record['adapterVersion'];
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parseFileBackupRef(value: unknown): FileBackupRef | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record['backupId'] !== 'string') {
    return undefined;
  }
  if (
    record['kind'] !== 'before_write' &&
    record['kind'] !== 'after_write' &&
    record['kind'] !== 'snapshot_base'
  ) {
    return undefined;
  }

  return {
    backupId: record['backupId'],
    kind: record['kind'],
    storagePath: typeof record['storagePath'] === 'string' ? record['storagePath'] : undefined,
    artifactId: typeof record['artifactId'] === 'string' ? record['artifactId'] : undefined,
    contentHash: typeof record['contentHash'] === 'string' ? record['contentHash'] : undefined,
  };
}

function isFileChangeSourceKind(value: unknown): value is FileDiffContent['sourceKind'] {
  return (
    value === 'structured_tool_diff' ||
    value === 'session_snapshot' ||
    value === 'restore_replay' ||
    value === 'workspace_reconcile' ||
    value === 'manual_revert'
  );
}

function isFileChangeGuaranteeLevel(value: unknown): value is FileDiffContent['guaranteeLevel'] {
  return value === 'strong' || value === 'medium' || value === 'weak';
}

function touchSession(sessionId: string, userId: string): void {
  sqliteRun("UPDATE sessions SET updated_at = datetime('now') WHERE id = ? AND user_id = ?", [
    sessionId,
    userId,
  ]);
}

function parseRole(raw: unknown): MessageRole | null {
  return raw === 'assistant' || raw === 'system' || raw === 'tool' || raw === 'user' ? raw : null;
}

function normalizeCreatedAt(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
