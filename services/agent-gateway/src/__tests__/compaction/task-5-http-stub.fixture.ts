import { createServer, type Server } from 'node:http';

export type HttpStubResponse = {
  readonly body: string;
  readonly contentType?: string;
  readonly status: number;
};

export type UsageFixture = {
  readonly completionTokens: number;
  readonly promptTokens: number;
};

export type HttpSseStub = {
  readonly baseUrl: string;
  readonly requests: string[];
  enqueue(response: HttpStubResponse): void;
  close(): Promise<void>;
};

export function createSseBody(text: string, usage?: UsageFixture): string {
  const frames = [
    {
      id: 'task-5-chat-completion',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: text },
          finish_reason: null,
        },
      ],
    },
    {
      id: 'task-5-chat-completion',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      ...(usage
        ? {
            usage: {
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.promptTokens + usage.completionTokens,
            },
          }
        : {}),
    },
  ];

  return `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')}data: [DONE]\n\n`;
}

export async function startHttpSseStub(): Promise<HttpSseStub> {
  const responses: HttpStubResponse[] = [];
  const requests: string[] = [];
  const server: Server = createServer((request, response) => {
    void (async () => {
      let body = '';
      for await (const chunk of request) {
        body += String(chunk);
      }
      requests.push(body);
      const next = responses.shift() ?? {
        body: createSseBody('default task-5 response'),
        contentType: 'text/event-stream',
        status: 200,
      };
      response.writeHead(next.status, {
        'Content-Type': next.contentType ?? 'application/json',
        'Cache-Control': 'no-cache',
      });
      response.end(next.body);
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error), { cause: error }));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('HTTP stub 未分配 TCP 端口');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    enqueue: (response) => {
      responses.push(response);
    },
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
