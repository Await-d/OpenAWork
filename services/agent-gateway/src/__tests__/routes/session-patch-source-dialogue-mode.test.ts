/**
 * 来源托管会话（渠道 / 定时任务）的 `dialogueMode` 字段级拒写。
 *
 * 背景：网页端复用同一个 ChatPage 打开渠道会话，其顶栏曾渲染出可写的「澄清 / 编程 /
 * 程序员」切换器（渠道会话 metadata 从不写 `dialogueMode`，读取即回退到默认值）。
 * 该切换器是**可写的**：`buildSessionMetadata` 永远带上 `dialogueMode`，于是在渠道
 * 会话里改任意设置都会把界面上的默认模式落库；一旦落成 `clarify`，网关的澄清只读
 * 白名单（`clarify-mode-tool-policy`，不含任何渠道回复工具）就会把该会话在渠道侧的
 * 全部回复能力收敛掉 —— 表现为「渠道里再也回不了消息」。
 *
 * 前端已不再渲染该切换器且不再写该键；这里锁定网关侧的第二道防线：PATCH 收到该键时
 * **剥掉它**（而不是整条请求 400），其余字段照常生效。
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-patch-source-ws-'));
const dataDir = mkdtempSync(join(tmpdir(), 'openawork-patch-source-data-'));
const CHANNEL_SESSION_ID = 'sess-channel';
const CRON_SESSION_ID = 'sess-cron';
const PLAIN_SESSION_ID = 'sess-plain';
const USER_ID = 'u-patch-source';

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'patch-source-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['OPENAWORK_DATA_DIR'] = dataDir;
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

let dbModule: typeof DbModule;
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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'patch-source@example.com' })}`;
}

function seedSession(sessionId: string, metadata: Record<string, unknown>): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, '来源会话', ?, 'idle')`,
    [sessionId, USER_ID, JSON.stringify(metadata)],
  );
}

function readMetadata(sessionId: string): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ metadata_json: string }>(
    'SELECT metadata_json FROM sessions WHERE id = ?',
    [sessionId],
  );
  return JSON.parse(row?.metadata_json ?? '{}') as Record<string, unknown>;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
});

beforeEach(() => {
  vi.restoreAllMocks();
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  dbModule.sqliteRun(
    "INSERT INTO users (id, email, password_hash) VALUES (?, 'patch-source@example.com', 'x')",
    [USER_ID],
  );
  seedSession(CHANNEL_SESSION_ID, {
    source: 'channel',
    channelChatId: 'chat-1',
    channel: { id: 'plugin-1', type: 'feishu', name: '飞书研发群' },
  });
  seedSession(CRON_SESSION_ID, { source: 'cron', cronJobId: 'job-1' });
  seedSession(PLAIN_SESSION_ID, { dialogueMode: 'coding' });
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

describe('PATCH /sessions/:sessionId — 来源会话拒写 dialogueMode', () => {
  it('渠道会话来带 dialogueMode 时该键被剥掉，其余字段照常写入', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${CHANNEL_SESSION_ID}`,
        headers: { authorization: bearer(app) },
        payload: { metadata: { dialogueMode: 'clarify', permissionMode: 'yolo' } },
      });

      expect(response.statusCode).toBe(200);
      const stored = readMetadata(CHANNEL_SESSION_ID);
      // 关键回归：clarify 一旦落库，渠道回复工具会被只读白名单整套过滤掉。
      expect(stored['dialogueMode']).toBeUndefined();
      // 字段级拒写（而非整条 400）：同批次的其它字段必须照常生效。
      expect(stored['permissionMode']).toBe('yolo');
      expect(stored['yoloMode']).toBe(true);
      // 来源字段本身不被改写。
      expect(stored['source']).toBe('channel');
    } finally {
      await app.close();
    }
  });

  it('定时任务会话同样拒写 dialogueMode', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${CRON_SESSION_ID}`,
        headers: { authorization: bearer(app) },
        payload: { metadata: { dialogueMode: 'programmer' } },
      });

      expect(response.statusCode).toBe(200);
      expect(readMetadata(CRON_SESSION_ID)['dialogueMode']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('客户端不得自封为来源会话：PATCH 带 source 键被 schema 拒绝', async () => {
    // 本模块的整套豁免都建立在「source 只能由服务端写」之上：若客户端能把普通会话标成
    // `channel`，就能**反向**骗取澄清只读豁免（提权）。`sessionMetadataPatchSchema` 是
    // `.strict()` 且不含 source 键，这里把该不变量钉住。
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${PLAIN_SESSION_ID}`,
        headers: { authorization: bearer(app) },
        payload: { metadata: { source: 'channel', permissionMode: 'yolo' } },
      });

      expect(response.statusCode).toBe(400);
      // 整条 patch 被拒（不是静默剥键）：不能只看状态码，必须确认库里没被改写。
      expect(readMetadata(PLAIN_SESSION_ID)).toEqual({ dialogueMode: 'coding' });
    } finally {
      await app.close();
    }
  });

  it('普通会话不受影响：dialogueMode 照常写入', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: `/sessions/${PLAIN_SESSION_ID}`,
        headers: { authorization: bearer(app) },
        payload: { metadata: { dialogueMode: 'clarify' } },
      });

      expect(response.statusCode).toBe(200);
      expect(readMetadata(PLAIN_SESSION_ID)['dialogueMode']).toBe('clarify');
    } finally {
      await app.close();
    }
  });
});
