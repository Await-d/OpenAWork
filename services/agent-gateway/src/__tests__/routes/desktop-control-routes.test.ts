import Fastify, { type FastifyInstance } from 'fastify';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DesktopControlRoutesModule from '../../routes/desktop-control.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const desktopControlMocks = vi.hoisted(() => ({
  click: vi.fn(),
  hotkey: vi.fn(),
  key: vi.fn(),
  screenshot: vi.fn(),
  scroll: vi.fn(),
  status: vi.fn(),
  type: vi.fn(),
  wait: vi.fn(),
}));

vi.mock('../../tools/desktop-control.js', () => ({
  desktopControlManager: desktopControlMocks,
}));

let authPlugin: typeof AuthModule.default;
let desktopControlRoutes: typeof DesktopControlRoutesModule.desktopControlRoutes;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let seedDesktopControlUser: () => void;

const DESKTOP_CONTROL_USER_ID = 'u-desktop-control-route';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(desktopControlRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: DESKTOP_CONTROL_USER_ID, email: 'desktop-control@example.com' })}`;
}

beforeAll(async () => {
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  desktopControlRoutes = (await import('../../routes/desktop-control.js')).desktopControlRoutes;
  const db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  seedDesktopControlUser = () =>
    db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
      DESKTOP_CONTROL_USER_ID,
      'desktop-control@example.com',
    ]);
});

beforeEach(() => {
  seedDesktopControlUser();
  desktopControlMocks.status.mockReset();
  desktopControlMocks.screenshot.mockReset();
  desktopControlMocks.click.mockReset();
  desktopControlMocks.type.mockReset();
  desktopControlMocks.key.mockReset();
  desktopControlMocks.hotkey.mockReset();
  desktopControlMocks.scroll.mockReset();
  desktopControlMocks.wait.mockReset();

  desktopControlMocks.status.mockResolvedValue({ enabled: true });
  desktopControlMocks.screenshot.mockResolvedValue({ success: true, data: 'base64-image' });
  desktopControlMocks.click.mockResolvedValue({ success: true, x: 12, y: 34 });
  desktopControlMocks.type.mockResolvedValue({ success: true, mode: 'text', textLength: 2 });
  desktopControlMocks.key.mockResolvedValue({ success: true, mode: 'key', key: 'Enter' });
  desktopControlMocks.hotkey.mockResolvedValue({ success: true, mode: 'hotkey' });
  desktopControlMocks.scroll.mockResolvedValue({ success: true, scrollX: 0, scrollY: -600 });
  desktopControlMocks.wait.mockResolvedValue({ success: true, ms: 250 });
});

describe('desktop control routes', () => {
  it('GET /desktop-control/status 未登录时返回 401', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/desktop-control/status',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('GET /desktop-control/status 返回系统桌面控制状态', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/desktop-control/status',
      headers: { authorization: bearer(app) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true });
    await app.close();
  });

  it('POST /desktop-control/click 会把坐标和默认参数转给 manager', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-control/click',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { x: 12, y: 34 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { success: true, x: 12, y: 34 } });
    expect(desktopControlMocks.click).toHaveBeenCalledWith({
      action: 'click',
      x: 12,
      y: 34,
      button: 'left',
      clickAction: 'click',
    });
    await app.close();
  });

  it('POST /desktop-control/hotkey 会把组合键传给 manager', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-control/hotkey',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { keys: ['Control', 'K'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ result: { success: true, mode: 'hotkey' } });
    expect(desktopControlMocks.hotkey).toHaveBeenCalledWith({
      action: 'hotkey',
      keys: ['Control', 'K'],
    });
    await app.close();
  });

  it('POST /desktop-control/screenshot 在 disabled runtime 时返回 503 + 结构化错误', async () => {
    desktopControlMocks.screenshot.mockRejectedValueOnce(
      new Error('desktop control is disabled in this runtime'),
    );

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-control/screenshot',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: {},
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: '当前运行环境未启用系统桌面控制。',
      code: 'desktop_control_disabled',
    });
    await app.close();
  });

  it('POST /desktop-control/click 在本机驱动缺失时返回 503 + unavailable code', async () => {
    desktopControlMocks.click.mockRejectedValueOnce(new Error('xdotool not found'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/desktop-control/click',
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { x: 12, y: 34 },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: 'xdotool not found',
      code: 'desktop_control_unavailable',
    });
    await app.close();
  });
});
