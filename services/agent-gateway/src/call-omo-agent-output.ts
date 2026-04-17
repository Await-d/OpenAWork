import type { Message } from '@openAwork/shared';
import { buildTaskToolTerminalMessage } from './delegated-task-display.js';

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
    'Background agent task launched successfully.',
    '',
    `Task ID: ${input.taskId}`,
    `Session ID: ${input.sessionId}`,
    `Description: ${input.description}`,
    `Agent: ${input.agent} (subagent)`,
    `Status: ${input.status}`,
    '',
    'The system will notify you when the task completes.',
    `Use \`background_output\` tool with task_id="${input.taskId}" to check progress:`,
    '- block=false (default): Check status immediately - returns full status info',
    '- block=true: Wait for completion (rarely needed since system notifies)',
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

  return 'Error: No assistant or tool response found';
}

function collectRelevantMessageText(messages: Message[]): string {
  return [...messages]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((message) => {
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
