import type { Message } from '@openAwork/shared';
import { extractToolResultContentsFromMessage } from './tool-result-contract.js';

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
    '后台任务已成功启动。',
    '',
    `任务 ID：${input.taskId}`,
    `会话 ID：${input.sessionId}`,
    `描述：${input.description}`,
    `Agent：${input.agent}${input.category ? `（category：${input.category}）` : ''}`,
    `状态：${input.status}`,
    '',
    '任务完成时系统会主动通知你。',
    `检查进度：调 \`background_output\` 并传 task_id="${input.taskId}"：`,
    '- block=false（默认）：立刻检查状态 - 返回完整状态信息',
    '- block=true：等任务完成（一般不需要，系统会主动通知）',
    `要继续这个会话：session_id="${input.sessionId}"`,
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
    input.status === 'failed' ? '任务失败。' : input.status === 'cancelled' ? '任务已取消。' : '';
  const body = input.errorMessage?.trim() || input.resultText?.trim() || fallback;

  return [
    `task_id: ${input.sessionId}（如需继续本任务可用来 resume）`,
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
  const durationLabel = input.status === 'pending' ? '已排队' : '耗时';
  const duration =
    input.status === 'pending'
      ? formatDuration(input.queuedAt, undefined)
      : formatDuration(input.startedAt, undefined);

  const statusNote =
    input.status === 'pending'
      ? '> **排队中**：任务正在等待并发名额。'
      : input.status === 'running'
        ? '> **提示**：不需要主动等待，任务完成时系统会主动通知。'
        : input.status === 'failed'
          ? '> **失败**：任务遇到错误。查看最后一条消息了解详情。'
          : input.status === 'cancelled'
            ? '> **已取消**：任务在完成之前被停止。'
            : '';

  const lastMessageSection =
    input.lastMessage && input.lastMessage.trim().length > 0
      ? [
          '',
          `## 最后一条消息（${formatIsoTime(input.lastMessageAt)}）`,
          '',
          '```',
          truncateText(input.lastMessage, 500),
          '```',
        ].join('\n')
      : '';

  return [
    '# 任务状态',
    '',
    '| 字段 | 值 |',
    '|-------|-------|',
    `| 任务 ID | \`${input.taskId}\` |`,
    `| 描述 | ${input.description} |`,
    `| Agent | ${input.agent} |`,
    `| 状态 | **${input.status}** |`,
    `| ${durationLabel} | ${duration} |`,
    `| 会话 ID | \`${input.sessionId}\` |`,
    ...(statusNote ? ['', statusNote] : []),
    '## 原始 Prompt',
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
    '任务结果',
    '',
    `任务 ID：${input.taskId}`,
    `描述：${input.description}`,
    `Agent：${input.agent}`,
    `耗时：${formatDuration(input.startedAt, input.completedAt)}`,
    `会话 ID：${input.sessionId}`,
    '',
    '---',
    '',
    input.resultText?.trim() || '（未找到助手或工具响应）',
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
    return '没有运行中或排队中的后台任务可取消。';
  }

  const rows = input.tasks
    .map(
      (task) =>
        `| \`${task.taskId}\` | ${task.description} | ${task.status} | ${task.sessionId ? `\`${task.sessionId}\`` : '（未启动）'} |`,
    )
    .join('\n');

  const resumable = input.tasks.filter((task) => task.sessionId);
  const resumeSection =
    resumable.length === 0
      ? ''
      : [
          '',
          '## 继续说明',
          '',
          '要继续被取消的任务，使用：',
          '```',
          buildResumeTemplate({
            agent: resumable[0]?.agent ?? 'explore',
            requestedSkills: resumable[0]?.requestedSkills ?? [],
            sessionId: '<session_id>',
          }),
          '```',
          '',
          '可继续的会话：',
          ...resumable.map(
            (task) =>
              `- \`${task.sessionId}\`（${task.description}）→ ${buildResumeTemplate({ agent: task.agent, requestedSkills: task.requestedSkills, sessionId: task.sessionId ?? '<session_id>' })}`,
          ),
        ].join('\n');

  return [
    `已取消 ${input.tasks.length} 个后台任务：`,
    '',
    '| 任务 ID | 描述 | 状态 | 会话 ID |',
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
  const header = input.sessionId === undefined ? '排队中的任务已成功取消' : '任务已成功取消';
  return [
    header,
    '',
    `任务 ID：${input.taskId}`,
    `描述：${input.description}`,
    ...(input.sessionId ? [`会话 ID：${input.sessionId}`] : []),
    `状态：${input.status}`,
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
  const toolResultTexts = extractToolResultContentsFromMessage(message)
    .map((part) => stringifyToolOutput(part.output))
    .filter((text) => text.length > 0);

  if (message.role === 'assistant') {
    return message.content
      .flatMap((part) => {
        if (part.type !== 'text') {
          return [];
        }

        const text = part.text.trim();
        return text.length > 0 && !isAssistantEventText(text) ? [text] : [];
      })
      .concat(toolResultTexts);
  }

  return toolResultTexts;
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
