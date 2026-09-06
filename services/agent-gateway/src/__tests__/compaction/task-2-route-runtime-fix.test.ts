import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { microcompactMessages } from '../../compaction/microcompact.js';
import * as db from '../../infra/db.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import { runModelRound } from '../../routes/stream-model-round.js';
import { streamRequestSchema, type StreamRequest } from '../../routes/stream.js';

const COMPACTED_REFERENCE_MARKER = String.raw`\"microcompacted\":true`;
const USER_ID = 'task-2-user-runtime';
const SESSION_ID = 'task-2-session-runtime';

type CapturedRequest = {
  readonly body: string;
  readonly url: string;
};

type StoredRow = {
  readonly data: string;
  readonly id: string;
  readonly message_id: string | null;
};

type StoredRowBytes = {
  readonly data: Buffer;
  readonly id: string;
  readonly message_id: string | null;
};

let previousDatabasePath: string | undefined;
let previousAllowInsecureLocalhost: string | undefined;
let temporaryDatabaseDirectory = '';
let upstreamOrigin = '';
let upstreamServer: Server;
let sseStopCount = 0;
const capturedRequests: CapturedRequest[] = [];

function writeOpenAiSse(response: ServerResponse): void {
  sseStopCount += 1;
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  response.end(
    [
      `data: ${JSON.stringify({
        choices: [{ delta: { content: 'stub reply' }, finish_reason: null, index: 0 }],
        created: 1,
        id: 'chatcmpl-task-2',
        model: 'stub-model',
        object: 'chat.completion.chunk',
      })}\n\n`,
      `data: ${JSON.stringify({
        choices: [{ delta: {}, finish_reason: 'stop', index: 0 }],
        created: 1,
        id: 'chatcmpl-task-2',
        model: 'stub-model',
        object: 'chat.completion.chunk',
        usage: { completion_tokens: 1, prompt_tokens: 1_000, total_tokens: 1_001 },
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
  );
}

function writeAnthropicSse(response: ServerResponse): void {
  sseStopCount += 1;
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  response.end(
    [
      `event: message_start\ndata: ${JSON.stringify({
        message: {
          content: [],
          id: 'msg-task-2',
          model: 'stub-model',
          role: 'assistant',
          stop_reason: null,
          stop_sequence: null,
          type: 'message',
          usage: { input_tokens: 1_000, output_tokens: 0 },
        },
        type: 'message_start',
      })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({
        content_block: { text: '', type: 'text' },
        index: 0,
        type: 'content_block_start',
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        delta: { text: 'stub reply', type: 'text_delta' },
        index: 0,
        type: 'content_block_delta',
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({
        index: 0,
        type: 'content_block_stop',
      })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        type: 'message_delta',
        usage: { output_tokens: 1 },
      })}\n\n`,
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ].join(''),
  );
}

async function startUpstreamStub(): Promise<void> {
  upstreamServer = createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk) => {
        chunks.push(Buffer.from(chunk));
      });
      await once(request, 'end');

      capturedRequests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        url: request.url ?? '',
      });

      if (request.url?.endsWith('/messages')) {
        writeAnthropicSse(response);
        return;
      }
      writeOpenAiSse(response);
    })().catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error), { cause: error }));
    });
  });
  upstreamServer.listen(0, '127.0.0.1');
  await once(upstreamServer, 'listening');
  const address = upstreamServer.address();
  if (address === null || typeof address === 'string') {
    throw new Error('任务 2 本地上游 SSE 服务未获得 TCP 地址');
  }
  upstreamOrigin = `http://127.0.0.1:${address.port}`;
}

async function stopUpstreamStub(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    upstreamServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function snapshot(table: 'message_v2' | 'part_v2'): StoredRowBytes[] {
  const columns = table === 'part_v2' ? 'id, message_id, data' : 'id, NULL AS message_id, data';
  return db
    .sqliteAll<StoredRow>(`SELECT ${columns} FROM ${table} WHERE session_id = ? ORDER BY id`, [
      SESSION_ID,
    ])
    .map((row) => ({ ...row, data: Buffer.from(row.data, 'utf8') }));
}

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@example.test`,
    'test',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'task 2 compaction runtime',
    '{}',
  ]);
}

function appendUser(text: string, createdAt: number, threadId?: string): void {
  appendSessionMessageV2({
    clientRequestId: threadId ?? 'task-2-user-request',
    content: [{ text, type: 'text' }],
    createdAt,
    role: 'user',
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

function appendToolTurn(index: number, createdAt: number, threadId?: string): void {
  const toolCallId = `task-2-tool-${index}`;
  const requestPrefix = threadId ? `${threadId}:` : 'task-2-';
  appendSessionMessageV2({
    clientRequestId: `${requestPrefix}assistant-${index}`,
    content: [
      {
        input: { path: `file-${index}.ts` },
        toolCallId,
        toolName: 'read_file',
        type: 'tool_call',
      },
    ],
    createdAt,
    modelID: 'stub-model',
    providerID: 'custom',
    role: 'assistant',
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
  appendSessionMessageV2({
    clientRequestId: `${requestPrefix}tool-${index}`,
    content: [
      {
        isError: false,
        output: `persisted tool output ${index} `.repeat(24),
        toolCallId,
        toolName: 'read_file',
        type: 'tool_result',
      },
    ],
    createdAt: createdAt + 1,
    role: 'tool',
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

function route(overrides: Partial<ModelRouteConfig> = {}): ModelRouteConfig {
  return {
    apiBaseUrl: `${upstreamOrigin}/v1`,
    apiKey: 'task-2-test-key',
    contextWindow: 2_000,
    maxOutputTokens: 100,
    maxTokens: 100,
    model: 'stub-model',
    providerType: 'custom',
    requestOverrides: {},
    supportsThinking: false,
    temperature: 0,
    upstreamProtocol: 'chat_completions',
    ...overrides,
  };
}

function requestData(threadId?: string): StreamRequest {
  return streamRequestSchema.parse({
    ...(threadId ? { teamTaskThreadId: threadId } : {}),
    clientRequestId: 'task-2-round-request',
    maxTokens: 100,
    message: 'continue',
    model: 'stub-model',
    temperature: 0,
  });
}

async function runRound(currentRoute: ModelRouteConfig, threadId?: string) {
  const chunks: unknown[] = [];
  const result = await runModelRound({
    clientRequestId: 'task-2-round-request',
    compactionReservedTokens: 500,
    ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
    enabledTools: [],
    eventSequence: { value: 0 },
    requestData: requestData(threadId),
    round: 1,
    route: currentRoute,
    runId: 'task-2-run',
    sessionContext: { metadataJson: '{}' },
    sessionId: SESSION_ID,
    signal: new AbortController().signal,
    transport: 'SSE',
    userId: USER_ID,
    wl: new WorkflowLogger(),
    workspaceCtx: null,
    writeChunk: (chunk) => chunks.push(chunk),
  });
  return { chunks, result };
}

function capturedRequestBody(): string {
  expect(capturedRequests).toHaveLength(1);
  return capturedRequests[0]?.body ?? '';
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

beforeAll(async () => {
  previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
  previousAllowInsecureLocalhost = process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
  process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
  temporaryDatabaseDirectory = await mkdtemp(join(tmpdir(), 'openawork-task-2-runtime-'));
  await db.closeDb();
  process.env['OPENAWORK_DATABASE_PATH'] = join(temporaryDatabaseDirectory, 'gateway.sqlite');
  await db.connectDb();
  await db.migrate();
  await startUpstreamStub();
});

beforeEach(() => {
  capturedRequests.length = 0;
  sseStopCount = 0;
  seedSession();
});

afterAll(async () => {
  await stopUpstreamStub();
  await db.closeDb();
  if (previousDatabasePath === undefined) {
    delete process.env['OPENAWORK_DATABASE_PATH'];
  } else {
    process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
  }
  if (previousAllowInsecureLocalhost === undefined) {
    delete process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
  } else {
    process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = previousAllowInsecureLocalhost;
  }
  await rm(temporaryDatabaseDirectory, { force: true, recursive: true });
  await db.connectDb();
});

describe('任务 2 真实 route runtime 微压缩', () => {
  it('真实 runModelRound 不按工具数量微压缩，并在 SQLite 重载后保留既有原始字节', async () => {
    appendUser('run with persisted history', Date.now() - 61 * 60_000);
    for (let index = 0; index < 21; index += 1) {
      appendToolTurn(index, Date.now() - (21 - index) * 1_000);
    }
    const beforeMessages = snapshot('message_v2');
    const beforeParts = snapshot('part_v2');

    const { result } = await runRound(route());
    const requestBody = capturedRequestBody();
    const beforeMessageIds = new Set(beforeMessages.map((row) => row.id));
    const beforePartIds = new Set(beforeParts.map((row) => row.id));

    expect(result.stopReason).toBe('end_turn');
    expect(sseStopCount).toBe(1);
    expect(capturedRequests[0]?.url).toBe('/v1/chat/completions');
    expect(requestBody).not.toContain(COMPACTED_REFERENCE_MARKER);

    await db.closeDb();
    await db.connectDb();

    expect(snapshot('message_v2').filter((row) => beforeMessageIds.has(row.id))).toEqual(
      beforeMessages,
    );
    expect(snapshot('part_v2').filter((row) => beforePartIds.has(row.id))).toEqual(beforeParts);
  });

  it('Anthropic 路由关闭时间策略时不施加固定累计预算', async () => {
    for (let index = 0; index < 8; index += 1) {
      appendToolTurn(index, Date.now() - 61 * 60_000 - index * 1_000);
    }

    const { result } = await runRound(
      route({
        apiBaseUrl: upstreamOrigin,
        providerType: 'anthropic',
        upstreamProtocol: 'anthropic_messages',
      }),
    );
    const requestBody = capturedRequestBody();

    expect(result.stopReason).toBe('end_turn');
    expect(sseStopCount).toBe(1);
    expect(capturedRequests[0]?.url).toBe('/messages');
    expect(requestBody).not.toContain(COMPACTED_REFERENCE_MARKER);
    expect(requestBody).toContain('persisted tool output 0');
  });

  it('teamTaskThreadId 跳过废弃的时间和 count 微压缩', async () => {
    const threadId = 'task-2-thread';
    appendUser('thread history', Date.now() - 61 * 60_000, threadId);
    for (let index = 0; index < 21; index += 1) {
      appendToolTurn(index, Date.now() - 61 * 60_000 - index * 1_000, threadId);
    }

    const { result } = await runRound(
      route({
        apiBaseUrl: upstreamOrigin,
        providerType: 'anthropic',
        upstreamProtocol: 'anthropic_messages',
      }),
      threadId,
    );
    const requestBody = capturedRequestBody();

    expect(result.stopReason).toBe('end_turn');
    expect(sseStopCount).toBe(1);
    expect(countOccurrences(requestBody, COMPACTED_REFERENCE_MARKER)).toBe(0);
    expect(requestBody).toContain('persisted tool output 0');
  });

  it('废弃时间策略不再改变 token 级剪枝判断', () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      content: `boundary output ${index} `.repeat(10),
      role: 'tool' as const,
      toolCallId: `boundary-${index}`,
      toolName: 'read_file',
    }));
    const now = 1_000_000;
    vi.useFakeTimers({ now });
    try {
      const evaluate = (minutes: number) =>
        microcompactMessages(
          messages,
          { timeBasedEnabled: true, timeBasedKeepRecent: 5, triggerThreshold: 100 },
          { lastAssistantTimestamp: now - minutes * 60_000 },
        );

      expect(evaluate(59).trigger).toBe('none');
      expect(evaluate(60)).toMatchObject({ clearedCount: 0, trigger: 'none' });
      expect(evaluate(61)).toMatchObject({ clearedCount: 0, trigger: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('默认时间策略关闭，即使已有 61 分钟 assistant 时间也不替换结果', () => {
    const messages = Array.from({ length: 6 }, (_, index) => ({
      content: `default time output ${index} `.repeat(10),
      role: 'tool' as const,
      toolCallId: `default-${index}`,
      toolName: 'read_file',
    }));
    const now = 1_000_000;
    vi.useFakeTimers({ now });
    try {
      expect(
        microcompactMessages(
          messages,
          { triggerThreshold: 100 },
          { lastAssistantTimestamp: now - 61 * 60_000 },
        ),
      ).toMatchObject({ applied: false, trigger: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('显式保护的 skill result 不会被废弃的 count 和 time 配置替换', () => {
    const skillMessage = {
      content: 'protected skill result '.repeat(20),
      role: 'tool' as const,
      toolCallId: 'skill-protected',
      toolName: 'skill',
    };
    const fileResults = Array.from({ length: 21 }, (_, index) => ({
      content: `file result ${index} `.repeat(20),
      role: 'tool' as const,
      toolCallId: `file-${index}`,
      toolName: 'read_file',
    }));
    const protectedTools = new Set(['skill']);
    const countCompacted = microcompactMessages([skillMessage, ...fileResults], {
      protectedTools,
    });
    const now = 1_000_000;
    vi.useFakeTimers({ now });
    try {
      const timeCompacted = microcompactMessages(
        [skillMessage, ...fileResults.slice(0, 6)],
        { protectedTools, timeBasedEnabled: true, timeBasedKeepRecent: 5, triggerThreshold: 100 },
        { lastAssistantTimestamp: now - 61 * 60_000 },
      );

      expect(countCompacted.trigger).toBe('none');
      expect(timeCompacted.trigger).toBe('none');
      expect(countCompacted.messages[0]?.content).toBe(skillMessage.content);
      expect(timeCompacted.messages[0]?.content).toBe(skillMessage.content);
    } finally {
      vi.useRealTimers();
    }
  });
});
