import { createHash, randomUUID } from 'node:crypto';
import type { FileDiffContent, Message, MessageContent, MessageRole } from '@openAwork/shared';
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

export function hasToolOutputReference(messages: UpstreamChatMessage[]): boolean {
  return messages.some(
    (message) =>
      message.role === 'tool' &&
      typeof message.content === 'string' &&
      message.content.startsWith('[tool_output_reference]'),
  );
}

export interface StoredToolResult {
  isError: boolean;
  output: unknown;
  pendingPermissionRequestId?: string;
  toolCallId: string;
  toolName?: string;
}

export function isAssistantUiEventText(value: string): boolean {
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

function isAssistantUiEventMessage(message: Message): boolean {
  if (message.role !== 'assistant' || message.content.length === 0) {
    return false;
  }

  return message.content.every(
    (content) => content.type === 'text' && isAssistantUiEventText(content.text),
  );
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
    messages.filter((message) => !isAssistantUiEventMessage(message)),
    maxMessages,
  );
  const upstreamMessages: UpstreamChatMessage[] = [];

  history.forEach((message) => {
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
          (message.role !== 'assistant' || !isAssistantUiEventText(content.text)),
      )
      .map((content) => content.text)
      .join('\n')
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

      if (toolCalls.length === 0 && textContent.length === 0) return;
      upstreamMessages.push({
        role: 'assistant',
        content: textContent.length > 0 ? textContent : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      return;
    }

    if (textContent.length === 0) return;
    upstreamMessages.push({ role: message.role, content: textContent });
  });

  return upstreamMessages;
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
        output: content.output,
        isError: content.isError,
        pendingPermissionRequestId: content.pendingPermissionRequestId,
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
        output: content.output,
        isError: content.isError,
        pendingPermissionRequestId: content.pendingPermissionRequestId,
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
      items.push({
        type: 'tool_result',
        toolCallId: record['toolCallId'],
        toolName: typeof record['toolName'] === 'string' ? record['toolName'] : undefined,
        output: record['output'],
        isError: record['isError'],
        pendingPermissionRequestId:
          typeof record['pendingPermissionRequestId'] === 'string'
            ? record['pendingPermissionRequestId']
            : undefined,
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
  return {
    id: row.id,
    role: row.role,
    createdAt: row.created_at_ms,
    content: parseContentJson(row.content_json),
  };
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
      status:
        record['status'] === 'added' ||
        record['status'] === 'deleted' ||
        record['status'] === 'modified'
          ? record['status']
          : undefined,
    },
  ];
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
