/**
 * `/settings/channel-troubleshooting` 路由测试。
 *
 * 重点验证**归属隔离**：这是排障接口，最危险的缺陷是把 A 用户的频道故障
 * 暴露给 B 用户。所以除常规读写外，额外覆盖「无归属记录不可见」与
 * 「清空只影响自己」两条边界。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import {
  persistChannelInboundDiagnostic,
  recordChannelHealthIssue,
} from '../../channels/channel-error-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'channel-troubleshooting-test-secret-1234';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-channel-troubleshooting';
const OTHER_USER_ID = 'u-channel-troubleshooting-other';

interface ChannelTroubleshootingResponse {
  channels: Array<{
    channelId: string;
    lastError: string | null;
    lastErrorChannelType: string | null;
    lastErrorSource: string | null;
  }>;
  auditLogs: Array<{
    id: number;
    channelId: string | null;
    message: string;
    source: string | null;
    createdAt: string;
  }>;
}

interface ClearResponse {
  clearedAuditRows: number;
  clearedHealthRows: number;
  ok: boolean;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  return `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

/** 建一个属于 `userId` 的会话，用于让审计行可按会话归属被检索到。 */
function seedSession(userId: string, title: string): string {
  const sessionId = `sess-${userId}-${title}`;
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json)
     VALUES (?, ?, ?, '[]', 'idle', '{}')`,
    [sessionId, userId, title],
  );
  return sessionId;
}

/** 写入一条频道错误审计行；`sessionId` 决定它能否按用户归属被检索到。 */
function seedChannelAuditLog(input: {
  channelId: string;
  message: string;
  sessionId: string | null;
  source: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO audit_logs (session_id, tool_name, request_id, input_json, output_json, is_error)
     VALUES (?, 'channel:CHANNEL_RUN_FAILED', 'req-seed', ?, ?, 1)`,
    [
      input.sessionId,
      JSON.stringify({ channelId: input.channelId, source: input.source }),
      JSON.stringify({
        message: input.message,
        code: 'CHANNEL_RUN_FAILED',
        channelId: input.channelId,
        source: input.source,
      }),
    ],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM audit_logs', []);
  dbModule.sqliteRun('DELETE FROM channel_health', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser(USER_ID);
  seedUser(OTHER_USER_ID);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /settings/channel-troubleshooting', () => {
  it('Given a channel fault Then it returns the persisted health snapshot and error trail', async () => {
    recordChannelHealthIssue({
      channelId: 'ch-telegram-1',
      channelType: 'telegram',
      message: '频道服务启动失败：invalid token',
      ownerUserId: USER_ID,
      source: 'channel_start',
      status: 'error',
    });
    const sessionId = seedSession(USER_ID, 'channel:ch-telegram-1:chat:c1');
    seedChannelAuditLog({
      channelId: 'ch-telegram-1',
      message: '会话已有其他请求运行中',
      sessionId,
      source: 'channel_run',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const payload = response.json() as ChannelTroubleshootingResponse;
      expect(payload.channels).toHaveLength(1);
      expect(payload.channels[0]?.lastError).toContain('invalid token');
      expect(payload.channels[0]?.lastErrorChannelType).toBe('telegram');
      expect(payload.auditLogs).toHaveLength(1);
      // `channelId` / `source` 必须能从 output_json 还原 —— 排障页靠它们分组。
      expect(payload.auditLogs[0]?.channelId).toBe('ch-telegram-1');
      expect(payload.auditLogs[0]?.source).toBe('channel_run');
      // 时间必须是带时区的 ISO UTC：SQLite 裸串（`2026-10-13 14:20:03`）会被前端
      // 当本地时间解析，排障时「错误何时发生」会偏掉时区差。
      expect(payload.auditLogs[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    } finally {
      await app.close();
    }
  });

  it('Given faults belonging to another user Then they are invisible', async () => {
    recordChannelHealthIssue({
      channelId: 'ch-other-user',
      channelType: 'discord',
      message: '别让 A 用户看到这条',
      ownerUserId: OTHER_USER_ID,
      source: 'channel_start',
    });
    const otherSession = seedSession(OTHER_USER_ID, 'channel:ch-other-user:chat:c9');
    seedChannelAuditLog({
      channelId: 'ch-other-user',
      message: '也别让 A 用户看到这条审计',
      sessionId: otherSession,
      source: 'channel_run',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app, USER_ID) },
      });

      const payload = response.json() as ChannelTroubleshootingResponse;
      expect(payload.channels).toHaveLength(0);
      expect(payload.auditLogs).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('Given an unowned channel fault Then it is not attributed to any user', async () => {
    // 兜底路径写入的记录拿不到 ownerUserId（pluginId 甚至可能是 'unknown'）。
    // 它不能出现在任何用户的排障列表里，否则就是信息泄露。
    recordChannelHealthIssue({
      channelId: 'unknown',
      message: '归属不明的兜底故障',
      source: 'channel_dispatch',
    });

    const app = await buildApp();
    try {
      for (const userId of [USER_ID, OTHER_USER_ID]) {
        const response = await app.inject({
          method: 'GET',
          url: '/settings/channel-troubleshooting',
          headers: { authorization: bearer(app, userId) },
        });
        const payload = response.json() as ChannelTroubleshootingResponse;
        expect(payload.channels).toHaveLength(0);
      }
    } finally {
      await app.close();
    }
  });

  it('Given an unauthenticated request Then it is rejected', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});

describe('DELETE /settings/channel-troubleshooting', () => {
  it('Given a mixed set of faults Then clearing only removes the caller own records', async () => {
    recordChannelHealthIssue({
      channelId: 'ch-mine',
      message: '我的故障',
      ownerUserId: USER_ID,
      source: 'channel_queue',
    });
    recordChannelHealthIssue({
      channelId: 'ch-theirs',
      message: '别人的故障',
      ownerUserId: OTHER_USER_ID,
      source: 'channel_queue',
    });
    const mySession = seedSession(USER_ID, 'channel:ch-mine:chat:c1');
    const theirSession = seedSession(OTHER_USER_ID, 'channel:ch-theirs:chat:c2');
    seedChannelAuditLog({
      channelId: 'ch-mine',
      message: '我的审计',
      sessionId: mySession,
      source: 'channel_run',
    });
    seedChannelAuditLog({
      channelId: 'ch-theirs',
      message: '别人的审计',
      sessionId: theirSession,
      source: 'channel_run',
    });

    const app = await buildApp();
    try {
      const cleared = await app.inject({
        method: 'DELETE',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app) },
      });
      expect(cleared.statusCode).toBe(200);
      expect((cleared.json() as ClearResponse).clearedHealthRows).toBe(1);
      expect((cleared.json() as ClearResponse).clearedAuditRows).toBe(1);

      const mine = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app) },
      });
      expect((mine.json() as ChannelTroubleshootingResponse).channels).toHaveLength(0);
      expect((mine.json() as ChannelTroubleshootingResponse).auditLogs).toHaveLength(0);

      // 别人的记录必须纹丝不动。
      const theirs = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app, OTHER_USER_ID) },
      });
      const theirsPayload = theirs.json() as ChannelTroubleshootingResponse;
      expect(theirsPayload.channels).toHaveLength(1);
      expect(theirsPayload.auditLogs).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});

describe('inbound diagnostics persistence', () => {
  it('Given accepted and rejected inbound traffic Then both are queryable after reload', async () => {
    persistChannelInboundDiagnostic({
      channelId: 'ch-inbound-1',
      accepted: true,
      chatId: 'chat-7',
      eventType: 'message',
      ownerUserId: USER_ID,
    });
    persistChannelInboundDiagnostic({
      channelId: 'ch-inbound-2',
      accepted: false,
      error: 'Invalid channel inbound secret',
      eventType: 'callback',
      ownerUserId: USER_ID,
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/channel-troubleshooting',
        headers: { authorization: bearer(app) },
      });
      const payload = response.json() as ChannelTroubleshootingResponse;
      expect(payload.channels).toHaveLength(2);
      // 成功的入站也必须留痕：排障要靠「收到过没有」对照，光记失败不够。
      const accepted = payload.channels.find((item) => item.channelId === 'ch-inbound-1');
      expect(accepted?.lastError).toBeNull();
    } finally {
      await app.close();
    }
  });
});
