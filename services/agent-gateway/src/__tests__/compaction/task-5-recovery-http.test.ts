import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appendSessionMessageV2 } from '../../message/message-v2-adapter.js';
import {
  resumeAnsweredQuestionRequest,
  resumeRejectedPermissionRequest,
} from '../../routes/stream-runtime.js';
import {
  handleStreamRequest,
  loadSessionContext,
  streamRequestSchema,
} from '../../routes/stream.js';
import { closeDb, connectDb, migrate, sqliteRun } from '../../infra/db.js';
import { createSseBody, startHttpSseStub, type HttpSseStub } from './task-5-http-stub.fixture.js';

const USER_ID = 'task-5-recovery-user';
const SESSION_ID = 'task-5-recovery-session';
const MODEL_ID = 'task-5-recovery-model';
const PROVIDER_ID = 'task-5-recovery-provider';
let upstream: HttpSseStub;

function providerSettings(): void {
  const now = new Date().toISOString();
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'providers', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [
      USER_ID,
      JSON.stringify([
        {
          id: PROVIDER_ID,
          type: 'custom',
          name: 'Task 5 local HTTP',
          enabled: true,
          baseUrl: upstream.baseUrl,
          apiKey: 'task-5-recovery-key',
          defaultModels: [
            {
              id: MODEL_ID,
              label: 'Task 5 local model',
              enabled: true,
              contextWindow: 2_000,
              maxOutputTokens: 100,
              supportsTools: true,
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      ]),
    ],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'active_selection', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [
      USER_ID,
      JSON.stringify({
        chat: { providerId: PROVIDER_ID, modelId: MODEL_ID },
        fast: { providerId: PROVIDER_ID, modelId: MODEL_ID },
      }),
    ],
  );
  sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, 'compaction_policy_v1', ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [USER_ID, JSON.stringify({ auto: true, prune: true, recentMessagesKept: 2 })],
  );
}

function seedSession(toolName: string, toolCallId: string): void {
  sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@test`,
    'x',
  ]);
  sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'task-5 recovery',
    '{}',
  ]);
  for (let index = 0; index < 8; index += 1) {
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      content: [{ type: 'text', text: `history ${index} `.repeat(700) }],
      clientRequestId: `task-5-history-user-${index}`,
    });
    appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: `answer ${index}` }],
      clientRequestId: `task-5-history-assistant-${index}`,
    });
  }
  appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    content: [{ type: 'tool_call', toolCallId, toolName, input: {} }],
    clientRequestId: 'task-5-pending-assistant',
  });
  providerSettings();
}

function seedEmptySession(): void {
  sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
  sqliteRun('DELETE FROM users WHERE id = ?', [USER_ID]);
  sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    `${USER_ID}@test`,
    'x',
  ]);
  sqliteRun('INSERT INTO sessions (id, user_id, title, metadata_json) VALUES (?, ?, ?, ?)', [
    SESSION_ID,
    USER_ID,
    'task-5 empty history',
    '{}',
  ]);
  providerSettings();
}

function payload(toolName: string, toolCallId: string) {
  return {
    clientRequestId: 'task-5-recovery-request',
    nextRound: 2,
    requestData: {
      clientRequestId: 'task-5-recovery-request',
      message: 'continue recovery',
      model: MODEL_ID,
      maxTokens: 100,
      temperature: 0,
    },
    rawInput: {},
    toolCallId,
    toolName,
  };
}

function assertRecoveryRequests(): void {
  expect(upstream.requests).toHaveLength(2);
  const requestBodies = upstream.requests.map((body) => JSON.parse(body) as { stream?: boolean });
  expect(requestBodies.every((body) => body.stream === true)).toBe(true);
}

function queueRecoveryStreams(text: string): void {
  upstream.enqueue({
    body: createSseBody('recovery first response'),
    contentType: 'text/event-stream',
    status: 200,
  });
  upstream.enqueue({
    body: createSseBody(text),
    contentType: 'text/event-stream',
    status: 200,
  });
}

function queueNoHistory413Responses(count: number): void {
  for (let index = 0; index < count; index += 1) {
    upstream.enqueue({
      body: JSON.stringify({
        error: { message: 'prompt is too long: 3,000 tokens > 2,000 maximum' },
      }),
      status: 413,
    });
  }
}

beforeAll(async () => {
  await connectDb();
  await migrate();
  upstream = await startHttpSseStub();
});

beforeEach(() => {
  upstream.requests.length = 0;
  sqliteRun('DELETE FROM session_run_events', []);
});

afterAll(async () => {
  await upstream.close();
  await closeDb();
});

describe('任务5权限/问题恢复真实 stream seam', () => {
  it('权限拒绝恢复沿既有循环进入真实 SSE 上游', async () => {
    const toolCallId = 'task-5-permission-call';
    seedSession('write', toolCallId);
    queueRecoveryStreams('permission recovery response');

    await resumeRejectedPermissionRequest({
      payload: payload('write', toolCallId),
      feedback: '请不要写入敏感文件',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    assertRecoveryRequests();
  });

  it('问题回答恢复沿既有循环进入真实 SSE 上游', async () => {
    const toolCallId = 'task-5-question-call';
    seedSession('question', toolCallId);
    queueRecoveryStreams('question recovery response');

    await resumeAnsweredQuestionRequest({
      payload: payload('question', toolCallId),
      answerOutput: 'workspace',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    assertRecoveryRequests();
  });

  it('无历史的连续 413 在真实 HTTP 路径上到达既定轮数上限后停止', async () => {
    seedEmptySession();
    queueNoHistory413Responses(10);
    const sessionContext = loadSessionContext(SESSION_ID, USER_ID);
    if (!sessionContext) {
      throw new Error('任务 5 空历史会话未能从 SQLite 重载');
    }
    const result = await handleStreamRequest({
      headers: {},
      ip: '127.0.0.1',
      method: 'POST',
      path: `/sessions/${SESSION_ID}/stream`,
      requestData: streamRequestSchema.parse({
        clientRequestId: 'task-5-empty-history-request',
        message: 'empty history overflow',
        model: MODEL_ID,
        providerId: PROVIDER_ID,
        maxTokens: 100,
        temperature: 0,
      }),
      sessionContext,
      sessionId: SESSION_ID,
      transport: 'SSE',
      user: { email: `${USER_ID}@test`, sub: USER_ID },
      writeChunk: () => undefined,
    });

    expect(upstream.requests).toHaveLength(10);
    expect(result.stopReason).toBe('error');
    expect(result.statusCode).toBe(200);
  });
});
