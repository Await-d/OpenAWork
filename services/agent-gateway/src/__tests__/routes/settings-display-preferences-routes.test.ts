/**
 * 显示偏好路由（GET/PUT /settings/display-preferences）：
 * 覆盖全量回读、部分字段合并、缺行/损坏行容错、认证与校验错误契约、
 * 未知字段剥离（保证写入 `user_display_preferences_v1` 行的内容可控）。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';

vi.mock('../../mcp/mcp-runtime.js', () => ({
  isMcpServerConnectedForUser: vi.fn(() => false),
  loadConfiguredMcpServersForUser: vi.fn(() => []),
  retryMcpConnectionForUser: vi.fn(),
}));

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: vi.fn(async () => null),
  resolveAuxiliaryLlmConfigCandidates: vi.fn(async () => []),
}));

vi.mock('../../routes/workflow-llm.js', () => ({
  requestWorkflowLlmCompletion: vi.fn(),
}));

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'settings-display-preferences-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-display-preferences';

const FULL_PAYLOAD = {
  showMessageTimestamps: true,
  showProviderLabel: false,
  showModelName: true,
  showDuration: true,
  showStopReason: false,
  showTokenBreakdown: true,
  showEstimatedTokens: true,
  showRequestIndex: false,
  showToolCount: true,
  showMetaLine: true,
  messageLayout: 'split',
  showReasoningBlock: true,
  reasoningExpandedByDefault: true,
  toolCallsExpandedByDefault: false,
  toolExpandedOverrides: {
    bash: false,
    fileEdit: true,
    fileRead: false,
    mcp: true,
    skill: false,
    web: false,
    batch: false,
    other: true,
  },
  defaultDialogueMode: 'programmer',
  showComposerStatsBar: false,
  showVoiceInputButton: true,
  showCommandPaletteButton: true,
  showGatewayStatusIndicator: false,
  showTerminalButton: true,
  themeMode: 'dark',
  themeStyle: 'ocean',
  fileIconTheme: 'minimal',
  workbenchLayoutMode: 'classic',
} as const;

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
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` })}`;
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
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('settings display-preferences routes', () => {
  it('PUT 全量后 GET 回读一致', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);

      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/display-preferences',
        headers: { authorization },
        payload: FULL_PAYLOAD,
      });

      expect(putResponse.statusCode).toBe(200);
      const putBody = putResponse.json() as {
        preferences: Record<string, unknown>;
        updatedAt: string;
      };
      expect(putBody.preferences).toMatchObject(FULL_PAYLOAD);
      expect(typeof putBody.updatedAt).toBe('string');

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/display-preferences',
        headers: { authorization },
      });

      expect(getResponse.statusCode).toBe(200);
      const getBody = getResponse.json() as {
        preferences: Record<string, unknown>;
        updatedAt: string;
      };
      expect(getBody.preferences).toEqual(FULL_PAYLOAD);
      expect(getBody.updatedAt).toBe(putBody.updatedAt);
    } finally {
      await app.close();
    }
  });

  it('PUT 部分字段与已存字段合并（未提交字段保留）', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);

      await app.inject({
        method: 'PUT',
        url: '/settings/display-preferences',
        headers: { authorization },
        payload: { themeMode: 'dark', messageLayout: 'split' },
      });

      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/display-preferences',
        headers: { authorization },
        payload: { themeStyle: 'ocean' },
      });

      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.json()).toMatchObject({
        preferences: { themeMode: 'dark', messageLayout: 'split', themeStyle: 'ocean' },
      });

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/display-preferences',
        headers: { authorization },
      });
      expect(getResponse.json()).toMatchObject({
        preferences: { themeMode: 'dark', messageLayout: 'split', themeStyle: 'ocean' },
      });
    } finally {
      await app.close();
    }
  });

  it('无记录时 GET 返回 preferences: null', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/display-preferences',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ preferences: null, updatedAt: null });
    } finally {
      await app.close();
    }
  });

  it('存储行损坏时 GET 返回 200 且 preferences: null，不 500', async () => {
    dbModule.sqliteRun(
      `INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, 'user_display_preferences_v1', ?)`,
      [USER_ID, '{not valid json'],
    );

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/display-preferences',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ preferences: null, updatedAt: null });
    } finally {
      await app.close();
    }
  });

  it('无 token 时返回 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/display-preferences',
      });

      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('非法枚举值返回 400 BadRequest', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/display-preferences',
        headers: { authorization: bearer(app) },
        payload: { themeMode: 'neon' },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        name: 'BadRequest',
        data: { kind: 'Body' },
      });
    } finally {
      await app.close();
    }
  });

  it('未知字段被剥离，不落库', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);

      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/display-preferences',
        headers: { authorization },
        payload: { themeMode: 'light', unknownField: 'should-be-dropped' },
      });

      expect(putResponse.statusCode).toBe(200);
      expect(putResponse.json()).toMatchObject({ preferences: { themeMode: 'light' } });
      expect(
        (putResponse.json() as { preferences: Record<string, unknown> }).preferences,
      ).not.toHaveProperty('unknownField');

      const row = dbModule.sqliteGet<{ value: string }>(
        `SELECT value FROM user_settings WHERE user_id = ? AND key = 'user_display_preferences_v1'`,
        [USER_ID],
      );
      expect(row?.value ?? '').not.toContain('unknownField');
    } finally {
      await app.close();
    }
  });
});
