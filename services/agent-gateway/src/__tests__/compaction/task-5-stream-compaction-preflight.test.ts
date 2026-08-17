import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { runModelRound } from '../../routes/stream-model-round.js';
import {
  handleStreamRequest,
  loadSessionContext,
  streamRequestSchema,
  type StreamRequest,
} from '../../routes/stream.js';
import { resumeAnsweredQuestionRequest } from '../../routes/stream-runtime.js';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import * as db from '../../infra/db.js';

type UpstreamFinish = {
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly totalTokens: number;
  };
};

type StubStreamInput = {
  readonly messages: readonly unknown[];
  readonly onFinish?: (value: UpstreamFinish) => void;
  readonly signal?: AbortSignal;
  readonly system?: unknown;
};

type StubStreamCall = {
  readonly messages: string;
  readonly system: string;
};

const streamStub = vi.hoisted(() => {
  const calls: StubStreamCall[] = [];
  const noOpAbort = (): void => undefined;
  return {
    abort: noOpAbort,
    calls,
    emitContextLimitOnFirst: false,
    emitHighUsageOnFirst: false,
  };
});

const compactionStub = vi.hoisted(() => ({
  overflow: vi.fn(),
  proactive: vi.fn(),
}));

const providerCatalogStub = vi.hoisted(() => ({
  getChatProvider: vi.fn(),
  getFastProvider: vi.fn(),
  getProviderForSelection: vi.fn(),
}));

vi.mock('../../compaction/auto-compaction-trigger.js', () => ({
  triggerOverflowCompaction: compactionStub.overflow,
  triggerProactiveCompaction: compactionStub.proactive,
}));

vi.mock('../../provider/provider-catalog.js', () => providerCatalogStub);

vi.mock('../../v2-runtime/upstream/index.js', async () => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- typeof import() 是 vitest mock 常见模式
  const actual = await vi.importActual<typeof import('../../v2-runtime/upstream/index.js')>(
    '../../v2-runtime/upstream/index.js',
  );
  const { Stream } = await import('effect');
  return {
    ...actual,
    runUpstreamStream(input: StubStreamInput) {
      const callIndex = streamStub.calls.length;
      streamStub.calls.push({
        messages: JSON.stringify(input.messages),
        system: JSON.stringify(input.system ?? null),
      });
      streamStub.abort();
      if (input.signal?.aborted) {
        const error = new Error('task-5 aborted upstream stream');
        error.name = 'AbortError';
        return Stream.fail(error);
      }
      if (streamStub.emitContextLimitOnFirst && callIndex === 0) {
        return Stream.fail(new Error('context length 1,000 maximum 100'));
      }
      const inputTokens = streamStub.emitHighUsageOnFirst && callIndex === 0 ? 1_000_000 : 2;
      input.onFinish?.({ usage: { inputTokens, outputTokens: 1, totalTokens: inputTokens + 1 } });
      return Stream.fromIterable([
        { type: 'text_delta' as const, delta: 'ok' },
        { type: 'done' as const, stopReason: 'end_turn' as const },
      ]);
    },
  };
});

const userId = 'task-5-preflight-user';
const sessionId = 'task-5-preflight-session';
const route: ModelRouteConfig = {
  model: 'stub-model',
  apiBaseUrl: 'http://127.0.0.1:1',
  apiKey: 'stub',
  contextWindow: 2_000,
  maxTokens: 100,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  providerType: 'custom',
  supportsThinking: false,
};

let previousDatabasePath: string | undefined;
let previousAllowInsecureLocalhost: string | undefined;
let temporaryDatabaseDirectory = '';

