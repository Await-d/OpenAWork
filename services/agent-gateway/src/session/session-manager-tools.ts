import type { ToolDefinition } from '@openAwork/agent-core';
import type { Message, MessageContent } from '@openAwork/shared';
import { z } from 'zod';
import { sqliteAll, sqliteGet } from '../infra/db.js';
import { extractMessageText } from './session-message-store.js';
import { listSessionMessagesV2 } from '../message/message-v2-adapter.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { listSessionTodoLanes } from '../tools/todo-tools.js';
import { listSessionFileDiffs } from './session-file-diff-store.js';
import { buildSessionFileChangesProjection } from './session-file-changes-projection.js';
import { getRunEventRunId, listSessionRunEvents } from './session-run-events.js';
import { listSessionSnapshots } from './session-snapshot-store.js';
import {
  normalizeToolArgumentsForStorage,
  stringifyToolResultOutput,
} from '../tools/tool-result-contract.js';

interface SessionRow {
  id: string;
  metadata_json: string;
  state_status: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionTranscriptRow {
  tool_name: string;
  request_id: string;
  is_error: number;
  duration_ms: number | null;
  created_at: string;
}

const MAX_FORMATTED_TOOL_PART_CHARS = 8_000;

/**
 * 摘要视图下每条消息正文的字符上限。
 *
 * `session_read` 默认只回最近若干条消息，并把每条长消息折叠到这个长度，
 * 避免一次调用把整段历史（历史上有单次 80 万字符的调用）灌进上下文。
 * 需要完整文本时显式传 `full: true`。
 */
const SESSION_READ_MESSAGE_PREVIEW_CHARS = 600;

/** `include_transcript` 的审计行上限，避免全量 audit_logs 一次性返回。 */
const SESSION_READ_TRANSCRIPT_ROW_LIMIT = 200;

const sessionListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  from_date: z.string().optional(),
  to_date: z.string().optional(),
  project_path: z.string().optional(),
});

const sessionReadInputSchema = z.object({
  session_id: z.string().min(1),
  include_todos: z.boolean().optional().default(false),
  include_transcript: z.boolean().optional().default(false),
  // 默认只回最近 20 条；需要更多时显式调大（上限 500）。
  limit: z.number().int().min(1).max(500).optional().default(20),
  // 默认折叠长消息（摘要视图）；显式传 true 才返回完整文本。
  full: z.boolean().optional().default(false),
});

