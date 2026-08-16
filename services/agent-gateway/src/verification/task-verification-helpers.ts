import type { MessageContent } from '@openAwork/shared';

let activeMockFetch: typeof fetch | undefined;

const mockFetchDispatcher: typeof fetch = (input, init) => {
  if (!activeMockFetch) {
    return Promise.reject(new Error('No active fetch mock'));
  }

  return activeMockFetch(input, init);
};

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export async function withMockFetch<T>(
  mockFetch: typeof fetch,
  callback: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const previousMockFetch = activeMockFetch;
  activeMockFetch = mockFetch;
  globalThis.fetch = mockFetchDispatcher;
  try {
    return await callback();
  } finally {
    activeMockFetch = previousMockFetch;
    globalThis.fetch = originalFetch;
  }
}

export async function readFetchBody(input: RequestInfo | URL, init?: RequestInit): Promise<string> {
  if (init?.body !== undefined && init.body !== null) {
    return new Response(init.body).text();
  }

  if (input instanceof Request) {
    return input.clone().text();
  }

  return '';
}

export function readFetchSignal(
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | undefined {
  return init?.signal ?? (input instanceof Request ? input.signal : undefined);
}

export async function withTempEnv<T>(
  entries: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(entries)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  message: string,
  attempts = 80,
  delayMs = 25,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(message);
}

function createChatCompletionsSseFrames(text: string): string[] {
  return [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: { content: text },
        },
      ],
    })}`,
    '',
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {},
          finish_reason: 'stop',
        },
      ],
    })}`,
    '',
    'data: [DONE]',
    '',
  ];
}

export function createChatCompletionsStream(text: string): Response {
  const encoder = new TextEncoder();
  const chatCompletionFrames = createChatCompletionsSseFrames(text);

  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(chatCompletionFrames.join('\n')));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

function createAnthropicMessagesSseFrames(text: string): string[] {
  return [
    'event: message_start',
    `data: ${JSON.stringify({
      type: 'message_start',
      message: {
        id: 'msg_fixture',
        type: 'message',
        role: 'assistant',
        content: [],
        model: 'fixture-model',
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    })}`,
    '',
    'event: content_block_start',
    `data: ${JSON.stringify({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })}`,
    '',
    'event: content_block_delta',
    `data: ${JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text },
    })}`,
    '',
    'event: content_block_stop',
    `data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}`,
    '',
    'event: message_delta',
    `data: ${JSON.stringify({
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: 'message_stop' })}`,
    '',
  ];
}

function isAnthropicMessagesRequest(input: RequestInfo | URL): boolean {
  const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
  try {
    return new URL(rawUrl).pathname.replace(/\/+$/, '').endsWith('/messages');
  } catch {
    return false;
  }
}

export function createProtocolAwareStream(input: RequestInfo | URL, text: string): Response {
  if (!isAnthropicMessagesRequest(input)) {
    return createChatCompletionsStream(text);
  }

  const encoder = new TextEncoder();
  const frames = createAnthropicMessagesSseFrames(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frames.join('\n')));
        controller.close();
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

export function createHangingChatCompletionsStream(signal?: AbortSignal): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const onAbort = () => {
          controller.error(new DOMException('Aborted', 'AbortError'));
        };

        if (signal?.aborted) {
          onAbort();
          return;
        }

        signal?.addEventListener('abort', onAbort, { once: true });
      },
      cancel() {
        return;
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

export function createDelayedChatCompletionsStream(input: {
  delayMs: number;
  ignoreAbort?: boolean;
  request?: RequestInfo | URL;
  signal?: AbortSignal;
  text: string;
}): Response {
  const encoder = new TextEncoder();
  const frames =
    input.request && isAnthropicMessagesRequest(input.request)
      ? createAnthropicMessagesSseFrames(input.text)
      : createChatCompletionsSseFrames(input.text);
  return new Response(
    new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(encoder.encode(frames.join('\n')));
          controller.close();
        }, input.delayMs);

        if (input.ignoreAbort) {
          return;
        }

        const onAbort = () => {
          clearTimeout(timer);
          controller.error(new DOMException('Aborted', 'AbortError'));
        };

        if (input.signal?.aborted) {
          onAbort();
          return;
        }

        input.signal?.addEventListener('abort', onAbort, { once: true });
      },
      cancel() {
        return;
      },
    }),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  );
}

export function readLastUserMessage(body: string): string {
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{
        role?: string;
        content?: string | Array<string | { text?: string }>;
      }>;
    };
    const messages = parsed.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const entry = messages[index];
      if (entry?.role !== 'user') {
        continue;
      }

      if (typeof entry.content === 'string') {
        return entry.content;
      }

      if (Array.isArray(entry.content)) {
        return entry.content
          .map((part) => {
            if (typeof part === 'string') {
              return part;
            }
            return typeof part.text === 'string' ? part.text : '';
          })
          .join('\n');
      }
    }
  } catch {
    return '';
  }

  return '';
}

export const TASK_TOOL_TEST_ENV = {
  DATABASE_URL: ':memory:',
  AI_API_KEY: 'test-key',
  AI_API_BASE_URL: 'https://unit-test.invalid/v1',
  OPENAWORK_DISABLE_MCP_FLAT_TOOLS: '1',
} as const;

export interface TaskToolOutput {
  assignedAgent: string;
  message?: string;
  sessionId: string;
  status: 'pending' | 'running';
  taskId: string;
}

export function isTaskToolOutput(value: unknown): value is TaskToolOutput {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['assignedAgent'] === 'string' &&
    typeof candidate['taskId'] === 'string' &&
    typeof candidate['sessionId'] === 'string' &&
    (candidate['status'] === 'pending' || candidate['status'] === 'running')
  );
}

export function extractToolResultPart(
  message: { content?: MessageContent[] } | undefined,
): Extract<MessageContent, { type: 'tool_result' }> | undefined {
  if (!Array.isArray(message?.content)) {
    return undefined;
  }

  return message.content.find(
    (part): part is Extract<MessageContent, { type: 'tool_result' }> => part.type === 'tool_result',
  );
}

export function extractStructuredToolResultOutput(
  part: Extract<MessageContent, { type: 'tool_result' }> | undefined,
): Record<string, unknown> | null {
  if (!part?.output) {
    return null;
  }

  if (typeof part.output === 'string') {
    try {
      const parsed = JSON.parse(part.output) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  return typeof part.output === 'object' ? (part.output as Record<string, unknown>) : null;
}

export function readSingleTextMessage(message: {
  content: Array<{ type: string; text?: string }>;
}): string {
  const firstContent = message.content[0];
  return firstContent?.type === 'text' && typeof firstContent.text === 'string'
    ? firstContent.text
    : '';
}

export async function seedPendingToolCallConversation(input: {
  clientRequestId: string;
  rawInput: Record<string, unknown>;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  userId: string;
  userMessage: string;
}): Promise<void> {
  const { appendSessionMessageV2: appendSessionMessage } =
    await import('../message/message-v2-adapter.js');

  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'user',
    clientRequestId: input.clientRequestId,
    content: [{ type: 'text', text: input.userMessage }],
  });
  appendSessionMessage({
    sessionId: input.sessionId,
    userId: input.userId,
    role: 'assistant',
    clientRequestId: `${input.clientRequestId}:assistant:1`,
    content: [
      {
        type: 'tool_call',
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        input: input.rawInput,
      },
    ],
  });
}
