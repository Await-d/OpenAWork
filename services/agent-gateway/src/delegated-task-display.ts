import type { Message } from '@openAwork/shared';

export function collectDelegatedSessionText(messages: Message[]): string {
  return getSortedMessages(messages)
    .flatMap((message) => extractMessageTexts(message))
    .join('\n\n')
    .trim();
}

export function extractLatestDelegatedSessionMessage(messages: Message[]): {
  createdAt: number;
  text: string;
} | null {
  const sorted = getSortedMessages(messages);
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const message = sorted[index];
    if (!message) {
      continue;
    }

    const text = extractMessageTexts(message).join('\n\n').trim();
    if (text.length > 0) {
      return {
        createdAt: message.createdAt,
        text,
      };
    }
  }

  return null;
}

export function buildTaskToolBackgroundMessage(input: {
  agent: string;
  category?: string;
  description: string;
  sessionId: string;
  status: string;
  taskId: string;
}): string {
  return [
    'Background task launched successfully.',
    '',
    `Task ID: ${input.taskId}`,
    `Session ID: ${input.sessionId}`,
    `Description: ${input.description}`,
    `Agent: ${input.agent}${input.category ? ` (category: ${input.category})` : ''}`,
    `Status: ${input.status}`,
    '',
    'The system will notify you when the task completes.',
    `Use \`background_output\` tool with task_id="${input.taskId}" to check progress:`,
    '- block=false (default): Check status immediately - returns full status info',
    '- block=true: Wait for completion (rarely needed since system notifies)',
    `To continue this session: session_id="${input.sessionId}"`,
  ].join('\n');
}

export function buildTaskToolTerminalMessage(input: {
  agent: string;
  category?: string;
  completedAt?: number;
  errorMessage?: string;
  resultText?: string;
  sessionId: string;
  startedAt?: number;
  status: 'cancelled' | 'done' | 'failed';
}): string {
  const fallback =
    input.status === 'failed'
      ? 'Task failed.'
      : input.status === 'cancelled'
        ? 'Task cancelled.'
        : '';
  const body = input.errorMessage?.trim() || input.resultText?.trim() || fallback;

  return [
    `task_id: ${input.sessionId} (for resuming to continue this task if needed)`,
    '',
    '<task_result>',
    body,
    '</task_result>',
  ].join('\n');
}

export function buildBackgroundTaskStatusMessage(input: {
  agent: string;
  description: string;
  lastMessage?: string;
  lastMessageAt?: number;
  prompt: string;
  queuedAt?: number;
  sessionId: string;
  startedAt?: number;
  status: string;
  taskId: string;
}): string {
  const durationLabel = input.status === 'pending' ? 'Queued for' : 'Duration';
  const duration =
    input.status === 'pending'
      ? formatDuration(input.queuedAt, undefined)
      : formatDuration(input.startedAt, undefined);

  const statusNote =
    input.status === 'pending'
      ? '> **Queued**: Task is waiting for a concurrency slot to become available.'
      : input.status === 'running'
        ? '> **Note**: No need to wait explicitly - the system will notify you when this task completes.'
        : input.status === 'failed'
          ? '> **Failed**: The task encountered an error. Check the last message for details.'
          : input.status === 'cancelled'
            ? '> **Cancelled**: The task was stopped before it could finish.'
            : '';

  const lastMessageSection =
    input.lastMessage && input.lastMessage.trim().length > 0
      ? [
          '',
          `## Last Message (${formatIsoTime(input.lastMessageAt)})`,
          '',
          '```',
          truncateText(input.lastMessage, 500),
          '```',
        ].join('\n')
      : '';

  return [
    '# Task Status',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Task ID | \`${input.taskId}\` |`,
    `| Description | ${input.description} |`,
    `| Agent | ${input.agent} |`,
    `| Status | **${input.status}** |`,
    `| ${durationLabel} | ${duration} |`,
    `| Session ID | \`${input.sessionId}\` |`,
    ...(statusNote ? ['', statusNote] : []),
    '## Original Prompt',
    '',
    '```',
    truncateText(input.prompt, 500),
    '```',
    ...(lastMessageSection ? [lastMessageSection] : []),
  ].join('\n');
}

export function buildBackgroundTaskResultMessage(input: {
  agent: string;
  completedAt?: number;
  description: string;
  resultText?: string;
  sessionId: string;
  startedAt?: number;
  taskId: string;
}): string {
  return [
    'Task Result',
    '',
    `Task ID: ${input.taskId}`,
    `Description: ${input.description}`,
    `Agent: ${input.agent}`,
    `Duration: ${formatDuration(input.startedAt, input.completedAt)}`,
    `Session ID: ${input.sessionId}`,
    '',
    '---',
    '',
    input.resultText?.trim() || '(No assistant or tool response found)',
  ].join('\n');
}