function configureProvider(): void {
  const provider = {
    baseUrl: 'http://127.0.0.1:1',
    createdAt: '2026-08-16T00:00:00.000Z',
    defaultModels: [{ enabled: true, id: 'stub-model', label: 'stub-model' }],
    enabled: true,
    id: 'task-5-provider',
    name: 'Task 5 stream provider',
    type: 'custom',
    updatedAt: '2026-08-16T00:00:00.000Z',
  };
  providerCatalogStub.getChatProvider.mockResolvedValue({ modelId: 'stub-model', provider });
  providerCatalogStub.getProviderForSelection.mockResolvedValue({
    modelId: 'stub-model',
    provider,
  });
}

function seedSession(): void {
  db.sqliteRun('DELETE FROM sessions WHERE id = ?', [sessionId]);
  db.sqliteRun('DELETE FROM users WHERE id = ?', [userId]);
  db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    userId,
    `${userId}@test`,
    'x',
  ]);
  db.sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    sessionId,
    userId,
    'preflight',
    '{}',
  ]);
}

function appendUserMessage(input: { clientRequestId: string; text: string }): void {
  appendSessionMessageV2({
    sessionId,
    userId,
    role: 'user',
    content: [{ type: 'text', text: input.text }],
    clientRequestId: input.clientRequestId,
  });
}

function requestData(clientRequestId = 'task-5-request'): StreamRequest {
  return streamRequestSchema.parse({
    clientRequestId,
    message: 'hello',
    model: 'stub-model',
    providerId: 'task-5-provider',
  });
}

function sessionContext() {
  const context = loadSessionContext(sessionId, userId);
  if (!context) {
    throw new Error('任务 5 测试会话未能从 SQLite 重载');
  }
  return context;
}

async function runRound(
  input: {
    readonly beforeUpstreamCall?: (renderedMessageTokens: number) => Promise<boolean>;
    readonly injectedPrompt?: string;
    readonly startWorkContext?: string;
    readonly syntheticContinuationPrompt?: string;
    readonly workspaceCtx?: string | null;
  } = {},
) {
  const chunks: unknown[] = [];
  const result = await runModelRound({
    beforeUpstreamCall: input.beforeUpstreamCall,
    clientRequestId: 'task-5-request',
    ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
    enabledTools: [],
    eventSequence: { value: 0 },
    injectedPrompt: input.injectedPrompt,
    requestData: requestData(),
    round: 1,
    route,
    runId: 'task-5-run',
    sessionContext: sessionContext(),
    sessionId,
    signal: new AbortController().signal,
    startWorkContext: input.startWorkContext,
    syntheticContinuationPrompt: input.syntheticContinuationPrompt,
    transport: 'SSE',
    userId,
    wl: new WorkflowLogger(),
    workspaceCtx: input.workspaceCtx ?? null,
    writeChunk: (chunk) => chunks.push(chunk),
  });
  return { chunks, result };
}

async function capturePreflightTokens(
  input: {
    readonly injectedPrompt?: string;
    readonly startWorkContext?: string;
    readonly syntheticContinuationPrompt?: string;
    readonly workspaceCtx?: string | null;
  } = {},
): Promise<number> {
  seedSession();
  appendUserMessage({ clientRequestId: 'task-5-request', text: 'hello' });
  streamStub.calls.length = 0;
  let renderedTokens = 0;
  const { result } = await runRound({
    ...input,
    beforeUpstreamCall: async (tokens) => {
      renderedTokens = tokens;
      return false;
    },
  });
  expect(result.stopReason).toBe('end_turn');
  return renderedTokens;
}

async function runHandleStreamRequest(signal?: AbortSignal) {
  const chunks: unknown[] = [];
  const result = await handleStreamRequest({
    headers: {},
    ip: '127.0.0.1',
    method: 'POST',
    path: '/sessions/task-5-preflight-session/stream',
    requestData: requestData(),
    sessionContext: sessionContext(),
    sessionId,
    signal,
    transport: 'SSE',
    user: { email: `${userId}@test`, sub: userId },
    writeChunk: (chunk) => chunks.push(chunk),
  });
  return { chunks, result };
}

