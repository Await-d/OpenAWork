import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { runModelRound } from '../../routes/stream-model-round.js';
import { streamRequestSchema } from '../../routes/stream.js';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import * as db from '../../infra/db.js';
import { createSseBody, startHttpSseStub, type HttpSseStub } from './task-5-http-stub.fixture.js';

const USER_ID = 'task-5-http-user';
const SESSION_ID = 'task-5-http-session';
let upstream: HttpSseStub;
let previousAllowInsecureLocalhost: string | undefined;

function route(overrides: Partial<ModelRouteConfig> = {}): ModelRouteConfig {
  return {
    model: 'task-5-http-model',
    apiBaseUrl: upstream.baseUrl,
    apiKey: 'task-5-http-key',
    contextWindow: 2_000,
    maxTokens: 100,
    temperature: 0,
    upstreamProtocol: 'chat_completions',
    requestOverrides: {},
    providerType: 'custom',
    supportsThinking: false,
    ...overrides,
  };
}

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@test`,
    'x',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'task-5-http',
    '{}',
  ]);
  appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    content: [{ type: 'text', text: 'task 5 HTTP request' }],
    clientRequestId: 'task-5-http-request',
  });
}

function requestData() {
  return streamRequestSchema.parse({
    message: 'task 5 HTTP request',
    clientRequestId: 'task-5-http-request',
    model: 'task-5-http-model',
    maxTokens: 100,
  });
}

async function runRound(currentRoute: ModelRouteConfig, signal = new AbortController().signal) {
  const chunks: unknown[] = [];
  return runModelRound({
    clientRequestId: 'task-5-http-request',
    enabledTools: [],
    eventSequence: { value: 0 },
    requestData: requestData(),
    round: 1,
    route: currentRoute,
    runId: 'task-5-http-run',
    signal,
    sessionContext: { metadataJson: '{}' },
    sessionId: SESSION_ID,
    transport: 'SSE',
    userId: USER_ID,
    wl: new WorkflowLogger(),
    ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
    workspaceCtx: null,
    writeChunk: (chunk) => chunks.push(chunk),
  }).then((result) => ({ chunks, result }));
}

beforeAll(async () => {
  previousAllowInsecureLocalhost = process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
  process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
  await db.connectDb();
  await db.migrate();
  upstream = await startHttpSseStub();
});

beforeEach(() => {
  upstream.requests.length = 0;
  seedSession();
});

afterAll(async () => {
  await upstream.close();
  await db.closeDb();
  if (previousAllowInsecureLocalhost === undefined) {
    delete process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
  } else {
    process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = previousAllowInsecureLocalhost;
  }
});

describe('任务5真实 HTTP/SSE stream seam', () => {
  it('首轮在真实上游调用前检查渲染消息 token，并通过 SSE 完成', async () => {
    upstream.enqueue({
      body: createSseBody('real HTTP response'),
      contentType: 'text/event-stream',
      status: 200,
    });
    let renderedTokens = 0;
    const result = await runModelRound({
      clientRequestId: 'task-5-http-request',
      enabledTools: [],
      eventSequence: { value: 0 },
      requestData: requestData(),
      round: 1,
      route: route(),
      runId: 'task-5-http-run',
      signal: new AbortController().signal,
      sessionContext: { metadataJson: '{}' },
      sessionId: SESSION_ID,
      transport: 'SSE',
      userId: USER_ID,
      wl: new WorkflowLogger(),
      ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
      workspaceCtx: null,
      beforeUpstreamCall: async (tokens) => {
        renderedTokens = tokens;
        return false;
      },
      writeChunk: () => undefined,
    });

    expect(result.stopReason).toBe('end_turn');
    expect(renderedTokens).toBeGreaterThan(0);
    expect(upstream.requests).toHaveLength(1);
    expect(upstream.requests[0]).toContain('task 5 HTTP request');
  });

  it('真实 SSE usage 会归一化并进入 overflow 判定', async () => {
    upstream.enqueue({
      body: createSseBody('usage overflow', { completionTokens: 150, promptTokens: 1_950 }),
      contentType: 'text/event-stream',
      status: 200,
    });

    const { result } = await runRound(route({ maxOutputTokens: 100 }));

    expect(result.stopReason).toBe('end_turn');
    expect(result.usage?.inputTokens).toBe(1_950);
    expect(result.usage?.outputTokens).toBe(150);
    expect(result.overflow).toBe(true);
  });

  it('真实 HTTP 413 且无 usage 会返回 overflow，交给统一恢复门', async () => {
    upstream.enqueue({
      body: JSON.stringify({
        error: { message: 'prompt is too long: 3,000 tokens > 2,000 maximum' },
      }),
      status: 413,
    });

    const { result } = await runRound(route());

    expect(result.stopReason).toBe('error');
    expect(result.statusCode).toBe(200);
    expect(result.overflow).toBe(true);
    expect(result.usage).toBeUndefined();
  });

  it('调用前已取消时保持 cancelled 状态且不发起上游请求', async () => {
    const controller = new AbortController();
    controller.abort();

    const { result } = await runRound(route(), controller.signal);

    expect(result.stopReason).toBe('cancelled');
    expect(result.shouldStop).toBe(true);
    expect(upstream.requests).toHaveLength(0);
  });
});