export function buildBackgroundCancelAllMessage(input: {
  tasks: Array<{
    agent: string;
    description: string;
    requestedSkills: string[];
    sessionId?: string;
    status: string;
    taskId: string;
  }>;
}): string {
  if (input.tasks.length === 0) {
    return 'No running or pending background tasks to cancel.';
  }

  const rows = input.tasks
    .map(
      (task) =>
        `| \`${task.taskId}\` | ${task.description} | ${task.status} | ${task.sessionId ? `\`${task.sessionId}\`` : '(not started)'} |`,
    )
    .join('\n');

  const resumable = input.tasks.filter((task) => task.sessionId);
  const resumeSection =
    resumable.length === 0
      ? ''
      : [
          '',
          '## Continue Instructions',
          '',
          'To continue a cancelled task, use:',
          '```',
          buildResumeTemplate({
            agent: resumable[0]?.agent ?? 'explore',
            requestedSkills: resumable[0]?.requestedSkills ?? [],
            sessionId: '<session_id>',
          }),
          '```',
          '',
          'Continuable sessions:',
          ...resumable.map(
            (task) =>
              `- \`${task.sessionId}\` (${task.description}) → ${buildResumeTemplate({ agent: task.agent, requestedSkills: task.requestedSkills, sessionId: task.sessionId ?? '<session_id>' })}`,
          ),
        ].join('\n');

  return [
    `Cancelled ${input.tasks.length} background task(s):`,
    '',
    '| Task ID | Description | Status | Session ID |',
    '|---------|-------------|--------|------------|',
    rows,
    resumeSection,
  ].join('\n');
}

export function buildBackgroundCancelSingleMessage(input: {
  description: string;
  sessionId?: string;
  status: string;
  taskId: string;
}): string {
  const header =
    input.sessionId === undefined
      ? 'Pending task cancelled successfully'
      : 'Task cancelled successfully';
  return [
    header,
    '',
    `Task ID: ${input.taskId}`,
    `Description: ${input.description}`,
    ...(input.sessionId ? [`Session ID: ${input.sessionId}`] : []),
    `Status: ${input.status}`,
  ].join('\n');
}

function buildResumeTemplate(input: {
  agent: string;
  requestedSkills: string[];
  sessionId: string;
}): string {
  const skills =
    input.requestedSkills.length > 0
      ? `[${input.requestedSkills.map((skill) => `"${skill}"`).join(', ')}]`
      : '[]';
  return `task(session_id="${input.sessionId}", subagent_type="${input.agent}", load_skills=${skills}, run_in_background=true, description="继续任务", prompt="Continue: <your follow-up>")`;
}

function getSortedMessages(messages: Message[]): Message[] {
  return [...messages].sort((left, right) => left.id.localeCompare(right.id));
}

function extractMessageTexts(message: Message): string[] {
  if (message.role === 'assistant') {
    return message.content.flatMap((part) => {
      if (part.type !== 'text') {
        return [];
      }

      const text = part.text.trim();
      return text.length > 0 && !isAssistantEventText(text) ? [text] : [];
    });
  }

  if (message.role === 'tool') {
    return message.content.flatMap((part) => {
      if (part.type !== 'tool_result') {
        return [];
      }

      const text = stringifyToolOutput(part.output);
      return text.length > 0 ? [text] : [];
    });
  }

  return [];
}

function isAssistantEventText(value: string): boolean {
  if (!value.startsWith('{') || !value.endsWith('}')) {
    return false;
  }

  try {
    const parsed = JSON.parse(value) as { source?: unknown; type?: unknown };
    return parsed.type === 'assistant_event' || parsed.source === 'openawork_internal';
  } catch {
    return false;
  }
}

function stringifyToolOutput(output: unknown): string {
  const stringifyFallback = (value: unknown): string => {
    if (value == null) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'symbol') {
      return value.toString();
    }
    if (typeof value === 'function') {
      return value.name.length > 0 ? `[Function: ${value.name}]` : '[Function]';
    }
    if (value instanceof Error) {
      return value.stack ?? value.message;
    }
    return Object.prototype.toString.call(value);
  };

  if (typeof output === 'string') {
    return output.trim();
  }

  if (Array.isArray(output)) {
    return output
      .map((item) => stringifyToolOutput(item))
      .filter((item) => item.length > 0)
      .join('\n\n');
  }

  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>;
    for (const key of ['text', 'summary', 'message', 'result', 'stdout', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }

    try {
      return JSON.stringify(output, null, 2);
    } catch {
      return stringifyFallback(output);
    }
  }

  return stringifyFallback(output);
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function formatIsoTime(value?: number): string {
  return typeof value === 'number' ? new Date(value).toISOString() : 'N/A';
}

function formatDuration(start?: number, end?: number): string {
  if (typeof start !== 'number') {
    return 'N/A';
  }

  const duration = Math.max(0, (end ?? Date.now()) - start);
  const seconds = Math.floor(duration / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }

  return `${seconds}s`;
}