beforeAll(async () => {
  previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
  previousAllowInsecureLocalhost = process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'];
  process.env['OPENAWORK_ALLOW_INSECURE_LOCALHOST_PROVIDER'] = '1';
  temporaryDatabaseDirectory = await mkdtemp(join(tmpdir(), 'openawork-task-5-stream-'));
  await db.closeDb();
  process.env['OPENAWORK_DATABASE_PATH'] = join(temporaryDatabaseDirectory, 'gateway.sqlite');
  await db.connectDb();
  await db.migrate();
});

beforeEach(() => {
  compactionStub.overflow.mockReset();
  compactionStub.proactive.mockReset();
  compactionStub.overflow.mockResolvedValue({ metadataJson: '{}', triggered: false });
  compactionStub.proactive.mockResolvedValue({ metadataJson: '{}', triggered: false });
  providerCatalogStub.getChatProvider.mockReset();
  providerCatalogStub.getFastProvider.mockReset();
  providerCatalogStub.getProviderForSelection.mockReset();
  configureProvider();
  streamStub.abort = () => undefined;
  streamStub.calls.length = 0;
  streamStub.emitContextLimitOnFirst = false;
  streamStub.emitHighUsageOnFirst = false;
  seedSession();
  appendUserMessage({ clientRequestId: 'task-5-request', text: 'hello' });
});

