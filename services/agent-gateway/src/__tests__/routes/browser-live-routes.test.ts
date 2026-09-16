import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BrowserLiveA11yPayload,
  BrowserLiveDomPayload,
  BrowserLiveEnvelope,
  BrowserLiveHelloPayload,
  BrowserLiveNodePayload,
} from '@openAwork/shared';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as BrowserLiveRoutesModule from '../../routes/browser-live.js';
import type * as DesktopAutomationRoutesModule from '../../routes/desktop-automation.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-browser-live-route';
const DISABLED_MESSAGE = 'browser live view is disabled in this runtime';
const UNAVAILABLE_MESSAGE = 'browser live view is unavailable in this runtime';

const liveMocks = vi.hoisted(() => {
  let eventHandler: ((event: unknown) => void) | null = null;

  const session = {
    start: vi.fn(),
    isStarted: vi.fn(() => true),
    getEngine: vi.fn(() => 'chromium'),
    supportsScreencast: vi.fn(() => true),
    onEvent: vi.fn((handler: (event: unknown) => void) => {
      eventHandler = handler;
      return vi.fn();
    }),
    goto: vi.fn(),
    reload: vi.fn(),
    currentUrl: vi.fn(),
    currentTitle: vi.fn(),
    startScreencast: vi.fn(),
    ackScreencastFrame: vi.fn(),
    stopScreencast: vi.fn(),
    setDeviceMetricsOverride: vi.fn(),
    clearDeviceMetricsOverride: vi.fn(),
    setUserAgentOverride: vi.fn(),
    dispatchInput: vi.fn(),
    nodeAtPoint: vi.fn(),
    domTree: vi.fn(),
    accessibilitySnapshot: vi.fn(),
    screenshot: vi.fn(),
    close: vi.fn(),
  };

  return {
    session,
    handle: { id: 'h1', userId: 'u-browser-live-route', session },
    availability: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    handleFor: vi.fn(),
    close: vi.fn(),
    emitEvent: (event: unknown) => {
      eventHandler?.(event);
    },
  };
});

const desktopMocks = vi.hoisted(() => ({
  status: vi.fn(),
}));

vi.mock('../../browser-live/manager.js', () => ({
  BROWSER_LIVE_DISABLED_MESSAGE: DISABLED_MESSAGE,
  BROWSER_LIVE_UNAVAILABLE_MESSAGE: UNAVAILABLE_MESSAGE,
  browserLiveManager: {
    availability: liveMocks.availability,
    acquire: liveMocks.acquire,
    release: liveMocks.release,
    handleFor: liveMocks.handleFor,
    close: liveMocks.close,
  },
}));

