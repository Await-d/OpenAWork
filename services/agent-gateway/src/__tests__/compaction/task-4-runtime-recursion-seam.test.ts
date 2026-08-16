import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowLogger, createRequestContext } from '@openAwork/logger';
import type { ModelRouteConfig } from '../../provider/model-router.js';

const calls = vi.hoisted(() => ({
  executeSessionCompaction: vi.fn(),
  upstream: 0,
  payloads: [] as unknown[],
}));

vi.mock('../../session/session-compaction.js', () => ({
  executeSessionCompaction: calls.executeSessionCompaction,
  isAutoCompactCircuitBreakerTripped: vi.fn(() => false),
}));

vi.mock('../../v2-runtime/upstream/stream-runner.js', () => ({
  async *runUpstreamStream(input: { messages: unknown[]; onFinish?: (value: unknown) => void }) {
    calls.upstream += 1;
    calls.payloads.push(input.messages);
    input.onFinish?.({ usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 } });
    yield { type: 'text_delta' as const, delta: 'ok' };
    yield { type: 'done' as const, stopReason: 'end_turn' as const };
  },
}));

import {
  triggerOverflowCompaction,
  triggerProactiveCompaction,
} from '../../compaction/auto-compaction-trigger.js';
import { writeSessionMemoryContent } from '../../compaction/session-memory-store.js';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import { runModelRound } from '../../routes/stream-model-round.js';
import { streamRequestSchema } from '../../routes/stream.js';
import * as db from '../../infra/db.js';

const USER_ID = 'task4-runtime-recursion-user';
const SESSION_ID = 'task4-runtime-recursion-session';
const ROUTE: ModelRouteConfig = {
  model: 'task4-runtime-model',
  apiBaseUrl: 'http://127.0.0.1:1',
  apiKey: 'task4-runtime-key',
  contextWindow: 100_000,
  maxTokens: 2_000,
  temperature: 0,
  upstreamProtocol: 'chat_completions',
  requestOverrides: {},
  providerType: 'custom',
  supportsThinking: false,
};

describe('任务4 runtime requestKind seam', () => {
  beforeAll(async () => {
    await db.connectDb();
    await db.migrate();
    it('closeDb reload 后真实下一轮只发送 marker 摘要和近期尾部，且终态不是 502', async () => {
      for (let index = 0; index < 8; index += 1) {
        appendSessionMessageV2({
          sessionId: SESSION_ID,
          userId: USER_ID,
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `旧历史-${index} ${'旧内容 '.repeat(2_000)}` }],
          clientRequestId: `task4-reload-old-${index}`,
          messageId: `task4-reload-old-message-${index}`,
          status: 'final',
        });
      }
      appendSessionMessageV2({
        sessionId: SESSION_ID,
        userId: USER_ID,
        role: 'user',
        content: [{ type: 'text', text: '近期尾部请求' }],
        clientRequestId: 'task4-reload-tail',
        messageId: 'task4-reload-tail-message',
        status: 'final',
      });
      writeSessionMemoryContent(SESSION_ID, USER_ID, 'reload 后应注入的 marker 摘要');

      const compacted = await triggerOverflowCompaction({
        clientRequestId: 'task4-reload-request',
        compactionSettings: { auto: true, prune: true, recentMessagesKept: 2 },
        metadataJson: '{}',
        route: ROUTE,
        round: 1,
        runId: 'task4-reload-run',
        sessionId: SESSION_ID,
        signal: new AbortController().signal,
        userId: USER_ID,
        roundResult: {
          overflow: true,
          stopReason: 'error',
          usage: { inputTokens: 99_000, outputTokens: 1, totalTokens: 99_001 },
        },
      });
      expect(compacted).toMatchObject({ triggered: true, recovered: true });

      await db.closeDb();
      await db.connectDb();
      await db.migrate();

      const result = await runModelRound({
        clientRequestId: 'task4-reload-next-round',
        enabledTools: [],
        eventSequence: { value: 0 },
        requestData: streamRequestSchema.parse({
          message: '近期尾部请求',
          clientRequestId: 'task4-reload-next-round',
          model: ROUTE.model,
        }),
        round: 2,
        route: ROUTE,
        runId: 'task4-reload-next-run',
        signal: new AbortController().signal,
        sessionContext: { metadataJson: compacted.metadataJson },
        sessionId: SESSION_ID,
        transport: 'SSE',
        userId: USER_ID,
        wl: new WorkflowLogger(),
        ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
        workspaceCtx: null,
        writeChunk: () => undefined,
      });

      const payload = JSON.stringify(calls.payloads.at(-1));
      expect(result.statusCode).not.toBe(502);
      expect(result.stopReason).not.toBe('error');
      expect(payload).toContain('reload 后应注入的 marker 摘要');
      expect(payload).toContain('近期尾部请求');
      expect(payload).not.toContain('旧历史-0');
      expect(payload).not.toContain('旧历史-7');
      expect(calls.upstream).toBe(1);
    });
  });

  beforeEach(() => {
    calls.executeSessionCompaction.mockReset();
    calls.upstream = 0;
    calls.payloads = [];
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
      'task 4 runtime recursion seam',
      '{}',
    ]);
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      content: [{ type: 'text', text: '继续执行当前任务' }],
      clientRequestId: 'task4-runtime-request',
      status: 'final',
    });
  });

  afterAll(() => {
    db.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
    db.sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  });

  it.each(['compaction', 'session_memory'] as const)(
    '真实 runModelRound 在 %s 子请求被拒绝后只继续一次正常上游调用',
    async (requestKind) => {
      let preflightCalls = 0;
      await runModelRound({
        clientRequestId: 'task4-runtime-request',
        enabledTools: [],
        eventSequence: { value: 0 },
        requestData: streamRequestSchema.parse({
          message: '继续执行当前任务',
          clientRequestId: 'task4-runtime-request',
          model: ROUTE.model,
        }),
        round: 1,
        route: ROUTE,
        runId: 'task4-runtime-run',
        signal: new AbortController().signal,
        sessionContext: { metadataJson: '{}' },
        sessionId: SESSION_ID,
        transport: 'SSE',
        userId: USER_ID,
        wl: new WorkflowLogger(),
        ctx: createRequestContext('POST', '/stream', {}, '127.0.0.1'),
        workspaceCtx: null,
        beforeUpstreamCall: async () => {
          preflightCalls += 1;
          const result = await triggerProactiveCompaction({
            clientRequestId: 'task4-runtime-request',
            compactionSettings: { auto: true, prune: true, recentMessagesKept: 2 },
            lastRoundUsage: { inputTokens: 99_000 },
            metadataJson: '{}',
            requestKind,
            route: ROUTE,
            round: 1,
            runId: 'task4-runtime-run',
            sessionId: SESSION_ID,
            signal: new AbortController().signal,
            userId: USER_ID,
          });
          return result.triggered;
        },
        writeChunk: () => undefined,
      });

      expect(preflightCalls).toBe(1);
      expect(calls.executeSessionCompaction).not.toHaveBeenCalled();
      expect(calls.upstream).toBe(1);
    },
  );
});
