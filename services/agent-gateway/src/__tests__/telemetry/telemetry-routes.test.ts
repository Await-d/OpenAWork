import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';
import type * as ZodModule from 'zod';
import { registerErrorHandler } from '../../infra/error-handler.js';
import {
  __resetTelemetryForTesting,
  __setTelemetrySinkForTesting,
} from '../../telemetry/telemetry-service.js';
import {
  migrateTelemetryDb,
  cleanupStaleDedupEntries,
  getAllDedupEntries,
  getDedupEntry,
  upsertDedupEntry,
} from '../../telemetry/telemetry-db.js';
import {
  __computeStackSignatureForTesting,
  __resetGitHubSyncRateLimitForTesting,
} from '../../telemetry/github-sync.js';
import { TELEMETRY_CONSENT_KEY } from '../../telemetry/telemetry-consent-store.js';

const mocks = vi.hoisted(() => ({
  retryMcpConnectionForUser: vi.fn(),
  resolveAuxiliaryLlmConfig: vi.fn(),
  requestWorkflowLlmCompletion: vi.fn(),
}));

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: vi.fn(() => false),
  loadConfiguredMcpServersForUser: vi.fn(() => []),
  retryMcpConnectionForUser: mocks.retryMcpConnectionForUser,
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: mocks.resolveAuxiliaryLlmConfig,
  resolveAuxiliaryLlmConfigCandidates: vi.fn(),
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: mocks.requestWorkflowLlmCompletion,
}));

vi.mock('../../workspace/companion-settings.js', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { z } = require('zod') as typeof ZodModule;
  return {
    buildCompanionFeatureState: vi.fn(() => ({ enabled: false })),
    buildCompanionIntroText: vi.fn(() => 'intro'),
    companionSettingsUpdateSchema: z.object({}).passthrough(),
    getCompanionSettingsKey: vi.fn(() => 'companion'),
    loadCompanionSettingsForUser: vi.fn(() => ({
      profile: {
        name: 'Buddy',
        species: 'fox',
        archetype: 'steady',
        note: '',
        traits: [],
      },
    })),
    resolveCompanionProfileForAgent: vi.fn(() => null),
  };
});

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'telemetry-routes-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-telemetry-test';

