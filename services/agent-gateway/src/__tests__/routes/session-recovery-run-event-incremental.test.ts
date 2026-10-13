/**
 * `GET /sessions/:sessionId/recovery` 的 run event 增量续读（`runEventAfterSeq`）。
 *
 * 背景：chat 页在「远端运行中」（本标签页没接管流）时以 1s 轮询 `/recovery`
 * （`REMOTE_STREAM_RECOVERY_POLL_MS`，带 `messageLimit` 但**不带** `runEventLimit`，
 * 因为 `recoverActiveAssistantStream` / `buildChatRightPanelStateFromRunEvents` 是
 * 累加 reduce，依赖完整序列）。而活跃 scope 的行数随这一轮 run 只增不减：每次轮询都要
 * 把这轮已产生的全部 delta 读出、逐行 JSON.parse、再整包回传，单拍成本是
 * O(本轮已产生事件数) 且全程同步阻塞单线程 SQLite 的事件循环。
 *
 * 继 `runEventLimit`（尾部窗口，只服务「只看最近若干条」的消费者）之后的第二条通道：
 * 调用方已持有前缀，只取增量。这里钉死三条不变量：
 *  1. 增量结果与「全量的对应后缀」逐条一致 —— 否则客户端的累加重建会出现缺口；
 *  2. `runEventCursor` 是本次**实际交付**的最大 seq（不是服务端高水位），客户端据此推进；
 *  3. 缺省 / 非法值 / 空闲会话全部退回全量语义，不改变任何既有调用方的行为。
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

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-recovery-incremental-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-recovery-incremental-data-'));
const SESSION_ID = 'sess-recovery-incremental';
const USER_ID = 'u-recovery-incremental';
const ACTIVE_REQUEST_ID = 'req-active';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'recovery-incremental-test-secret-1234567890';
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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'recovery-incremental@example.com' })}`;
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
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'recovery-incremental@example.com', 'x')",
    [USER_ID],
  );
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '增量续读会话', '{}', 'idle')`,
    [SESSION_ID, USER_ID],
  );
});

interface RecoveryBody {
  recovery: {
    runEventCursor: number | null;
    session: {
      id: string;
      runEvents: Array<{ delta?: string; eventId?: string; type: string }>;
    };
  };
}

/** 建一个 running 会话：活跃线程 + N 条 delta（走同步落库路径，seq 从 1 开始递增）。 */
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

describe('GET /sessions/:sessionId/recovery — runEventAfterSeq', () => {
  it('不带 runEventAfterSeq 时仍是全量，且 runEventCursor 为 null（非增量模式语义未定义）', async () => {
    seedActiveStreamWithDeltas(5);

    const body = await getRecovery('?messageLimit=10');

    expect(body.recovery.session.runEvents).toHaveLength(5);
    expect(body.recovery.runEventCursor).toBeNull();
  });

  it('带游标时只回该 seq 之后的事件，并把实际交付的最大 seq 回给客户端', async () => {
    seedActiveStreamWithDeltas(5);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=2');

    expect(body.recovery.session.runEvents.map((event) => event.delta)).toEqual([
      '片段2',
      '片段3',
      '片段4',
    ]);
    expect(body.recovery.runEventCursor).toBe(5);
  });

  it('增量结果与全量的对应后缀逐条一致（前缀 + 增量 = 全量）', async () => {
    seedActiveStreamWithDeltas(7);

    const full = await getRecovery('?messageLimit=10');
    const increment = await getRecovery('?messageLimit=10&runEventAfterSeq=3');
    const prefix = full.recovery.session.runEvents.slice(0, 3);

    expect([...prefix, ...increment.recovery.session.runEvents]).toEqual(
      full.recovery.session.runEvents,
    );
  });

  it('游标已是最新时回空数组且 runEventCursor 为 null（客户端保持原游标）', async () => {
    seedActiveStreamWithDeltas(4);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=4');

    expect(body.recovery.session.runEvents).toEqual([]);
    expect(body.recovery.runEventCursor).toBeNull();
  });

  it('游标超过实际行数时回空数组，不报错', async () => {
    seedActiveStreamWithDeltas(3);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=999');

    expect(body.recovery.session.runEvents).toEqual([]);
    expect(body.recovery.runEventCursor).toBeNull();
  });

  it('runEventAfterSeq=0 与全量等价（首拍冷启动仍可走增量参数）', async () => {
    seedActiveStreamWithDeltas(4);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=0');

    expect(body.recovery.session.runEvents).toHaveLength(4);
    expect(body.recovery.runEventCursor).toBe(4);
  });

  it('同时给出 runEventAfterSeq 与 runEventLimit 时以增量优先（尾部截断会破坏拼接）', async () => {
    seedActiveStreamWithDeltas(5);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=1&runEventLimit=1');

    expect(body.recovery.session.runEvents.map((event) => event.delta)).toEqual([
      '片段1',
      '片段2',
      '片段3',
      '片段4',
    ]);
    expect(body.recovery.runEventCursor).toBe(5);
  });

  it('非法 runEventAfterSeq 被忽略，退回全量而非报错', async () => {
    seedActiveStreamWithDeltas(3);

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=abc');

    expect(body.recovery.session.runEvents).toHaveLength(3);
    expect(body.recovery.runEventCursor).toBeNull();
  });

  it('空闲会话（无活跃线程）回空数组且游标为 null：客户端据此清空缓冲', async () => {
    seedActiveStreamWithDeltas(3);
    dbModule.sqliteRun('DELETE FROM session_runtime_threads');

    const body = await getRecovery('?messageLimit=10&runEventAfterSeq=1');

    expect(body.recovery.session.runEvents).toEqual([]);
    expect(body.recovery.runEventCursor).toBeNull();
  });
});