afterAll(async () => {
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

describe('任务5 stream preflight seam', () => {
  it('在真实 runModelRound route seam 的上游调用前执行一次渲染消息检查', async () => {
    let renderedTokens = 0;
    const chunks: unknown[] = [];
    const result = await runModelRound({
      clientRequestId: 'task-5-request',
      enabledTools: [],
      eventSequence: { value: 0 },
      requestData: streamRequestSchema.parse({
        message: 'hello',
        clientRequestId: 'task-5-request',
        model: 'stub-model',
      }),
      round: 1,
      route,
      runId: 'task-5-run',
      signal: new AbortController().signal,
      sessionContext: { metadataJson: '{}' },
      sessionId,
      transport: 'SSE',
      userId,
      wl: new WorkflowLogger(),
      ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
      workspaceCtx: null,
      beforeUpstreamCall: async (tokens) => {
        renderedTokens = tokens;
        return false;
      },
      writeChunk: (chunk) => chunks.push(chunk),
    });
    expect(renderedTokens).toBeGreaterThan(0);
    expect(streamStub.calls).toHaveLength(1);
    expect(result.stopReason).toBe('end_turn');
    expect(result.statusCode).not.toBe(502);
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: 'error' }));
  });

  it('stable system、dynamic system、synthetic context 和 synthetic continuation 均改变 preflight token 输入', async () => {
    const baseline = await capturePreflightTokens();
    const stableSystem = await capturePreflightTokens({
      workspaceCtx: '<task5-stable-system>'.repeat(1_000),
    });
    const dynamicSystem = await capturePreflightTokens({
      startWorkContext: '<task5-dynamic-system>'.repeat(1_000),
    });
    const syntheticContext = await capturePreflightTokens({
      injectedPrompt: '<task5-synthetic-context>'.repeat(1_000),
    });
    const syntheticContinuation = await capturePreflightTokens({
      syntheticContinuationPrompt: '<task5-synthetic-continuation>'.repeat(1_000),
    });

    expect(stableSystem).toBeGreaterThan(baseline);
    expect(dynamicSystem).toBeGreaterThan(baseline);
    expect(syntheticContext).toBeGreaterThan(baseline);
    expect(syntheticContinuation).toBeGreaterThan(baseline);
  });

  it('beforeUpstreamCall 返回 true 后从 SQLite 重载投影，且仅触发一次 hook 与一次主对话 upstream', async () => {
    const projectionMarker = '<task5-sqlite-projected-turn>'.repeat(400);
    let hookCalls = 0;

    const { chunks, result } = await runRound({
      beforeUpstreamCall: async () => {
        hookCalls += 1;
        appendUserMessage({
          clientRequestId: 'task-5-projection-request',
          text: projectionMarker,
        });
        return true;
      },
    });

    expect(hookCalls).toBe(1);
    expect(streamStub.calls).toHaveLength(1);
    expect(streamStub.calls[0]?.messages).toContain(projectionMarker);
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'end_turn' });
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    expect(result.statusCode).not.toBe(502);
  });

  it('handleStreamRequest 的首轮 compaction replay 只启动一次主对话 stream 并以 end_turn 完成', async () => {
    compactionStub.proactive.mockResolvedValue({ metadataJson: '{}', triggered: true });

    const { chunks, result } = await runHandleStreamRequest();

    expect(compactionStub.proactive).toHaveBeenCalledTimes(1);
    expect(streamStub.calls).toHaveLength(1);
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'end_turn' });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'done', stopReason: 'end_turn' }),
    );
  });

  it('handleStreamRequest 在 usage overflow compaction replay 中仅运行两次主对话，并将 continuation 投影到第二轮', async () => {
    const continuationMarker = '<task5-overflow-continuation>';
    streamStub.emitHighUsageOnFirst = true;
    compactionStub.overflow.mockResolvedValue({
      metadataJson: '{}',
      syntheticContinuationPrompt: continuationMarker,
      triggered: true,
    });

    const { chunks, result } = await runHandleStreamRequest();

    expect(compactionStub.overflow).toHaveBeenCalledTimes(1);
    expect(streamStub.calls).toHaveLength(2);
    expect(streamStub.calls[1]?.messages).toContain(continuationMarker);
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'end_turn' });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'done', stopReason: 'end_turn' }),
    );
  });

  it('handleStreamRequest 在 413 context overflow replay 后以第二次主对话完成', async () => {
    streamStub.emitContextLimitOnFirst = true;
    compactionStub.overflow.mockResolvedValue({ metadataJson: '{}', triggered: true });

    const { chunks, result } = await runHandleStreamRequest();

    expect(compactionStub.overflow).toHaveBeenCalledTimes(1);
    expect(streamStub.calls).toHaveLength(2);
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'end_turn' });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'done', stopReason: 'end_turn' }),
    );
  });

  it('permission answer resume 经 continueFromApprovedToolResult 只运行一次主对话并结束会话', async () => {
    const observedEvents: unknown[] = [];
    const { subscribeSessionRunEvents } = await import('../../session/session-run-events.js');
    const unsubscribe = subscribeSessionRunEvents(sessionId, (event) => observedEvents.push(event));
    try {
      await resumeAnsweredQuestionRequest({
        answerOutput: '<task5-permission-answer>',
        payload: {
          clientRequestId: 'task-5-request',
          nextRound: 1,
          rawInput: {},
          requestData: requestData(),
          toolCallId: 'task-5-permission-call',
          toolName: 'question',
        },
        sessionId,
        userId,
      });
    } finally {
      unsubscribe();
    }

    const persistedState = db.sqliteGet<{ state_status: string }>(
      'SELECT state_status FROM sessions WHERE id = ?',
      [sessionId],
    );
    expect(streamStub.calls).toHaveLength(1);
    expect(observedEvents).toContainEqual(
      expect.objectContaining({ type: 'done', stopReason: 'end_turn' }),
    );
    expect(persistedState?.state_status).toBe('idle');
  });

  it('handleStreamRequest 收到 abort 后只启动一次主对话并以 cancelled 终态清理', async () => {
    const abortController = new AbortController();
    streamStub.abort = () => abortController.abort();

    const { chunks, result } = await runHandleStreamRequest(abortController.signal);

    expect(streamStub.calls).toHaveLength(1);
    expect(result).toMatchObject({ statusCode: 200, stopReason: 'cancelled' });
    expect(chunks).toContainEqual(
      expect.objectContaining({ type: 'done', stopReason: 'cancelled' }),
    );
    expect(chunks).not.toContainEqual(expect.objectContaining({ type: 'error' }));
  });
});