const sessionSearchInputSchema = z.object({
  query: z.string().min(1),
  session_id: z.string().min(1).optional(),
  case_sensitive: z.boolean().optional().default(false),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const sessionInfoInputSchema = z.object({
  session_id: z.string().min(1),
});

export const sessionListToolDefinition: ToolDefinition<typeof sessionListInputSchema, z.ZodString> =
  {
    name: 'session_list',
    description: '列出所有 OpenAWork 会话，可选过滤。',
    inputSchema: sessionListInputSchema,
    outputSchema: z.string(),
    timeout: 30000,
    execute: async () => {
      throw new Error('session_list must execute through the gateway-managed sandbox path');
    },
  };

export const sessionReadToolDefinition: ToolDefinition<typeof sessionReadInputSchema, z.ZodString> =
  {
    name: 'session_read',
    description:
      '读取 OpenAWork 会话的消息与历史。默认返回最近 20 条消息并折叠长文本（摘要视图）；需要完整文本时传 full: true，需要更早的消息时调大 limit（上限 500）。',
    inputSchema: sessionReadInputSchema,
    outputSchema: z.string(),
    timeout: 30000,
    execute: async () => {
      throw new Error('session_read must execute through the gateway-managed sandbox path');
    },
  };

export const sessionSearchToolDefinition: ToolDefinition<
  typeof sessionSearchInputSchema,
  z.ZodString
> = {
  name: 'session_search',
  description: '在 OpenAWork 会话消息中搜索内容。',
  inputSchema: sessionSearchInputSchema,
  outputSchema: z.string(),
  timeout: 30000,
  execute: async () => {
    throw new Error('session_search must execute through the gateway-managed sandbox path');
  },
};

export const sessionInfoToolDefinition: ToolDefinition<typeof sessionInfoInputSchema, z.ZodString> =
  {
    name: 'session_info',
    description: '获取某个 OpenAWork 会话的元数据与统计信息。',
    inputSchema: sessionInfoInputSchema,
    outputSchema: z.string(),
    timeout: 30000,
    execute: async () => {
      throw new Error('session_info must execute through the gateway-managed sandbox path');
    },
  };

function formatDate(value: string | number | undefined): string {
  if (value === undefined) {
    return 'unknown';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toISOString();
}

function formatMessageParts(message: Message): string {
  return message.content
    .map((content: MessageContent) => {
      const contentType = Reflect.get(content, 'type');
      if (contentType === 'text') {
        const text = Reflect.get(content, 'text');
        return typeof text === 'string' ? text : '';
      }
      if (contentType === 'tool_call') {
        const toolName = Reflect.get(content, 'toolName');
        const toolInput = Reflect.get(content, 'input');
        const normalizedInput = truncateText(
          normalizeToolArgumentsForStorage(toolInput ?? {}),
          MAX_FORMATTED_TOOL_PART_CHARS,
        );
        return `[tool_call] ${typeof toolName === 'string' ? toolName : ''} ${normalizedInput}`;
      }
      if (contentType === 'tool_result') {
        const output = Reflect.get(content, 'output');
        const normalizedOutput = truncateText(
          stringifyToolResultOutput(output),
          MAX_FORMATTED_TOOL_PART_CHARS,
        );
        return `[tool_result] ${normalizedOutput}`;
      }
      if (contentType === 'reasoning') {
        const text = Reflect.get(content, 'text');
        return typeof text === 'string' ? text : '';
      }
      if (contentType === 'modified_files_summary') {
        const title = Reflect.get(content, 'title');
        const summary = Reflect.get(content, 'summary');
        return `${typeof title === 'string' ? title : ''}: ${typeof summary === 'string' ? summary : ''}`;
      }
      return '';
    })
    .join('\n')
    .trim();
}

function listUserSessions(userId: string): SessionRow[] {
  return sqliteAll<SessionRow>(
    `SELECT id, metadata_json, state_status, title, created_at, updated_at
     FROM sessions
     WHERE user_id = ?
     ORDER BY updated_at DESC, created_at DESC`,
    [userId],
  );
}

function getUserSession(userId: string, sessionId: string): SessionRow | null {
  return (
    sqliteGet<SessionRow>(
      `SELECT id, metadata_json, state_status, title, created_at, updated_at
       FROM sessions
       WHERE id = ? AND user_id = ?
       LIMIT 1`,
      [sessionId, userId],
    ) ?? null
  );
}

function sessionMatchesProjectPath(session: SessionRow, projectPath: string | undefined): boolean {
  if (!projectPath) {
    return true;
  }
  const metadata = parseSessionMetadataJson(session.metadata_json);
  const workingDirectory =
    typeof metadata['workingDirectory'] === 'string' ? metadata['workingDirectory'] : '';
  return workingDirectory === projectPath || workingDirectory.startsWith(`${projectPath}/`);
}

function sessionWithinDateRange(
  session: SessionRow,
  fromDate: string | undefined,
  toDate: string | undefined,
): boolean {
  const updatedAt = Date.parse(session.updated_at);
  if (Number.isNaN(updatedAt)) {
    return true;
  }
  if (fromDate) {
    const from = Date.parse(fromDate);
    if (!Number.isNaN(from) && updatedAt < from) {
      return false;
    }
  }
  if (toDate) {
    const to = Date.parse(toDate);
    if (!Number.isNaN(to) && updatedAt > to) {
      return false;
    }
  }
  return true;
}

function truncateText(value: string, maxLength = 120): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function countChildSessions(userId: string, sessionId: string): number {
  return sqliteAll<{ id: string; metadata_json: string }>(
    `SELECT id, metadata_json FROM sessions WHERE user_id = ?`,
    [userId],
  ).filter((row) => parseSessionMetadataJson(row.metadata_json)['parentSessionId'] === sessionId)
    .length;
}

function listSessionTranscriptRows(userId: string, sessionId: string): SessionTranscriptRow[] {
  return sqliteAll<SessionTranscriptRow>(
    `SELECT audit_logs.tool_name, audit_logs.request_id, audit_logs.is_error, audit_logs.duration_ms, audit_logs.created_at
     FROM audit_logs
     INNER JOIN sessions ON sessions.id = audit_logs.session_id
     WHERE sessions.user_id = ? AND audit_logs.session_id = ?
     ORDER BY audit_logs.created_at ASC`,
    [userId, sessionId],
  );
}

async function loadSessionRuntimeStatus(input: { sessionId: string; userId: string }) {
  const { reconcileSessionRuntime } = await import('./session-runtime-reconciler.js');
  return reconcileSessionRuntime(input);
}

export async function runSessionListTool(
  userId: string,
  input: z.infer<typeof sessionListInputSchema>,
): Promise<string> {
  const sessions = listUserSessions(userId)
    .filter((session) => sessionMatchesProjectPath(session, input.project_path))
    .filter((session) => sessionWithinDateRange(session, input.from_date, input.to_date));
  const limited = input.limit ? sessions.slice(0, input.limit) : sessions;
  if (limited.length === 0) {
    return 'No sessions found.';
  }

  const rows = await Promise.all(
    // Per-session resilience: one session whose runtime reconciliation (DB
    // writes + finalizeChildTaskRun) or message read throws must not reject
    // the WHOLE `session_list` tool and blank the agent's entire listing.
    // Fall back to the cheap persisted `state_status` column for that row,
    // mirroring the batch `reconcileAllSessionRuntimes` which collects
    // `failedSessionIds` instead of aborting.
    limited.map(async (session) => {
      try {
        const messageCount = listSessionMessagesV2({ sessionId: session.id, userId }).length;
        const runtime = await loadSessionRuntimeStatus({ sessionId: session.id, userId });
        return `| ${session.id} | ${messageCount} | ${formatDate(session.created_at)} | ${formatDate(session.updated_at)} | ${runtime.status ?? session.state_status} | ${truncateText(session.title ?? '')} |`;
      } catch (error) {
        console.warn(
          `[session-manager] session_list 行 ${session.id} 运行时状态读取失败，降级为持久状态：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return `| ${session.id} | ? | ${formatDate(session.created_at)} | ${formatDate(session.updated_at)} | ${session.state_status} | ${truncateText(session.title ?? '')} |`;
      }
    }),
  );

  return [
    '| Session ID | Messages | First | Last | Status | Title |',
    '| --- | ---: | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

export function runSessionReadTool(
  userId: string,
  input: z.infer<typeof sessionReadInputSchema>,
): string {
  const session = getUserSession(userId, input.session_id);
  if (!session) {
    return `Session not found: ${input.session_id}`;
  }

  const allMessages = listSessionMessagesV2({ sessionId: session.id, userId });
  // 默认摘要视图：只取最近 limit 条，避免整段历史一次性灌入上下文。
  const sliced = allMessages.length > input.limit ? allMessages.slice(-input.limit) : allMessages;
  const firstShownIndex = allMessages.length - sliced.length;
  const lines = [
    `Session: ${session.id}`,
    `Messages: ${allMessages.length}${sliced.length < allMessages.length ? `（仅显示最近 ${sliced.length} 条；调大 limit 可取更早消息，上限 500）` : ''}`,
    `Date Range: ${formatDate(session.created_at)} to ${formatDate(session.updated_at)}`,
    ...(input.full
      ? []
      : [
          `提示：默认折叠长消息（每条约 ${SESSION_READ_MESSAGE_PREVIEW_CHARS} 字符）；需要完整文本时传 full: true。`,
        ]),
    '',
  ];

  sliced.forEach((message, index) => {
    lines.push(
      `[Message ${firstShownIndex + index + 1}/${allMessages.length}] ${message.role} (${formatDate(message.createdAt)})`,
    );
    const body = formatMessageParts(message);
    lines.push(
      body.length === 0
        ? '(empty)'
        : input.full
          ? body
          : truncateText(body, SESSION_READ_MESSAGE_PREVIEW_CHARS),
    );
    lines.push('');
  });

  if (input.include_todos) {
    const lanes = listSessionTodoLanes(session.id);
    lines.push('Todos:');
    lines.push(JSON.stringify(lanes, null, 2));
    lines.push('');
  }

  if (input.include_transcript) {
    lines.push('Transcript:');
    const transcriptRows = listSessionTranscriptRows(userId, session.id);
    const visibleTranscriptRows = transcriptRows.slice(0, SESSION_READ_TRANSCRIPT_ROW_LIMIT);
    if (visibleTranscriptRows.length === 0) {
      lines.push('(empty)');
    } else {
      visibleTranscriptRows.forEach((row, index) => {
        lines.push(
          `${index + 1}. [${formatDate(row.created_at)}] ${row.tool_name} · ${row.is_error === 1 ? 'error' : 'ok'}${row.duration_ms !== null ? ` · ${row.duration_ms}ms` : ''} · ${row.request_id}`,
        );
      });
      if (transcriptRows.length > visibleTranscriptRows.length) {
        lines.push(
          `…（仅显示前 ${visibleTranscriptRows.length} 条，共 ${transcriptRows.length} 条）`,
        );
      }
    }
    const runEvents = listSessionRunEvents(session.id);
    if (runEvents.length > 0) {
      lines.push('Run Events:');
      runEvents.slice(0, 50).forEach((event, index) => {
        const runId = getRunEventRunId(event);
        lines.push(
          `${index + 1}. [${formatDate(event.occurredAt)}] ${event.type}${runId ? ` · ${runId}` : ''}${event.eventId ? ` · ${event.eventId}` : ''}`,
        );
      });
    }
  }

  const fileDiffs = listSessionFileDiffs({ sessionId: session.id, userId });
  const snapshots = listSessionSnapshots({ sessionId: session.id, userId });
  const fileChanges = buildSessionFileChangesProjection({ fileDiffs, snapshots });
  if (fileChanges.summary.totalFileDiffs > 0) {
    lines.push('Debug File Diffs:');
    fileChanges.fileDiffs.slice(0, 20).forEach((diff) => {
      lines.push(
        `- ${diff.file} (+${diff.additions} / -${diff.deletions}) · guarantee=${diff.guaranteeLevel ?? 'unknown'} · source=${diff.sourceKind ?? 'unknown'}`,
      );
    });
  }
  if (fileChanges.summary.snapshotCount > 0) {
    lines.push('Debug Snapshots:');
    fileChanges.snapshots.slice(0, 20).forEach((snapshot) => {
      lines.push(
        `- ${snapshot.snapshotRef} · scope=${snapshot.scopeKind} · files=${snapshot.summary.files} · +${snapshot.summary.additions} / -${snapshot.summary.deletions} · weakest=${snapshot.summary.guaranteeLevel ?? 'unknown'}`,
      );
    });
  }

  return lines.join('\n').trim();
}

export function runSessionSearchTool(
  userId: string,
  input: z.infer<typeof sessionSearchInputSchema>,
): string {
  const sessions = input.session_id
    ? [getUserSession(userId, input.session_id)].filter(Boolean)
    : listUserSessions(userId);
  const query = input.case_sensitive ? input.query : input.query.toLowerCase();
  const results: string[] = [];

  for (const session of sessions) {
    if (!session) {
      continue;
    }
    const messages = listSessionMessagesV2({ sessionId: session.id, userId });
    for (const message of messages) {
      const text = extractMessageText(message);
      const haystack = input.case_sensitive ? text : text.toLowerCase();
      if (!haystack.includes(query)) {
        continue;
      }
      results.push(
        `[${session.id}] Message ${message.id} (${message.role})\n${truncateText(text.replace(/\s+/g, ' '), 220)}`,
      );
      if (results.length >= input.limit) {
        break;
      }
    }
    if (results.length >= input.limit) {
      break;
    }
  }

  if (results.length === 0) {
    return 'No matches found.';
  }

  return `Found ${results.length} matches:\n\n${results.join('\n\n')}`;
}

export async function runSessionInfoTool(
  userId: string,
  input: z.infer<typeof sessionInfoInputSchema>,
): Promise<string> {
  const session = getUserSession(userId, input.session_id);
  if (!session) {
    return `Session not found: ${input.session_id}`;
  }

  const messages = listSessionMessagesV2({ sessionId: session.id, userId });
  const lanes = listSessionTodoLanes(session.id);
  const metadata = parseSessionMetadataJson(session.metadata_json);
  const fileDiffs = listSessionFileDiffs({ sessionId: session.id, userId });
  const snapshots = listSessionSnapshots({ sessionId: session.id, userId });
  const fileChanges = buildSessionFileChangesProjection({ fileDiffs, snapshots });
  const firstMessage = messages[0];
  const lastMessage = messages.at(-1);
  const runtime = await loadSessionRuntimeStatus({ sessionId: session.id, userId });
  return [
    `Session ID: ${session.id}`,
    `Messages: ${messages.length}`,
    `Date Range: ${formatDate(firstMessage?.createdAt ?? session.created_at)} to ${formatDate(lastMessage?.createdAt ?? session.updated_at)}`,
    `Status: ${runtime.status ?? session.state_status}`,
    `Has Todos: ${lanes.main.length + lanes.temp.length > 0 ? 'Yes' : 'No'} (${lanes.main.length + lanes.temp.length} items)`,
    `File Diffs: ${fileChanges.summary.totalFileDiffs}`,
    `Snapshots: ${fileChanges.summary.snapshotCount}`,
    `Weakest Guarantee: ${fileChanges.summary.weakestGuaranteeLevel ?? 'unknown'}`,
    `Sources: ${fileChanges.summary.sourceKinds.join(', ') || 'none'}`,
    `Latest Snapshot: ${fileChanges.summary.latestSnapshotRef ?? 'None'}`,
    `Children: ${countChildSessions(userId, session.id)}`,
    `Parent Session: ${typeof metadata['parentSessionId'] === 'string' ? metadata['parentSessionId'] : 'None'}`,
  ].join('\n');
}
