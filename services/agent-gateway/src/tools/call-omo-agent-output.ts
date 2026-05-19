import type { Message } from '@openAwork/shared';
import { buildTaskToolTerminalMessage } from '../task/delegated-task-display.js';
import { extractToolResultContentsFromMessage } from './tool-result-contract.js';

export function buildDelegatedChildClientRequestId(input: {
  childSessionId: string;
  parentClientRequestId?: string;
}): string {
  return `task:${input.parentClientRequestId ?? 'child'}:child:${input.childSessionId}`;
}

export function buildCallOmoAgentBackgroundOutput(input: {
  agent: string;
  description: string;
  sessionId: string;
  status: string;
  taskId: string;
}): string {
  return [
    '后台 agent 任务已成功启动。',
    '',
    `任务 ID：${input.taskId}`,
    `会话 ID：${input.sessionId}`,
    `描述：${input.description}`,
    `Agent：${input.agent}（subagent）`,
    `状态：${input.status}`,
    '',
    '任务完成时系统会主动通知你。',
    `检查进度：调 \`background_output\` 并传 task_id="${input.taskId}"：`,
    '- block=false（默认）：立刻检查状态 - 返回完整状态信息',
    '- block=true：等任务完成（一般不需要，系统会主动通知）',
  ].join('\n');
}

export function buildCallOmoAgentSyncOutput(input: {
  fallbackText?: string;
  isError?: boolean;
  messages: Message[];
  sessionId: string;
}): string {
  const body = collectRelevantMessageText(input.messages) || buildFallbackText(input);
  return buildTaskToolTerminalMessage({
    agent: 'subagent',
    errorMessage: input.isError ? body : undefined,
    resultText: input.isError ? undefined : body,
    sessionId: input.sessionId,
    status: input.isError ? 'failed' : 'done',
  });
}

function buildFallbackText(input: { fallbackText?: string; isError?: boolean }): string {
  const fallback = input.fallbackText?.trim();
  if (fallback) {
    if (input.isError && !/^error:/iu.test(fallback) && !/^\[(?:错误|error):/iu.test(fallback)) {
      return `Error: ${fallback}`;
    }
    return fallback;
  }

  return '错误：未找到助手或工具响应';
}

function collectRelevantMessageText(messages: Message[]): string {
  return [...messages]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((message) => {
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
    })
    .join('\n\n')
    .trim();
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
