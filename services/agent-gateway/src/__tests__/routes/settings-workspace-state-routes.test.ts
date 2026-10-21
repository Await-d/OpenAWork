/**
 * 工作台现场快照路由（GET/PUT `/settings/workspace-state`）。
 *
 * 覆盖：写入后回读一致、无记录返回 `null`、脏数据 / 超限被拒、认证契约。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';
import { USER_WORKSPACE_STATE_KEY } from '../../user/user-workspace-state.js';

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
process.env['JWT_SECRET'] = 'settings-workspace-state-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-workspace-state';

const SAMPLE_STATE = {
  version: 1,
  uiStateVersion: 28,
  uiState: {
    browserPreviewUrlByWorkspace: { '/w/a': 'http://localhost:5173' },
    openFilePathsByWorkspace: { '/w/a': ['/w/a/src/index.ts'] },
    activeFilePathByWorkspace: { '/w/a': '/w/a/src/index.ts' },
    editorPaneTabByWorkspace: { '/w/a': 'browser' },
    leftSidebarOpen: false,
    sidebarPanelWidth: 320,
    rightOpen: true,
    rightTab: 'overview',
    tabs: [
      {
        id: 'tab-session',
        type: 'session',
        sessionId: 's-1',
        title: '会话',
        createdAt: 1,
      },
    ],
    activeTabId: 'tab-session',
  },
  bookmarks: [
    {
      id: 'bm-1',
      url: 'https://example.test/docs',
      title: '文档',
      createdAt: 2,
    },
  ],
  browserTabsByWorkspace: {
    '/w/a': {
      tabs: [
        {
          id: 'tab-1',
          url: 'https://example.test/app',
          title: 'App',
          history: ['https://example.test/app'],
          historyIndex: 0,
        },
      ],
      activeTabId: 'tab-1',
    },
  },
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

describe('settings workspace-state routes', () => {
  it('PUT 后 GET 回读一致（UI 现场 / 书签 / 按工作区标签）', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);
      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/workspace-state',
        headers: { authorization },
        payload: SAMPLE_STATE,
      });
      expect(putResponse.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/workspace-state',
        headers: { authorization },
      });
      expect(getResponse.statusCode).toBe(200);

      const body = getResponse.json() as {
        state: typeof SAMPLE_STATE;
        updatedAt: string;
      };
      expect(body.state.uiState).toEqual(SAMPLE_STATE.uiState);
      expect(body.state.bookmarks).toEqual(SAMPLE_STATE.bookmarks);
      expect(body.state.browserTabsByWorkspace['/w/a']?.activeTabId).toBe('tab-1');
      expect(body.state.browserTabsByWorkspace['/w/a']?.tabs[0]?.url).toBe(
        'https://example.test/app',
      );
      expect(typeof body.updatedAt).toBe('string');

      // 落库键名固定：后续清理 / 迁移都按它寻址。
      const row = dbModule.sqliteGet<{ value: string }>(
        'SELECT value FROM user_settings WHERE user_id = ? AND key = ?',
        [USER_ID, USER_WORKSPACE_STATE_KEY],
      );
      expect(row).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it('无记录时返回 null（客户端据此以本地为种子）', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/workspace-state',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ state: null });
    } finally {
      await app.close();
    }
  });

  it('形状不合法时拒绝（缺 uiState / 标签页字段类型错误）', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);

      const missingUiState = await app.inject({
        method: 'PUT',
        url: '/settings/workspace-state',
        headers: { authorization },
        payload: { ...SAMPLE_STATE, uiState: undefined },
      });
      expect(missingUiState.statusCode).toBeGreaterThanOrEqual(400);
      expect(missingUiState.statusCode).toBeLessThan(500);

      const badTab = await app.inject({
        method: 'PUT',
        url: '/settings/workspace-state',
        headers: { authorization },
        payload: {
          ...SAMPLE_STATE,
          browserTabsByWorkspace: { '/w/a': { tabs: [{ id: 'x' }], activeTabId: 'x' } },
        },
      });
      expect(badTab.statusCode).toBeGreaterThanOrEqual(400);
      expect(badTab.statusCode).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });

  it('超过 512 KiB 的快照被拒绝', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/workspace-state',
        headers: { authorization: bearer(app) },
        payload: {
          ...SAMPLE_STATE,
          uiState: { ...SAMPLE_STATE.uiState, padding: 'x'.repeat(600_000) },
        },
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });

  it('未认证请求返回 401', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PUT',
        url: '/settings/workspace-state',
        payload: SAMPLE_STATE,
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