const trackedEvents: Array<{
  name: string;
  properties: Record<string, string | number | boolean>;
}> = [];

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(settingsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'telemetry@example.com' })}`;
}

function seedUser(id: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function setConsent(userId: string, status: 'accepted' | 'declined'): void {
  const value = JSON.stringify({ status, updatedAt: new Date().toISOString() });
  dbModule.sqliteRun(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [userId, TELEMETRY_CONSENT_KEY, value],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  migrateTelemetryDb();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  settingsRoutes = (await import('../../routes/settings.js')).settingsRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun('DELETE FROM telemetry_github_dedup', []);
  seedUser(USER_ID);
  trackedEvents.length = 0;
  __setTelemetrySinkForTesting({
    isEnabled: () => true,
    shutdown: async () => {},
    track: (name, properties) => {
      trackedEvents.push({ name, properties });
    },
    getInstallId: () => 'test-install-id',
  });
  mocks.retryMcpConnectionForUser.mockReset();
  mocks.resolveAuxiliaryLlmConfig.mockReset();
  mocks.requestWorkflowLlmCompletion.mockReset();
  __resetGitHubSyncRateLimitForTesting();
});

afterEach(() => {
  vi.clearAllMocks();
  __resetTelemetryForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

// ─── 路由测试 ────────────────────────────────────────────────────

describe('telemetry consent routes', () => {
  it('GET /settings/telemetry/consent 未设置时返回 status=null', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/telemetry/consent',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: null, updatedAt: null });
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/telemetry/consent accept 后持久化到 user_settings', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/telemetry/consent',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'accepted' }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, status: 'accepted' });

      // 验证持久化
      const row = dbModule.sqliteGet<{ value: string }>(
        'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
        [USER_ID, TELEMETRY_CONSENT_KEY],
      );
      expect(row).toBeDefined();
      expect(JSON.parse(row!.value)).toMatchObject({ status: 'accepted' });
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/telemetry/consent decline 后持久化到 user_settings', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/telemetry/consent',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'declined' }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, status: 'declined' });
    } finally {
      await app.close();
    }
  });

  it('PUT /settings/telemetry/consent 非法 status 返回 400', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/telemetry/consent',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: 'maybe' }),
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('GET /settings/telemetry/consent 已同意时返回 status=accepted', async () => {
    setConsent(USER_ID, 'accepted');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/telemetry/consent',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: 'accepted' });
    } finally {
      await app.close();
    }
  });
});

describe('telemetry event route', () => {
  it('POST /settings/telemetry/event 已同意时入队事件', async () => {
    setConsent(USER_ID, 'accepted');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/telemetry/event',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'session_created',
          properties: { source: 'test' },
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ ok: true });
      expect(trackedEvents).toHaveLength(1);
      expect(trackedEvents[0]).toMatchObject({
        name: 'session_created',
        properties: { source: 'test' },
      });
    } finally {
      await app.close();
    }
  });

  it('POST /settings/telemetry/event 未同意时返回 403', async () => {
    // 不设置 consent
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/telemetry/event',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'app_start',
          properties: {},
        }),
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: '遥测未授权。' });
      expect(trackedEvents).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('POST /settings/telemetry/event 已拒绝时返回 403', async () => {
    setConsent(USER_ID, 'declined');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/telemetry/event',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'app_start',
          properties: {},
        }),
      });

      expect(response.statusCode).toBe(403);
      expect(trackedEvents).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('POST /settings/telemetry/event 非法事件名返回 400', async () => {
    setConsent(USER_ID, 'accepted');
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/settings/telemetry/event',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          name: 'invalid_event',
          properties: {},
        }),
      });

      expect(response.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

// ─── 去重表测试 ──────────────────────────────────────────────────

describe('telemetry-github-dedup table', () => {
  it('upsertDedupEntry 首次插入新行', () => {
    upsertDedupEntry('sig-001');
    const row = getDedupEntry('sig-001');
    expect(row).toBeDefined();
    expect(row!.occurrence_count).toBe(1);
    expect(row!.issue_number).toBeNull();
  });

  it('upsertDedupEntry 重复时增加 occurrence_count', () => {
    upsertDedupEntry('sig-002');
    upsertDedupEntry('sig-002');
    upsertDedupEntry('sig-002');
    const row = getDedupEntry('sig-002');
    expect(row!.occurrence_count).toBe(3);
  });

  it('upsertDedupEntry 回填 issue_number', () => {
    upsertDedupEntry('sig-003');
    upsertDedupEntry('sig-003', 42);
    const row = getDedupEntry('sig-003');
    expect(row!.issue_number).toBe(42);
    expect(row!.occurrence_count).toBe(2);
  });

  it('cleanupStaleDedupEntries 清理旧记录', () => {
    upsertDedupEntry('stale-sig');
    // 手动修改 last_seen 为 60 天前
    dbModule.sqliteRun(
      `UPDATE telemetry_github_dedup SET last_seen = datetime('now', '-60 days') WHERE signature = ?`,
      ['stale-sig'],
    );
    cleanupStaleDedupEntries(30);
    expect(getDedupEntry('stale-sig')).toBeUndefined();
  });

  it('getAllDedupEntries 返回所有记录', () => {
    upsertDedupEntry('sig-a');
    upsertDedupEntry('sig-b');
    const all = getAllDedupEntries();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── GitHub 同步签名测试 ─────────────────────────────────────────

describe('github-sync stack signature', () => {
  it('相同堆栈产生相同签名', () => {
    const props1 = {
      errorName: 'TypeError',
      stack:
        'Error: x\n  at foo (a.ts:1)\n  at bar (b.ts:2)\n  at baz (c.ts:3)\n  at qux (d.ts:4)\n  at quux (e.ts:5)\n  at extra (f.ts:6)',
    };
    const props2 = {
      errorName: 'TypeError',
      stack:
        'Error: x\n  at foo (a.ts:1)\n  at bar (b.ts:2)\n  at baz (c.ts:3)\n  at qux (d.ts:4)\n  at quux (e.ts:5)\n  at different (g.ts:7)',
    };
    const sig1 = __computeStackSignatureForTesting(props1);
    const sig2 = __computeStackSignatureForTesting(props2);
    // 前 5 帧相同，签名应相同
    expect(sig1).toBe(sig2);
  });

  it('不同堆栈产生不同签名', () => {
    const sig1 = __computeStackSignatureForTesting({
      errorName: 'TypeError',
      stack: 'Error: x\n  at foo (a.ts:1)',
    });
    const sig2 = __computeStackSignatureForTesting({
      errorName: 'RangeError',
      stack: 'Error: y\n  at bar (b.ts:2)',
    });
    expect(sig1).not.toBe(sig2);
  });

  it('无堆栈时使用 errorName + message 作为 fallback 签名', () => {
    const sig = __computeStackSignatureForTesting({
      errorName: 'NetworkError',
      message: 'fetch failed',
    });
    expect(sig).toHaveLength(64); // SHA-256 hex
  });
});
