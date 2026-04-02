import type { ToolDefinition } from '@openAwork/agent-core';
import type { Message, MessageContent } from '@openAwork/shared';
import { z } from 'zod';
import { sqliteAll, sqliteGet } from './db.js';
import { extractMessageText, listSessionMessages } from './session-message-store.js';
import { parseSessionMetadataJson } from './session-workspace-metadata.js';
import { listSessionTodoLanes } from './todo-tools.js';
import { listSessionFileDiffs } from './session-file-diff-store.js';
import { buildSessionFileChangesProjection } from './session-file-changes-projection.js';
import { listSessionRunEvents } from './session-run-events.js';
import { listSessionSnapshots } from './session-snapshot-store.js';

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
  limit: z.number().int().min(1).max(500).optional(),
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
    description: 'List all OpenCode sessions with optional filtering.',
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
    description: 'Read messages and history from an OpenCode session.',
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
  description: 'Search for content within OpenCode session messages.',
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
    description: 'Get metadata and statistics about an OpenCode session.',
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
      if (content.type === 'text') {
        return content.text;
      }
      if (content.type === 'tool_call') {
        return `[tool_call] ${content.toolName} ${JSON.stringify(content.input)}`;
      }
      if (content.type === 'tool_result') {
        return `[tool_result] ${JSON.stringify(content.output)}`;
      }
      return `${content.title}: ${content.summary}`;
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
    limited.map(async (session) => {
      const messageCount = listSessionMessages({ sessionId: session.id, userId }).length;
      const runtime = await loadSessionRuntimeStatus({ sessionId: session.id, userId });
      return `| ${session.id} | ${messageCount} | ${formatDate(session.created_at)} | ${formatDate(session.updated_at)} | ${runtime.status ?? session.state_status} | ${truncateText(session.title ?? '')} |`;
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

  const allMessages = listSessionMessages({ sessionId: session.id, userId });
  const messages = input.limit ? allMessages.slice(0, input.limit) : allMessages;
  const lines = [
    `Session: ${session.id}`,
    `Messages: ${allMessages.length}`,
    `Date Range: ${formatDate(session.created_at)} to ${formatDate(session.updated_at)}`,
    '',
  ];

  messages.forEach((message, index) => {
    lines.push(`[Message ${index + 1}] ${message.role} (${formatDate(message.createdAt)})`);
    lines.push(formatMessageParts(message) || '(empty)');
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
    if (transcriptRows.length === 0) {
      lines.push('(empty)');
    } else {
      transcriptRows.forEach((row, index) => {
        lines.push(
          `${index + 1}. [${formatDate(row.created_at)}] ${row.tool_name} · ${row.is_error === 1 ? 'error' : 'ok'}${row.duration_ms !== null ? ` · ${row.duration_ms}ms` : ''} · ${row.request_id}`,
        );
      });
    }
    const runEvents = listSessionRunEvents(session.id);
    if (runEvents.length > 0) {
      lines.push('Run Events:');
      runEvents.slice(0, 50).forEach((event, index) => {
        lines.push(
          `${index + 1}. [${formatDate(event.occurredAt)}] ${event.type}${event.runId ? ` · ${event.runId}` : ''}${event.eventId ? ` · ${event.eventId}` : ''}`,
        );
      });
    }
  }

  const fileDiffs = listSessionFileDiffs({ sessionId: session.id, userId });
  const snapshots = listSessionSnapshots({ sessionId: session.id, userId });
  const fileChanges = buildSessionFileChangesProjection({ fileDiffs, snapshots });
  if (fileChanges.summary.totalFileDiffs > 0) {
    lines.push('File Diffs:');
    fileChanges.fileDiffs.slice(0, 20).forEach((diff) => {
      lines.push(
        `- ${diff.file} (+${diff.additions} / -${diff.deletions}) · guarantee=${diff.guaranteeLevel ?? 'unknown'} · source=${diff.sourceKind ?? 'unknown'}`,
      );
    });
  }
  if (fileChanges.summary.snapshotCount > 0) {
    lines.push('Snapshots:');
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
    const messages = listSessionMessages({ sessionId: session.id, userId });
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

  const messages = listSessionMessages({ sessionId: session.id, userId });
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