vi.mock('../../tools/desktop-automation.js', () => ({
  desktopAutomationManager: desktopMocks,
}));

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let browserLiveRoutes: typeof BrowserLiveRoutesModule.browserLiveRoutes;
let classifyBrowserLiveError: typeof BrowserLiveRoutesModule.classifyBrowserLiveError;
let desktopAutomationRoutes: typeof DesktopAutomationRoutesModule.desktopAutomationRoutes;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(browserLiveRoutes);
  await app.register(desktopAutomationRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${token(app)}`;
}

function token(app: FastifyInstance): string {
  return app.jwt.sign({ sub: USER_ID, email: 'browser-live@example.com' });
}

function insertSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun(
    "INSERT OR REPLACE INTO sessions (id, user_id, messages_json, state_status, metadata_json) VALUES (?, ?, '[]', 'idle', '{}')",
    [sessionId, userId],
  );
}

interface TestWebSocket {
  send: (data: string) => void;
  terminate: () => void;
  on: (event: string, listener: (arg: unknown) => void) => void;
}

interface CapturedSocket {
  ws: TestWebSocket;
  nextMessage: <T = BrowserLiveEnvelope>() => Promise<T>;
  closed: Promise<{ code: number }>;
}

function assertIsTestWebSocket(value: unknown): asserts value is TestWebSocket {
  if (
    !value ||
    typeof value !== 'object' ||
    !('on' in value) ||
    typeof value.on !== 'function' ||
    !('send' in value) ||
    typeof value.send !== 'function' ||
    !('terminate' in value) ||
    typeof value.terminate !== 'function'
  ) {
    throw new Error('expected websocket test handle with on/send/terminate');
  }
}

async function openSocket(app: FastifyInstance, path: string): Promise<CapturedSocket> {
  const queued: unknown[] = [];
  const resolvers: Array<(value: unknown) => void> = [];
  let captured: TestWebSocket | null = null;
  let resolveClosed: (value: { code: number }) => void = () => undefined;
  const closed = new Promise<{ code: number }>((resolve) => {
    resolveClosed = resolve;
  });

  const ws = await app.injectWS(path, {}, {
    onInit: (clientWs: unknown) => {
      assertIsTestWebSocket(clientWs);
      captured = clientWs;
      captured.on('message', (data: unknown) => {
        const parsed = JSON.parse(String(data)) as unknown;
        const resolve = resolvers.shift();
        if (resolve) {
          resolve(parsed);
          return;
        }
        queued.push(parsed);
      });
      captured.on('close', (code: unknown) => {
        resolveClosed({ code: typeof code === 'number' ? code : 0 });
      });
    },
  } as never);

  assertIsTestWebSocket(ws);
  const target = captured ?? ws;

  return {
    ws: target,
    closed,
    nextMessage: async <T = BrowserLiveEnvelope>() => {
      const queuedMessage = queued.shift();
      if (queuedMessage !== undefined) {
        return queuedMessage as T;
      }
      return new Promise<T>((resolve) => {
        resolvers.push((value) => resolve(value as T));
      });
    },
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  browserLiveRoutes = (await import('../../routes/browser-live.js')).browserLiveRoutes;
  classifyBrowserLiveError = (await import('../../routes/browser-live.js')).classifyBrowserLiveError;
  desktopAutomationRoutes = (await import('../../routes/desktop-automation.js'))
    .desktopAutomationRoutes;
});

beforeEach(() => {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'browser-live@example.com',
  ]);

  liveMocks.availability.mockReset();
  liveMocks.acquire.mockReset();
  liveMocks.release.mockReset();
  liveMocks.handleFor.mockReset();
  liveMocks.close.mockReset();
  liveMocks.session.startScreencast.mockReset();
  liveMocks.session.ackScreencastFrame.mockReset();
  liveMocks.session.stopScreencast.mockReset();
  liveMocks.session.dispatchInput.mockReset();
  liveMocks.session.setDeviceMetricsOverride.mockReset();
  liveMocks.session.setUserAgentOverride.mockReset();
  liveMocks.session.goto.mockReset();
  liveMocks.session.reload.mockReset();
  liveMocks.session.screenshot.mockReset();
  liveMocks.session.nodeAtPoint.mockReset();
  liveMocks.session.domTree.mockReset();
  liveMocks.session.accessibilitySnapshot.mockReset();

  liveMocks.availability.mockResolvedValue({
    available: true,
    engine: 'chromium',
    screencast: true,
    source: 'managed',
    expectedRevision: '1208',
    executablePath: '/usr/bin/fake-chromium',
    installable: false,
  });
  liveMocks.acquire.mockResolvedValue(liveMocks.handle);
  liveMocks.handleFor.mockReturnValue(liveMocks.handle);
  liveMocks.session.startScreencast.mockResolvedValue(undefined);
  liveMocks.session.ackScreencastFrame.mockResolvedValue(undefined);
  liveMocks.session.stopScreencast.mockResolvedValue(undefined);
  liveMocks.session.dispatchInput.mockResolvedValue(undefined);
  liveMocks.session.setDeviceMetricsOverride.mockResolvedValue(undefined);
  liveMocks.session.setUserAgentOverride.mockResolvedValue(undefined);
  liveMocks.session.goto.mockResolvedValue(undefined);
  liveMocks.session.reload.mockResolvedValue(undefined);

  desktopMocks.status.mockReset();
  desktopMocks.status.mockResolvedValue({ enabled: true, started: false });
});

describe('browser live routes', () => {
  it('sends a hello envelope with availability right after the WS handshake', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      const hello = await socket.nextMessage<BrowserLiveEnvelope<BrowserLiveHelloPayload>>();

      expect(hello.ch).toBe('hello');
      expect(hello.seq).toBe(0);
      expect(hello.payload).toMatchObject({
        available: true,
        engine: 'chromium',
        screencast: true,
      });
      expect('viewport' in hello.payload).toBe(false);
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('rejects an unauthorized WS connection with an error envelope and close code 1008', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, '/browser-live');
      const message = await socket.nextMessage<BrowserLiveEnvelope>();

      expect(message.ch).toBe('error');
      expect(message.seq).toBe(0);
      expect(message.payload).toMatchObject({ code: 'UNAUTHORIZED' });

      const closed = await socket.closed;
      expect(closed.code).toBe(1008);
    } finally {
      await app.close();
    }
  });

  it('returns 503 browser_live_disabled when the runtime is disabled', async () => {
    liveMocks.acquire.mockRejectedValue(new Error(DISABLED_MESSAGE));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/browser-live/start',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 'browser_live_disabled',
        error: '当前运行环境未启用浏览器实时预览。',
      });
    } finally {
      await app.close();
    }
  });

  it('returns 503 browser_live_unavailable when the browser binary is missing', async () => {
    liveMocks.acquire.mockRejectedValue(new Error(`${UNAVAILABLE_MESSAGE}: browser-missing`));

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/browser-live/start',
        headers: {
          authorization: bearer(app),
          'content-type': 'application/json',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 'browser_live_unavailable',
        error:
          '未检测到可用的调试浏览器，浏览器实时预览暂不可用。请先执行 npx playwright install chromium 后重试。',
      });
    } finally {
      await app.close();
    }
  });

  it('exposes available:false plus the additive availability fields on /browser-live/status', async () => {
    liveMocks.availability.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/browser-live/status',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        available: false,
        engine: null,
        screencast: false,
        reason: 'browser-missing',
        installable: true,
        source: null,
        expectedRevision: null,
        executablePath: null,
      });
    } finally {
      await app.close();
    }
  });

  it('exposes the outdated managed revision as installable on /browser-live/status', async () => {
    liveMocks.availability.mockResolvedValue({
      available: false,
      engine: 'chromium',
      screencast: false,
      reason: 'browser-outdated',
      installable: true,
      source: 'managed',
      expectedRevision: '1208',
      executablePath: '/home/user/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/browser-live/status',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        available: false,
        engine: 'chromium',
        screencast: false,
        reason: 'browser-outdated',
        installable: true,
        source: 'managed',
        expectedRevision: '1208',
      });
    } finally {
      await app.close();
    }
  });

  it('exposes the liveView capability block on /desktop-automation/status', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/desktop-automation/status',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ enabled: true, started: false });
      expect(body.liveView).toMatchObject({
        available: true,
        engine: 'chromium',
        screencast: true,
        source: 'managed',
        expectedRevision: '1208',
        executablePath: '/usr/bin/fake-chromium',
        installable: false,
      });
    } finally {
      await app.close();
    }
  });

  it('surfaces an unavailable liveView with the probe reason on /desktop-automation/status', async () => {
    liveMocks.availability.mockResolvedValue({
      available: false,
      engine: null,
      screencast: false,
      reason: 'browser-missing',
      installable: true,
      source: null,
      expectedRevision: null,
      executablePath: null,
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/desktop-automation/status',
        headers: { authorization: bearer(app) },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().liveView).toMatchObject({
        available: false,
        engine: null,
        screencast: false,
        reason: 'browser-missing',
        installable: true,
        source: null,
        expectedRevision: null,
        executablePath: null,
      });
    } finally {
      await app.close();
    }
  });

  it('applies screencast credit gating over a live WS connection', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'screencast.start' }));
      await expect(waitFor(() => liveMocks.session.startScreencast.mock.calls.length === 1)).resolves.toBe(
        true,
      );

      liveMocks.emitEvent({
        type: 'screencastFrame',
        data: 'first',
        deviceWidth: 800,
        deviceHeight: 600,
        offsetTop: 0,
        pageScaleFactor: 1,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        frameSessionId: 11,
        timestamp: Date.now(),
      });
      liveMocks.emitEvent({
        type: 'screencastFrame',
        data: 'second',
        deviceWidth: 800,
        deviceHeight: 600,
        offsetTop: 0,
        pageScaleFactor: 1,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
        frameSessionId: 12,
        timestamp: Date.now(),
      });

      const firstFrame = await socket.nextMessage<BrowserLiveEnvelope<{ frameSessionId: number }>>();
      expect(firstFrame.ch).toBe('frame');
      const firstWireId = firstFrame.payload.frameSessionId;
      expect(Number.isInteger(firstWireId)).toBe(true);
      expect(liveMocks.session.ackScreencastFrame).not.toHaveBeenCalled();

      socket.ws.send(JSON.stringify({ ch: 'ack', frameSessionId: firstWireId }));
      await expect(
        waitFor(() => liveMocks.session.ackScreencastFrame.mock.calls.length === 1),
      ).resolves.toBe(true);
      // 网关必须把线路帧 id 映射回真实 CDP session id 后再 ack。
      expect(liveMocks.session.ackScreencastFrame).toHaveBeenCalledWith(11);

      const secondFrame = await socket.nextMessage<BrowserLiveEnvelope<{ frameSessionId: number }>>();
      expect(secondFrame.ch).toBe('frame');
      expect(secondFrame.payload.frameSessionId).not.toBe(firstWireId);

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies with pong to a control ping', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'ping' }));
      const pong = await socket.nextMessage<BrowserLiveEnvelope<{ timestamp: number }>>();

      expect(pong.ch).toBe('pong');
      expect(typeof pong.payload.timestamp).toBe('number');

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies on the dom channel for a dom.tree control message', async () => {
    liveMocks.session.domTree.mockResolvedValue({
      root: {
        nodeId: 1,
        backendNodeId: 2,
        nodeName: 'HTML',
        attributes: { lang: 'zh-CN' },
        childCount: 1,
      },
      truncated: false,
    });

    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'dom.tree', depth: 3 }));
      const message = await socket.nextMessage<BrowserLiveEnvelope<BrowserLiveDomPayload>>();

      expect(message.ch).toBe('dom');
      expect(message.payload.truncated).toBe(false);
      expect(message.payload.root.nodeName).toBe('HTML');
      expect(message.payload.root.attributes).toEqual({ lang: 'zh-CN' });
      expect(liveMocks.session.domTree).toHaveBeenCalledWith({ depth: 3 });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies on the a11y channel for an a11y.tree control message', async () => {
    liveMocks.session.accessibilitySnapshot.mockResolvedValue({
      root: { role: 'RootWebArea', name: '无障碍探测', ignored: false },
      nodeCount: 1,
    });

    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'a11y.tree' }));
      const message = await socket.nextMessage<BrowserLiveEnvelope<BrowserLiveA11yPayload>>();

      expect(message.ch).toBe('a11y');
      expect(message.payload.nodeCount).toBe(1);
      expect(message.payload.root?.role).toBe('RootWebArea');

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies on the node channel with fullComputedStyles for a node.styles control message', async () => {
    liveMocks.session.nodeAtPoint.mockResolvedValue({
      selectorHint: '[data-testid="styles-probe"]',
      selectorStrategy: 'data-testid',
      selectorUnique: true,
      nodeName: 'BUTTON',
      attributes: { 'data-testid': 'styles-probe' },
      text: '样式',
      computedStyles: { display: 'inline-block' },
      fullComputedStyles: { display: 'inline-block', color: 'rgb(1, 2, 3)' },
    });

    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'node.styles', x: 12, y: 34 }));
      const message = await socket.nextMessage<BrowserLiveEnvelope<BrowserLiveNodePayload>>();

      expect(message.ch).toBe('node');
      expect(message.payload.fullComputedStyles).toEqual({
        display: 'inline-block',
        color: 'rgb(1, 2, 3)',
      });
      expect(liveMocks.session.nodeAtPoint).toHaveBeenCalledWith(12, 34, {
        fullComputedStyles: true,
      });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies with DOM_TREE_FAILED when the dom tree cannot be read', async () => {
    liveMocks.session.domTree.mockRejectedValue(new Error('cdp exploded'));

    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'dom.tree' }));
      const message = await socket.nextMessage<BrowserLiveEnvelope>();

      expect(message.ch).toBe('error');
      expect(message.payload).toMatchObject({
        code: 'DOM_TREE_FAILED',
        message: '获取页面 DOM 树失败。',
      });
      expect(liveMocks.session.domTree).toHaveBeenCalledWith({});

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('replies with A11Y_TREE_FAILED when the accessibility tree cannot be read', async () => {
    liveMocks.session.accessibilitySnapshot.mockRejectedValue(new Error('ax exploded'));

    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'control', action: 'a11y.tree' }));
      const message = await socket.nextMessage<BrowserLiveEnvelope>();

      expect(message.ch).toBe('error');
      expect(message.payload).toMatchObject({
        code: 'A11Y_TREE_FAILED',
        message: '获取页面无障碍树失败。',
      });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('forwards device metrics plus the optional user-agent override', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, `/browser-live?token=${encodeURIComponent(token(app))}`);
      await socket.nextMessage();

      const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) live-probe';
      socket.ws.send(
        JSON.stringify({
          ch: 'device',
          width: 375,
          height: 812,
          deviceScaleFactor: 2,
          mobile: true,
          userAgent,
        }),
      );

      await expect(
        waitFor(() => liveMocks.session.setDeviceMetricsOverride.mock.calls.length === 1),
      ).resolves.toBe(true);
      expect(liveMocks.session.setDeviceMetricsOverride).toHaveBeenCalledWith({
        ch: 'device',
        width: 375,
        height: 812,
        deviceScaleFactor: 2,
        mobile: true,
        userAgent,
      });

      await expect(
        waitFor(() => liveMocks.session.setUserAgentOverride.mock.calls.length === 1),
      ).resolves.toBe(true);
      expect(liveMocks.session.setUserAgentOverride).toHaveBeenCalledWith(userAgent);

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('leaves the user-agent untouched when the device message omits it', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, `/browser-live?token=${encodeURIComponent(token(app))}`);
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'device', width: 1280, height: 800 }));

      await expect(
        waitFor(() => liveMocks.session.setDeviceMetricsOverride.mock.calls.length === 1),
      ).resolves.toBe(true);
      expect(liveMocks.session.setDeviceMetricsOverride).toHaveBeenCalledWith({
        ch: 'device',
        width: 1280,
        height: 800,
      });
      expect(liveMocks.session.setUserAgentOverride).not.toHaveBeenCalled();

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('rejects an unknown client message with INVALID_MESSAGE', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/browser-live?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      socket.ws.send(JSON.stringify({ ch: 'nope' }));
      const error = await socket.nextMessage<BrowserLiveEnvelope>();

      expect(error.ch).toBe('error');
      expect(error.payload).toMatchObject({ code: 'INVALID_MESSAGE' });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('returns 404 browser_live_session_not_found for an unknown screenshot session id', async () => {
    liveMocks.session.screenshot.mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/browser-live/screenshot',
        headers: { authorization: bearer(app) },
        payload: { sessionId: 'missing-session' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'browser_live_session_not_found' });
      expect(liveMocks.session.screenshot).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns 404 for a screenshot session owned by another user', async () => {
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')",
      ['other-user', 'other@example.com'],
    );
    insertSession('foreign-session', 'other-user');
    liveMocks.session.screenshot.mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/browser-live/screenshot',
        headers: { authorization: bearer(app) },
        payload: { sessionId: 'foreign-session' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'browser_live_session_not_found' });
      expect(liveMocks.session.screenshot).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns an artifact descriptor for a screenshot targeting an owned session', async () => {
    insertSession('owned-session', USER_ID);
    liveMocks.session.screenshot.mockResolvedValue({
      buffer: Buffer.from('png-bytes'),
      mimeType: 'image/png',
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/browser-live/screenshot',
        headers: { authorization: bearer(app) },
        payload: { sessionId: 'owned-session' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(typeof body.artifactId).toBe('string');
      expect(typeof body.fileName).toBe('string');
      expect(body.mimeType).toBe('image/png');
      expect(body.sizeBytes).toBeGreaterThan(0);
      expect(
        dbModule.sqliteGet('SELECT id FROM artifacts WHERE id = ?', [body.artifactId]),
      ).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it('classifies sqlite constraint failures as a client data error instead of 500', async () => {
    const constraintError = Object.assign(new Error('FOREIGN KEY constraint failed'), {
      code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
    });

    expect(classifyBrowserLiveError(constraintError, '获取浏览器实时预览截图')).toMatchObject({
      code: 'browser_live_invalid_data',
      statusCode: 400,
    });
    expect(classifyBrowserLiveError(new Error('unexpected boom'), 'x')).toMatchObject({
      code: 'browser_live_failed',
      statusCode: 500,
    });
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}
