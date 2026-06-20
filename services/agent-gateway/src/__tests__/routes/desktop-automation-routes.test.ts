import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DesktopAutomationRoutesModule from '../../routes/desktop-automation.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const desktopAutomationMocks = vi.hoisted(() => ({
  click: vi.fn(),
  goto: vi.fn(),
  screenshot: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  type: vi.fn(),
}));

vi.mock('../../tools/desktop-automation.js', () => ({
  desktopAutomationManager: desktopAutomationMocks,
}));

let authPlugin: typeof AuthModule.default;
let desktopAutomationRoutes: typeof DesktopAutomationRoutesModule.desktopAutomationRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let seedDesktopUser: () => void;

const DESKTOP_USER_ID = 'u-desktop-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(desktopAutomationRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: DESKTOP_USER_ID, email: 'desktop@example.com' })}`;
}

beforeAll(async () => {
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  desktopAutomationRoutes = (await import('../../routes/desktop-automation.js'))
    .desktopAutomationRoutes;
  // requireAuth 现在校验 token.sub 是否存在于 users 表（孤儿令牌 → 401）。
  // 本测试用共享内存 DB，先确保连接；种用户放到 beforeEach 以抵御兄弟测试的
  // DELETE FROM users（共享 DB 无隔离）。
  const db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  seedDesktopUser = () =>
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      DESKTOP_USER_ID,
      'desktop@example.com',
    ]);
});

beforeEach(() => {
  seedDesktopUser();
  desktopAutomationMocks.status.mockReset();
  desktopAutomationMocks.start.mockReset();
  desktopAutomationMocks.goto.mockReset();
  desktopAutomationMocks.click.mockReset();
  desktopAutomationMocks.type.mockReset();
  desktopAutomationMocks.screenshot.mockReset();

  desktopAutomationMocks.status.mockResolvedValue({ enabled: true, started: false });
  desktopAutomationMocks.start.mockResolvedValue(undefined);
  desktopAutomationMocks.goto.mockResolvedValue(undefined);
  desktopAutomationMocks.click.mockResolvedValue(undefined);
  desktopAutomationMocks.type.mockResolvedValue(undefined);
  desktopAutomationMocks.screenshot.mockResolvedValue('base64-image');
});

describe('desktop automation routes', () => {
  it('GET /desktop-automation/status 返回 manager 状态', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/desktop-automation/status',
      headers: { authorization: bearer(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ enabled: true, started: false });
    await app.close();
  });

  it('POST /desktop-automation/start 在 disabled runtime 时返回 503 + 结构化错误', async () => {
    desktopAutomationMocks.start.mockRejectedValueOnce(
      new Error('desktop-only automation is disabled in this runtime'),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-automation/start',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: '当前运行环境未启用桌面自动化。',
      code: 'desktop_automation_disabled',
    });
    await app.close();
  });

  it('POST /desktop-automation/click 在未知异常时返回 500 + 原始消息', async () => {
    desktopAutomationMocks.click.mockRejectedValueOnce(new Error('selector not found'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-automation/click',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { selector: '#submit' },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: 'selector not found',
      code: 'desktop_automation_failed',
    });
    await app.close();
  });
});
