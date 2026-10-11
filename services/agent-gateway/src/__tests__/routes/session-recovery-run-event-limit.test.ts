/**
 * `GET /sessions/:sessionId/recovery` 的 run event 有界窗口（`runEventLimit`）。
 *
 * 背景：`/recovery` 在会话 `running` 期间被前端以 2.5s 周期轮询，而活跃 scope
 * （clientRequestId）的 run event 行数随这一轮 run 的时长**只增不减** —— retention
 * 只按 scope 保留最近 50 个，在飞 scope 永不清理，每个 delta chunk 一行。于是每次
 * 轮询都要把这轮 run 的全部行读出、逐行 JSON.parse、再整包回传，单次成本是
 * O(本轮已产生事件数)，且全程同步阻塞单线程 SQLite 的事件循环。
 *
 * `runEventLimit=N` 让「只看最近若干条」的调用方（团队会话的过程时间线预览，
 * `TeamRunEventsPreview` 合并文本事件后只取最后 8 条）把单次成本钉在常数级。
 * 不传该参数时保持全量语义 —— chat 页的 `recoverActiveAssistantStream` /
 * `buildChatRightPanelStateFromRunEvents` 是累加 reduce，依赖完整序列。
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
import type * as SessionRuntimeThreadStoreModule from '../../session/session-runtime-thread-store.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-recovery-run-events-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-recovery-run-events-data-'));
const SESSION_ID = 'sess-recovery-run-events';
const USER_ID = 'u-recovery-run-events';
const ACTIVE_REQUEST_ID = 'req-active';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'recovery-run-events-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;
let runEvents: typeof SessionRunEventsModule;
let threadStore: typeof SessionRuntimeThreadStoreModule;
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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'recovery-run-events@example.com' })}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  runEvents = await import('../../session/session-run-events.js');
  threadStore = await import('../../session/session-runtime-thread-store.js');
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
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'recovery-run-events@example.com', 'x')",
    [USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '恢复快照会话', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

interface RecoveryBody {
  recovery: {
    session: {
      id: string;
      runEvents: Array<{ delta?: string; eventId?: string; type: string }>;
    };
    totalTurnCount: number | null;
  };
}

/** 建一个 running 会话：活跃线程 + N 条 delta（走同步落库路径，便于断言顺序）。 */
function seedActiveStreamWithDeltas(count: number): void {
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: ACTIVE_REQUEST_ID,
    createdAt: 1,
    content: [{ type: 'text', text: '提问' }],
  });
  for (let index = 0; index < count; index += 1) {
    runEvents.persistSessionRunEventForRequest(
      SESSION_ID,
      {
        type: 'text_delta',
        delta: `片段${index}`,
        eventId: `evt-${index}`,
        runId: 'run-active',
        occurredAt: 1_000 + index,
      },
      { clientRequestId: ACTIVE_REQUEST_ID },
    );
  }
  threadStore.upsertSessionRuntimeThread({
    clientRequestId: ACTIVE_REQUEST_ID,
    heartbeatAtMs: Date.now(),
    sessionId: SESSION_ID,
    startedAtMs: Date.now(),
    userId: USER_ID,
  });
}

async function getRecovery(query: string): Promise<RecoveryBody> {
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/recovery${query}`,
      headers: { authorization: bearer(app) },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as RecoveryBody;
  } finally {
    await app.close();
  }
}

describe('GET /sessions/:sessionId/recovery — runEventLimit', () => {
  it('不传 runEventLimit 时回活跃 scope 的全量 run event（既有语义不变）', async () => {
    seedActiveStreamWithDeltas(5);

    const body = await getRecovery('?messageLimit=10');

    expect(body.recovery.session.runEvents).toHaveLength(5);
    expect(body.recovery.session.runEvents.map((event) => event.delta)).toEqual([
      '片段0',
      '片段1',
      '片段2',
      '片段3',
      '片段4',
    ]);
  });

  it('runEventLimit=N 只回尾部 N 条，且按 seq 升序返回', async () => {
    seedActiveStreamWithDeltas(5);

    const body = await getRecovery('?messageLimit=10&runEventLimit=2');

    expect(body.recovery.session.runEvents.map((event) => event.delta)).toEqual(['片段3', '片段4']);
  });

  it('runEventLimit 大于实际行数时返回全部', async () => {
    seedActiveStreamWithDeltas(3);

    const body = await getRecovery('?messageLimit=10&runEventLimit=500');

    expect(body.recovery.session.runEvents).toHaveLength(3);
  });

  it('runEventLimit 不影响同一响应里的转录窗口与 totalTurnCount', async () => {
    seedActiveStreamWithDeltas(5);

    const full = await getRecovery('?messageLimit=10');
    const capped = await getRecovery('?messageLimit=10&runEventLimit=1');

    expect(capped.recovery.totalTurnCount).toBe(full.recovery.totalTurnCount);
    expect(capped.recovery.session.id).toBe(SESSION_ID);
  });

  it('runEventLimit=0 视为未提供（保持全量，不返回空数组）', async () => {
    seedActiveStreamWithDeltas(3);

    const body = await getRecovery('?messageLimit=10&runEventLimit=0');

    expect(body.recovery.session.runEvents).toHaveLength(3);
  });

  it('非法 runEventLimit 值被忽略，退回全量而非报错', async () => {
    seedActiveStreamWithDeltas(3);

    const body = await getRecovery('?messageLimit=10&runEventLimit=abc');

    expect(body.recovery.session.runEvents).toHaveLength(3);
  });

  it('空闲会话（无活跃线程）不返回 run event', async () => {
    seedActiveStreamWithDeltas(3);
    dbModule.sqliteRun('DELETE FROM session_runtime_threads');

    const body = await getRecovery('?messageLimit=10&runEventLimit=2');

    expect(body.recovery.session.runEvents).toEqual([]);
  });
});
