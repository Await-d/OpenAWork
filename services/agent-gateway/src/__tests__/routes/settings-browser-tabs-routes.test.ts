/**
 * 内置浏览器标签路由（GET/PUT `/settings/browser-tabs`）。
 *
 * 覆盖：写入后回读一致、部分更新合并、无记录时返回 `null`（客户端据此保留本机缓存）、
 * 删除标签后不会「复活」、脏数据容错、认证与校验错误契约。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SettingsRoutesModule from '../../routes/settings.js';
import { BROWSER_TABS_MAX_TABS, USER_BROWSER_TABS_KEY } from '../../user/user-browser-tabs.js';

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
process.env['JWT_SECRET'] = 'settings-browser-tabs-test-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let settingsRoutes: typeof SettingsRoutesModule.settingsRoutes;

const USER_ID = 'u-browser-tabs';

const SAMPLE_TABS = {
  tabs: [
    {
      id: 'tab-1',
      url: 'https://example.test/app',
      title: 'App',
      faviconUrl: 'https://example.test/favicon.ico',
      history: ['https://example.test/', 'https://example.test/app'],
      historyIndex: 1,
    },
    {
      id: 'tab-2',
      url: 'http://localhost:5173/',
      history: ['http://localhost:5173/'],
      historyIndex: 0,
    },
  ],
  activeTabId: 'tab-1',
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

describe('settings browser-tabs routes', () => {
  it('PUT 后 GET 回读一致（含历史与图标）', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);

      const putResponse = await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization },
        payload: SAMPLE_TABS,
      });
      expect(putResponse.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/settings/browser-tabs',
        headers: { authorization },
      });
      expect(getResponse.statusCode).toBe(200);

      const body = getResponse.json() as {
        tabs: { tabs: typeof SAMPLE_TABS.tabs; activeTabId: string };
        updatedAt: string;
      };
      expect(body.tabs.tabs).toHaveLength(2);
      expect(body.tabs.tabs[0]?.url).toBe('https://example.test/app');
      expect(body.tabs.tabs[0]?.faviconUrl).toBe('https://example.test/favicon.ico');
      expect(body.tabs.tabs[0]?.history).toEqual([
        'https://example.test/',
        'https://example.test/app',
      ]);
      expect(body.tabs.activeTabId).toBe('tab-1');
      expect(typeof body.updatedAt).toBe('string');
    } finally {
      await app.close();
    }
  });

  /**
   * 无记录时必须返回 `null`，不能返回空数组：客户端据此判断「远端还没有数据」，
   * 从而保留本机缓存并把它推上去初始化。返回空数组会让客户端清空本机标签。
   */
  it('无记录时 tabs 为 null', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/settings/browser-tabs',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json() as { tabs: unknown; updatedAt: unknown };
      expect(body.tabs).toBeNull();
      expect(body.updatedAt).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('只提交 activeTabId 时不会清掉已存的 tabs', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);
      await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization },
        payload: SAMPLE_TABS,
      });

      await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization },
        payload: { activeTabId: 'tab-2' },
      });

      const body = (
        await app.inject({
          method: 'GET',
          url: '/settings/browser-tabs',
          headers: { authorization },
        })
      ).json() as { tabs: { tabs: typeof SAMPLE_TABS.tabs; activeTabId: string } };

      expect(body.tabs.tabs).toHaveLength(2);
      expect(body.tabs.activeTabId).toBe('tab-2');
    } finally {
      await app.close();
    }
  });

  /**
   * `tabs` 是整体替换而非按下标合并：用户关掉标签后，旧项不能又留下来
   * （那会让「关掉的标签自己回来」）。
   */
  it('提交更少的标签时按整体替换处理', async () => {
    const app = await buildApp();
    try {
      const authorization = bearer(app);
      await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization },
        payload: SAMPLE_TABS,
      });

      await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization },
        payload: { tabs: [SAMPLE_TABS.tabs[1]] },
      });

      const body = (
        await app.inject({
          method: 'GET',
          url: '/settings/browser-tabs',
          headers: { authorization },
        })
      ).json() as { tabs: { tabs: typeof SAMPLE_TABS.tabs } };

      expect(body.tabs.tabs).toHaveLength(1);
      expect(body.tabs.tabs[0]?.url).toBe('http://localhost:5173/');
    } finally {
      await app.close();
    }
  });

  it('损坏的存储行按「无记录」处理，不抛 500', async () => {
    const app = await buildApp();
    try {
      dbModule.sqliteRun(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`, [
        USER_ID,
        USER_BROWSER_TABS_KEY,
        '{ not json',
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/settings/browser-tabs',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect((response.json() as { tabs: unknown }).tabs).toBeNull();
    } finally {
      await app.close();
    }
  });

  it('拒绝超过上限的标签数量（校验错误）', async () => {
    const app = await buildApp();
    try {
      const tooMany = Array.from({ length: BROWSER_TABS_MAX_TABS + 1 }, (_unused, index) => ({
        id: `tab-${index}`,
        url: `https://example.test/${index}`,
        history: [`https://example.test/${index}`],
        historyIndex: 0,
      }));

      const response = await app.inject({
        method: 'PUT',
        url: '/settings/browser-tabs',
        headers: { authorization: bearer(app) },
        payload: { tabs: tooMany, activeTabId: 'tab-0' },
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.statusCode).toBeLessThan(500);
    } finally {
      await app.close();
    }
  });

  it('未认证时拒绝访问', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/settings/browser-tabs' });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
