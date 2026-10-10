/**
 * `GET /sessions/:id` 的两项读取优化(见 routes/sessions.ts 同名路由的注释):
 *
 * 1. 转录只读一次 —— legacy / runtime 两条读取曾各读一遍同一张 `message_v2` +
 *    `part_v2`(runtime 集恒为 legacy 子集);现走 `readSessionMessagesWithRuntimeSplit`
 *    单次读取 + 内存切分,输出不变。
 * 2. run event 只回当前活跃线程 —— 此前无条件全量读 replay 日志(每个 delta
 *    chunk 一行,长会话可达数万行),而前端唯一消费者 `recoverActiveAssistantStream`
 *    也只取最新 run。
 *
 * 另覆盖 `messages=0` 轻量模式:只回会话元数据,跳过转录 / run event / 文件变更聚合。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionRunEventsModule from '../../session/session-run-events.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-detail-light-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-detail-light-data-'));
const SESSION_ID = 'sess-detail-light';
const USER_ID = 'u-detail-light';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'detail-light-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;
let runEvents: typeof SessionRunEventsModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  const { registerErrorHandler } = await import('../../infra/error-handler.js');
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'detail-light@example.com' })}`;
}

function seedMessage(role: 'user' | 'assistant', text: string, createdAt: number): void {
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role,
    clientRequestId: `req-${createdAt}`,
    createdAt,
    content: [{ type: 'text', text }],
  });
}

function seedRunEvent(clientRequestId: string, delta: string, eventId: string, occurredAt: number) {
  runEvents.persistSessionRunEventForRequest(
    SESSION_ID,
    { type: 'text_delta', delta, eventId, runId: eventId, occurredAt },
    { clientRequestId },
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  runEvents = await import('../../session/session-run-events.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.restoreAllMocks();
  dbModule.sqliteRun('DELETE FROM session_run_events');
  dbModule.sqliteRun('DELETE FROM session_runtime_threads');
  dbModule.sqliteRun('DELETE FROM part_v2');
  dbModule.sqliteRun('DELETE FROM message_v2');
  dbModule.sqliteRun('DELETE FROM session_messages');
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  dbModule.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'detail-light@example.com', 'x')",
    [USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '详情轻读会话', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

interface SessionDetailBody {
  session: {
    fileChangesSummary?: unknown;
    id: string;
    messages: Array<{ content: Array<{ type: string; text?: string }>; role: string }>;
    runEvents: Array<{ delta?: string; eventId?: string; type: string }>;
    title?: string;
  };
}

describe('GET /sessions/:sessionId', () => {
  it('默认返回全量转录(单次读取,输出不变)', async () => {
    seedMessage('user', '你好', 1);
    seedMessage('assistant', '收到', 2);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as SessionDetailBody;
      expect(body.session.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    } finally {
      await app.close();
    }
  });

  it('只回当前活跃线程的 run event,历史 run event 不再随详情返回', async () => {
    seedMessage('user', '提问', 1);
    seedRunEvent('req-old', '旧轮输出', 'evt-old', 100);
    seedRunEvent('req-active', '当前轮输出', 'evt-active', 200);
    const { upsertSessionRuntimeThread } =
      await import('../../session/session-runtime-thread-store.js');
    upsertSessionRuntimeThread({
      clientRequestId: 'req-active',
      heartbeatAtMs: Date.now(),
      sessionId: SESSION_ID,
      startedAtMs: Date.now(),
      userId: USER_ID,
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      const deltas = (response.json() as SessionDetailBody).session.runEvents.map(
        (event) => event.delta,
      );
      expect(deltas).toEqual(['当前轮输出']);
    } finally {
      await app.close();
    }
  });

  it('空闲会话不返回 run event(不再全量读 replay 日志)', async () => {
    seedMessage('user', '提问', 1);
    seedRunEvent('req-old', '旧轮输出', 'evt-old', 100);
    seedRunEvent('req-older', '更旧输出', 'evt-older', 50);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      expect((response.json() as SessionDetailBody).session.runEvents).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('messages=0 只回元数据:空转录、无 run event、无文件变更聚合', async () => {
    seedMessage('user', '提问', 1);
    seedRunEvent('req-old', '旧轮输出', 'evt-old', 100);

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: `/sessions/${SESSION_ID}?messages=0`,
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      const session = (response.json() as SessionDetailBody).session;
      expect(session.id).toBe(SESSION_ID);
      expect(session.title).toBe('详情轻读会话');
      expect(session.messages).toEqual([]);
      expect(session.runEvents).toEqual([]);
      expect(session.fileChangesSummary).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('messages=1 与无法识别的取值都按「包含消息」处理,不返回 400', async () => {
    seedMessage('user', '提问', 1);

    const app = await buildApp();
    try {
      for (const query of ['messages=1', 'messages=true', 'messages=weird']) {
        const response = await app.inject({
          method: 'GET',
          url: `/sessions/${SESSION_ID}?${query}`,
          headers: { authorization: bearer(app) },
        });
        expect(response.statusCode).toBe(200);
        expect((response.json() as SessionDetailBody).session.messages).toHaveLength(1);
      }
    } finally {
      await app.close();
    }
  });
});
