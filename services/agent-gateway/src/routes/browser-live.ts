/**
 * 浏览器实时预览（P3-core）的网关路由。
 *
 * - `GET /browser-live`：双向 WS 通道（token 走 header 或 query），握手后下发 `hello`，
 *   持续推送 screencast / console / network / nav 事件，接收 input / ack / device / control。
 * - `GET /browser-live/status`、`POST /browser-live/{start,stop,screenshot}`：REST 控制端点，
 *   与 `desktop-automation.ts` 同构（requireAuth + 错误分类 + startRequestWorkflow）。
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type {
  BrowserLiveA11yPayload,
  BrowserLiveClientMessage,
  BrowserLiveControlMessage,
  BrowserLiveDeviceMessage,
  BrowserLiveDomPayload,
  BrowserLiveEnvelope,
  BrowserLiveErrorPayload,
  BrowserLiveInputMessage,
  BrowserLiveNodePayload,
} from '@openAwork/shared';
import { BROWSER_LIVE_WS_PATH } from '@openAwork/shared';
import type { JwtPayload } from '../infra/auth.js';
import { requireAuth } from '../infra/auth.js';
import { parseBody } from '../infra/parse-request.js';
import { sqliteGet } from '../infra/db.js';
import { isSqliteConstraintError } from '../infra/sqlite-error-utils.js';
import { startRequestWorkflow } from '../runtime/request-workflow.js';
import { createMediaArtifact } from '../media/media-artifact.js';
import {
  BROWSER_LIVE_DISABLED_MESSAGE,
  BROWSER_LIVE_UNAVAILABLE_MESSAGE,
  browserLiveManager,
  isBrowserLiveRuntimeEnabled,
} from '../browser-live/manager.js';
import type { BrowserLiveHandle } from '../browser-live/manager.js';
import {
  BROWSER_INSTALL_CONFLICT_CODE,
  BROWSER_INSTALL_CONFLICT_MESSAGE,
  browserInstaller,
} from '../browser-live/browser-installer.js';
import { browserLiveHub, toNodePayload } from '../browser-live/hub.js';
import type { BrowserLiveSink } from '../browser-live/hub.js';
import { installWsHeartbeat } from './ws-heartbeat.js';

const WS_OPEN = 1;

const startBodySchema = z.object({
  url: z.string().url().optional(),
});

const screenshotBodySchema = z.object({
  sessionId: z.string().min(1),
  fullPage: z.boolean().optional(),
});

interface ClassifiedBrowserLiveError {
  readonly code: string;
  readonly error: string;
  readonly statusCode: number;
}

export function classifyBrowserLiveError(
  error: unknown,
  actionLabel: string,
): ClassifiedBrowserLiveError {
  const message = error instanceof Error ? error.message : String(error);

  if (message === BROWSER_LIVE_DISABLED_MESSAGE) {
    return {
      code: 'browser_live_disabled',
      error: '当前运行环境未启用浏览器实时预览。',
      statusCode: 503,
    };
  }

  if (message.startsWith(BROWSER_LIVE_UNAVAILABLE_MESSAGE)) {
    return {
      code: 'browser_live_unavailable',
      error:
        '未检测到可用的调试浏览器，浏览器实时预览暂不可用。请先执行 npx playwright install chromium 后重试。',
      statusCode: 503,
    };
  }

  // 约束冲突（如 artifact 的 session 外键）源于请求数据本身，不是内部故障：
  // 不能让它伪装成 500，否则调用方拿不到可行动的信息。
  if (isSqliteConstraintError(error)) {
    return {
      code: 'browser_live_invalid_data',
      error: '请求的数据不满足约束条件（例如目标会话不存在），请检查后重试。',
      statusCode: 400,
    };
  }

  return {
    code: 'browser_live_failed',
    error: message.length > 0 ? message : `${actionLabel}失败。`,
    statusCode: 500,
  };
}

function failBrowserLiveRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  step: ReturnType<typeof startRequestWorkflow>['step'],
  actionLabel: string,
  error: unknown,
): FastifyReply {
  const classified = classifyBrowserLiveError(error, actionLabel);
  request.log.error({ err: error }, `browser live route failed: ${actionLabel}`);
  step.fail(classified.code);
  return reply.status(classified.statusCode).send({
    error: classified.error,
    code: classified.code,
  });
}

function buildEnvelope<TPayload>(
  ch: BrowserLiveEnvelope['ch'],
  payload: TPayload,
): BrowserLiveEnvelope<TPayload> {
  return { ch, seq: 0, ts: Date.now(), payload };
}

function buildErrorEnvelope(
  code: string,
  message: string,
): BrowserLiveEnvelope<BrowserLiveErrorPayload> {
  return buildEnvelope('error', { code, message });
}

function safeSendEnvelope(socket: WebSocket, envelope: BrowserLiveEnvelope): boolean {
  try {
    socket.send(JSON.stringify(envelope));
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

function safeCloseSocket(socket: WebSocket, code: number, reason?: string): void {
  try {
    socket.close(code, reason);
  } catch (error) {
    void error;
  }
}

// ── 上行消息校验（手写判别式；zod union 在这里会与 shared 的联合类型打架）────────

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isOptionalBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean';
}

function parseInputMessage(value: JsonObject): BrowserLiveInputMessage | null {
  const kind = value['kind'];

  if (kind === 'mouse') {
    const type = value['type'];
    if (type !== 'mouseMoved' && type !== 'mousePressed' && type !== 'mouseReleased') {
      return null;
    }
    if (!isFiniteNumber(value['x']) || !isFiniteNumber(value['y'])) {
      return null;
    }
    const button = value['button'];
    if (button !== undefined && button !== 'left' && button !== 'right' && button !== 'middle') {
      return null;
    }
    if (!isOptionalNumber(value['clickCount'])) {
      return null;
    }

    const message: Extract<BrowserLiveInputMessage, { kind: 'mouse' }> = {
      ch: 'input',
      kind: 'mouse',
      type,
      x: value['x'],
      y: value['y'],
    };
    if (button !== undefined) {
      message.button = button;
    }
    if (value['clickCount'] !== undefined) {
      message.clickCount = value['clickCount'];
    }
    return message;
  }

  if (kind === 'wheel') {
    if (
      !isFiniteNumber(value['x']) ||
      !isFiniteNumber(value['y']) ||
      !isFiniteNumber(value['deltaX']) ||
      !isFiniteNumber(value['deltaY'])
    ) {
      return null;
    }
    return {
      ch: 'input',
      kind: 'wheel',
      x: value['x'],
      y: value['y'],
      deltaX: value['deltaX'],
      deltaY: value['deltaY'],
    };
  }

  if (kind === 'key') {
    const type = value['type'];
    if (type !== 'keyDown' && type !== 'keyUp' && type !== 'char') {
      return null;
    }
    if (
      !isOptionalString(value['key']) ||
      !isOptionalString(value['text']) ||
      !isOptionalString(value['code']) ||
      !isOptionalNumber(value['windowsVirtualKeyCode'])
    ) {
      return null;
    }

    const message: Extract<BrowserLiveInputMessage, { kind: 'key' }> = {
      ch: 'input',
      kind: 'key',
      type,
    };
    if (value['key'] !== undefined) {
      message.key = value['key'];
    }
    if (value['text'] !== undefined) {
      message.text = value['text'];
    }
    if (value['code'] !== undefined) {
      message.code = value['code'];
    }
    if (value['windowsVirtualKeyCode'] !== undefined) {
      message.windowsVirtualKeyCode = value['windowsVirtualKeyCode'];
    }
    return message;
  }

  return null;
}

function parseControlMessage(value: JsonObject): BrowserLiveControlMessage | null {
  const action = value['action'];

  if (action === 'navigate') {
    const url = value['url'];
    if (typeof url !== 'string' || url.length === 0) {
      return null;
    }
    return { ch: 'control', action: 'navigate', url };
  }

  if (action === 'reload') {
    return { ch: 'control', action: 'reload' };
  }

  if (action === 'screencast.start') {
    return { ch: 'control', action: 'screencast.start' };
  }

  if (action === 'screencast.stop') {
    return { ch: 'control', action: 'screencast.stop' };
  }

  if (action === 'pick') {
    if (!isFiniteNumber(value['x']) || !isFiniteNumber(value['y'])) {
      return null;
    }
    return { ch: 'control', action: 'pick', x: value['x'], y: value['y'] };
  }

  if (action === 'screenshot') {
    if (!isOptionalBoolean(value['fullPage'])) {
      return null;
    }
    const message: Extract<BrowserLiveControlMessage, { action: 'screenshot' }> = {
      ch: 'control',
      action: 'screenshot',
    };
    if (value['fullPage'] !== undefined) {
      message.fullPage = value['fullPage'];
    }
    return message;
  }

  if (action === 'ping') {
    return { ch: 'control', action: 'ping' };
  }

  if (action === 'dom.tree') {
    if (!isOptionalNumber(value['depth'])) {
      return null;
    }
    const message: Extract<BrowserLiveControlMessage, { action: 'dom.tree' }> = {
      ch: 'control',
      action: 'dom.tree',
    };
    if (value['depth'] !== undefined) {
      message.depth = value['depth'];
    }
    return message;
  }

  if (action === 'a11y.tree') {
    return { ch: 'control', action: 'a11y.tree' };
  }

  if (action === 'node.styles') {
    if (!isFiniteNumber(value['x']) || !isFiniteNumber(value['y'])) {
      return null;
    }
    return { ch: 'control', action: 'node.styles', x: value['x'], y: value['y'] };
  }

  return null;
}

export function parseBrowserLiveClientMessage(value: unknown): BrowserLiveClientMessage | null {
  if (!isJsonObject(value)) {
    return null;
  }

  const ch = value['ch'];

  if (ch === 'input') {
    return parseInputMessage(value);
  }

  if (ch === 'ack') {
    const frameSessionId = value['frameSessionId'];
    if (!isFiniteNumber(frameSessionId)) {
      return null;
    }
    return { ch: 'ack', frameSessionId };
  }

  if (ch === 'device') {
    const width = value['width'];
    const height = value['height'];
    if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
      return null;
    }
    if (!isOptionalNumber(value['deviceScaleFactor']) || !isOptionalBoolean(value['mobile'])) {
      return null;
    }
    if (!isOptionalString(value['userAgent'])) {
      return null;
    }

    const message: BrowserLiveDeviceMessage = { ch: 'device', width, height };
    if (value['deviceScaleFactor'] !== undefined) {
      message.deviceScaleFactor = value['deviceScaleFactor'];
    }
    if (value['mobile'] !== undefined) {
      message.mobile = value['mobile'];
    }
    if (value['userAgent'] !== undefined) {
      message.userAgent = value['userAgent'];
    }
    return message;
  }

  if (ch === 'control') {
    return parseControlMessage(value);
  }

  return null;
}

async function handleClientMessage(input: {
  raw: string;
  socket: WebSocket;
  userId: string;
  handle: BrowserLiveHandle;
  sink: BrowserLiveSink;
}): Promise<void> {
  const { raw, socket, userId, handle, sink } = input;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    void error;
    safeSendEnvelope(socket, buildErrorEnvelope('INVALID_MESSAGE', '消息格式无效。'));
    return;
  }

  const message = parseBrowserLiveClientMessage(parsed);
  if (!message) {
    safeSendEnvelope(socket, buildErrorEnvelope('INVALID_MESSAGE', '不支持的消息类型。'));
    return;
  }

  try {
    switch (message.ch) {
      case 'input': {
        await handle.session.dispatchInput(message);
        return;
      }
      case 'ack': {
        await browserLiveHub.ackFrame(userId, sink, message.frameSessionId);
        return;
      }
      case 'device': {
        await handle.session.setDeviceMetricsOverride(message);
        // UA 是加法字段：缺省表示保持服务端现状，空串表示清除覆写。
        if (message.userAgent !== undefined) {
          await handle.session.setUserAgentOverride(message.userAgent);
        }
        return;
      }
      case 'control': {
        await handleControlMessage({ message, socket, userId, handle, sink });
        return;
      }
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    safeSendEnvelope(socket, buildErrorEnvelope('INVALID_MESSAGE', messageText));
  }
}

async function handleControlMessage(input: {
  message: BrowserLiveControlMessage;
  socket: WebSocket;
  userId: string;
  handle: BrowserLiveHandle;
  sink: BrowserLiveSink;
}): Promise<void> {
  const { message, socket, userId, handle, sink } = input;

  switch (message.action) {
    case 'navigate': {
      await handle.session.goto(message.url);
      return;
    }
    case 'reload': {
      await handle.session.reload();
      return;
    }
    case 'screencast.start': {
      await browserLiveHub.beginScreencast(userId, sink);
      return;
    }
    case 'screencast.stop': {
      await browserLiveHub.endScreencast(userId);
      return;
    }
    case 'pick': {
      const node = await handle.session.nodeAtPoint(message.x, message.y);
      if (!node) {
        safeSendEnvelope(socket, buildErrorEnvelope('NODE_NOT_FOUND', '未在指定位置找到元素。'));
        return;
      }
      const payload: BrowserLiveNodePayload = toNodePayload(node);
      safeSendEnvelope(socket, buildEnvelope('node', payload));
      return;
    }
    case 'dom.tree': {
      try {
        const tree = await handle.session.domTree(
          message.depth === undefined ? {} : { depth: message.depth },
        );
        const payload: BrowserLiveDomPayload = {
          root: tree.root,
          truncated: tree.truncated,
        };
        safeSendEnvelope(socket, buildEnvelope('dom', payload));
      } catch (error) {
        void error;
        safeSendEnvelope(socket, buildErrorEnvelope('DOM_TREE_FAILED', '获取页面 DOM 树失败。'));
      }
      return;
    }
    case 'a11y.tree': {
      try {
        const snapshot = await handle.session.accessibilitySnapshot();
        const payload: BrowserLiveA11yPayload = {
          root: snapshot.root,
          nodeCount: snapshot.nodeCount,
        };
        safeSendEnvelope(socket, buildEnvelope('a11y', payload));
      } catch (error) {
        void error;
        safeSendEnvelope(socket, buildErrorEnvelope('A11Y_TREE_FAILED', '获取页面无障碍树失败。'));
      }
      return;
    }
    case 'node.styles': {
      try {
        const node = await handle.session.nodeAtPoint(message.x, message.y, {
          fullComputedStyles: true,
        });
        if (!node) {
          safeSendEnvelope(socket, buildErrorEnvelope('NODE_NOT_FOUND', '未在指定位置找到元素。'));
          return;
        }
        const payload: BrowserLiveNodePayload = toNodePayload(node);
        safeSendEnvelope(socket, buildEnvelope('node', payload));
      } catch (error) {
        void error;
        safeSendEnvelope(
          socket,
          buildErrorEnvelope('NODE_STYLES_FAILED', '获取元素计算样式失败。'),
        );
      }
      return;
    }
    case 'screenshot': {
      const shot = await handle.session.screenshot({ fullPage: message.fullPage });
      // WS 控制通道没有 sessionId，无法落 artifact；这里回传内联 base64，
      // 需要 artifact 的截图请走 REST `POST /browser-live/screenshot`。
      safeSendEnvelope(
        socket,
        buildEnvelope('screenshot', {
          data: shot.buffer.toString('base64'),
          mimeType: shot.mimeType,
          fullPage: message.fullPage ?? false,
        }),
      );
      return;
    }
    case 'ping': {
      safeSendEnvelope(socket, buildEnvelope('pong', { timestamp: Date.now() }));
      return;
    }
  }
}

export async function browserLiveRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    BROWSER_LIVE_WS_PATH,
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const queryToken = (request.query as Record<string, string>)['token'];
      const authHeaderValue = request.headers['authorization'];
      const headerToken =
        typeof authHeaderValue === 'string' && authHeaderValue.startsWith('Bearer ')
          ? authHeaderValue.slice('Bearer '.length).trim()
          : undefined;
      const authToken = headerToken || queryToken;

      let user: JwtPayload | null = null;
      if (authToken) {
        try {
          user = request.server.jwt.verify<JwtPayload>(authToken);
        } catch (error) {
          void error;
          safeSendEnvelope(socket, buildErrorEnvelope('UNAUTHORIZED', '未授权或登录已失效。'));
          safeCloseSocket(socket, 1008);
          return;
        }
      } else {
        safeSendEnvelope(socket, buildErrorEnvelope('UNAUTHORIZED', '未授权或登录已失效。'));
        safeCloseSocket(socket, 1008);
        return;
      }

      const userId = user.sub;

      let handle: BrowserLiveHandle;
      try {
        handle = await browserLiveManager.acquire(userId);
      } catch (error) {
        const classified = classifyBrowserLiveError(error, '建立浏览器实时预览会话');
        safeSendEnvelope(socket, buildErrorEnvelope(classified.code, classified.error));
        safeCloseSocket(socket, 1011);
        return;
      }

      let closed = false;
      const sink: BrowserLiveSink = {
        send: (envelope) => safeSendEnvelope(socket, envelope),
        isOpen: () => !closed && socket.readyState === WS_OPEN,
      };

      const stopHeartbeat = installWsHeartbeat(socket);

      const cleanup = () => {
        if (closed) {
          return;
        }
        closed = true;
        stopHeartbeat();
        browserLiveHub.unsubscribe(userId, sink);
        browserLiveManager.release(handle);
      };

      // 握手时无法可靠获知 viewport：此刻还没有任何 screencast 帧，设备指标覆写也可能
      // 是上一条连接遗留的。与其下发误导性的 `null`，不如省略该字段，由消费端按「未知」处理。
      const hello = { ...(await browserLiveManager.availability()) };
      if (!safeSendEnvelope(socket, { ch: 'hello', seq: 0, ts: Date.now(), payload: hello })) {
        cleanup();
        safeCloseSocket(socket, 1011);
        return;
      }

      browserLiveHub.subscribe(userId, handle, sink);

      socket.on('message', (data: Buffer) => {
        void handleClientMessage({ raw: data.toString(), socket, userId, handle, sink });
      });
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );

  app.get(
    '/browser-live/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.status');
      try {
        const availability = await browserLiveManager.availability();
        step.succeed(undefined, {
          available: availability.available,
          screencast: availability.screencast,
        });
        return reply.send({ ...availability });
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '读取浏览器实时预览状态', error);
      }
    },
  );

  app.post(
    '/browser-live/start',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.start');
      const body = parseBody(startBodySchema, request.body);
      const user = request.user as JwtPayload;
      try {
        const handle = await browserLiveManager.acquire(user.sub);
        if (body.url) {
          await handle.session.goto(body.url);
        }
        // 预热：REST start 不作为长期订阅者占用引用计数，交给 idle TTL 保温。
        browserLiveManager.release(handle);
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '启动浏览器实时预览', error);
      }
    },
  );

  app.post(
    '/browser-live/stop',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.stop');
      const user = request.user as JwtPayload;
      try {
        const handle = browserLiveManager.handleFor(user.sub);
        if (handle) {
          browserLiveManager.release(handle);
        }
        step.succeed();
        return reply.send({ ok: true });
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '停止浏览器实时预览', error);
      }
    },
  );

  app.post(
    '/browser-live/screenshot',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.screenshot');
      const body = parseBody(screenshotBodySchema, request.body);
      const user = request.user as JwtPayload;
      try {
        // 产物落库对 session 有外键约束：先确认目标会话存在且属于当前账号，
        // 否则插入会以不透明的 FK 500 收场。所有权必须按 request.user.sub 收敛。
        const ownedSession = sqliteGet<{ id: string }>(
          'SELECT id FROM sessions WHERE id = ? AND user_id = ? LIMIT 1',
          [body.sessionId, user.sub],
        );
        if (!ownedSession) {
          step.fail('browser_live_session_not_found');
          return reply.status(404).send({
            error: '目标会话不存在或不属于当前账号。',
            code: 'browser_live_session_not_found',
          });
        }

        const handle = browserLiveManager.handleFor(user.sub);
        if (!handle) {
          throw new Error('浏览器实时预览会话尚未启动。');
        }

        const shot = await handle.session.screenshot({ fullPage: body.fullPage });
        const artifact = createMediaArtifact({
          userId: user.sub,
          sessionId: body.sessionId,
          buffer: shot.buffer,
          mimeType: shot.mimeType,
          title: '浏览器实时预览截图',
          sourceKind: 'browser_live_screenshot',
          createdBy: 'user',
        });

        step.succeed(undefined, { artifactId: artifact.artifactId });
        return reply.send({
          artifactId: artifact.artifactId,
          fileName: artifact.fileName,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
        });
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '获取浏览器实时预览截图', error);
      }
    },
  );

  app.post(
    '/browser-live/install-browser',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.install-browser');
      if (!isBrowserLiveRuntimeEnabled()) {
        step.fail('browser_live_disabled');
        return reply.status(503).send({
          error: '当前运行环境未启用浏览器实时预览。',
          code: 'browser_live_disabled',
        });
      }

      try {
        const result = await browserInstaller.install();
        if (result.started) {
          step.succeed(undefined, { state: result.status.state });
          return reply.status(202).send(result.status);
        }
        // 未启动且原因不是「已在运行」——CLI 缺席等：如实回 503。
        if (result.status.state !== 'running') {
          step.fail('browser_live_unavailable');
          return reply.status(503).send({
            error: result.status.error ?? '当前环境无法安装调试浏览器。',
            code: 'browser_live_unavailable',
            install: result.status,
          });
        }
        step.fail(BROWSER_INSTALL_CONFLICT_CODE);
        return reply.status(409).send({
          error: BROWSER_INSTALL_CONFLICT_MESSAGE,
          code: BROWSER_INSTALL_CONFLICT_CODE,
          install: result.status,
        });
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '安装调试浏览器', error);
      }
    },
  );

  app.get(
    '/browser-live/install-browser/status',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { step } = startRequestWorkflow(request, 'browser-live.install-browser.status');
      try {
        const status = browserInstaller.status();
        step.succeed(undefined, { state: status.state });
        return reply.send(status);
      } catch (error) {
        return failBrowserLiveRoute(request, reply, step, '读取调试浏览器安装状态', error);
      }
    },
  );
}
