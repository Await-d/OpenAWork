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
  globalThis.fetch = mockFetch;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
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

export function createChatCompletionsStream(text: string): Response {
  const encoder = new TextEncoder();
  const openAiFrames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`,
    '',
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
    '',
    'data: [DONE]',
    '',
  ];
  const anthropicFrames = [
    'event: message_start',
    `data: ${JSON.stringify({
      type: 'message_start',
      message: { id: 'msg_mock', usage: { input_tokens: 0, output_tokens: 0 } },
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
      delta: { stop_reason: 'end_turn' },
      usage: { output_tokens: 1 },
    })}`,
    '',
    'event: message_stop',
    `data: ${JSON.stringify({ type: 'message_stop' })}`,
    '',
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode([...openAiFrames, ...anthropicFrames].join('\n')));
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
  signal?: AbortSignal;
  text: string;
}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        const timer = setTimeout(() => {
          controller.enqueue(
            encoder.encode(
              [
                `data: ${JSON.stringify({ choices: [{ delta: { content: input.text } }] })}`,
                '',
                `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
                '',
                'data: [DONE]',
                '',
              ].join('\n'),
            ),
          );
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
