/**
 * `GET /notification-events` — user-scoped 通知变更 WS 通道。
 *
 * 它取代的旧机制：铃铛与权限浮窗各挂一条 15s `setInterval` 轮询 `GET /notifications`。
 * 那是每客户端每分钟 4 次全量查询，而 `listNotifications` 会顺手执行惰性过期的 `UPDATE`，
 * 于是「读」顺带变成写事务去抢 SQLite 写锁。现在通知落库即发事件（见
 * `session/notification-events-bus.ts`），空闲时零请求。
 *
 * 协议（极简，刻意不复刻 HTTP 的数据结构）：
 *
 *   ← { type: 'sync' }            客户端握手 / 每次重连成功后发
 *   → { type: 'notification.snapshot', notifications, browserBroadcasts,
 *       pendingActionableCount }  服务端回当前权威快照
 *   → { type: 'notification.changed', reason, pendingActionableCount, timestamp }
 *                                   脏标记：红点用权威值即时更新，列表由客户端拉一次 HTTP
 *   ← { type: 'ping' } / → { type: 'pong' }  应用层保活
 *
 * 为什么需要 `sync`：总线明确「不持久化、不重放」，断线期间的事件必然丢失。因此
 * 一致性由握手快照兜底——重连后补一次全量即可，无需任何定时轮询。
 *
 * 鉴权沿用 `?token=` / `Authorization: Bearer` 双通道（浏览器 WebSocket 无法自定义
 * header），语义与 `/team-events`、`/sessions/:id/stream` 一致。
 */

import type { WebSocket } from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { JwtPayload } from '../infra/auth.js';
import {
  subscribeToNotificationEvents,
  type NotificationChangedEvent,
} from '../session/notification-events-bus.js';
import { buildPendingNotificationSnapshot } from '../session/notification-store.js';

const HEARTBEAT_INTERVAL_MS = 10_000;
const IDLE_TIMEOUT_MS = 45_000;

/** 与前端铃铛的 `limit: 30` 对齐，避免首屏快照比轮询首拉还短。 */
const SNAPSHOT_LIMIT = 30;

export async function notificationEventsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/notification-events',
    { websocket: true },
    async (socket: WebSocket, request: FastifyRequest) => {
      const user = verifySubscriber(request);
      if (!user) {
        safeSend(socket, { type: 'error', code: 'UNAUTHORIZED' });
        safeClose(socket, 1008, 'UNAUTHORIZED');
        return;
      }

      const userId = user.sub;
      if (!safeSend(socket, { type: 'connected', userId })) {
        safeClose(socket, 1011, 'CONNECT_SEND_FAILED');
        return;
      }

      let closed = false;
      let lastActivityAt = Date.now();
      let heartbeat: NodeJS.Timeout | null = null;
      let unsubscribe: (() => void) | null = null;

      const touchActivity = (): void => {
        lastActivityAt = Date.now();
      };

      /**
       * 幂等收口。`close` / `error` / 主动 close 三条路径都可能触发，必须收敛到一处——
       * 否则一条半开连接会同时漏掉退订和心跳清零，在进程存活期内一直挂着。
       */
      const cleanup = (): void => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
      };

      const sendSnapshot = (): boolean => {
        const snapshot = buildPendingNotificationSnapshot(userId, SNAPSHOT_LIMIT);
        return safeSend(socket, { type: 'notification.snapshot', ...snapshot });
      };

      const closeSocket = (code: number, reason: string, errorCode?: string): void => {
        if (closed) return;
        if (errorCode) {
          safeSend(socket, { type: 'error', code: errorCode });
        }
        cleanup();
        safeClose(socket, code, reason);
      };

      const sendOrClose = (ok: boolean, errorCode: string): void => {
        if (ok) {
          touchActivity();
          return;
        }
        closeSocket(1011, 'NOTIFICATION_EVENTS_SEND_FAILED', errorCode);
      };

      // 按 userId 过滤：用户之间互不可见，即使信封带着 userId 也不外泄。
      const stopSubscribing = subscribeToNotificationEvents((event: NotificationChangedEvent) => {
        if (event.userId !== userId) return;
        sendOrClose(safeSend(socket, event), 'SEND_FAILED');
      });
      unsubscribe = stopSubscribing;

      heartbeat = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastActivityAt > IDLE_TIMEOUT_MS) {
          // 空闲超时主动断开，让客户端走「重连即重拉快照」的既定恢复路径，
          // 而不是留一条半开连接假装还活着。
          closeSocket(1001, 'NOTIFICATION_EVENTS_IDLE_TIMEOUT', 'IDLE_TIMEOUT');
          return;
        }
        try {
          socket.ping();
        } catch {
          closeSocket(1011, 'NOTIFICATION_EVENTS_PING_FAILED', 'PING_FAILED');
        }
      }, HEARTBEAT_INTERVAL_MS);

      socket.on('message', (data: Buffer) => {
        touchActivity();
        const text = data.toString().trim();
        if (text.length === 0) return;
        let parsed: { type?: string };
        try {
          parsed = JSON.parse(text) as { type?: string };
        } catch {
          safeSend(socket, { type: 'error', code: 'INVALID_JSON' });
          return;
        }
        if (parsed.type === 'ping') {
          sendOrClose(
            safeSend(socket, { type: 'pong', timestamp: Date.now() }),
            'PONG_SEND_FAILED',
          );
          return;
        }
        if (parsed.type === 'sync') {
          // 快照是「重新对账」的唯一手段，因此它绝不能因一次写失败就静默消失——
          // 失败必须让客户端看到错误并重连，否则红点会永久停在旧值且无人知晓。
          sendOrClose(sendSnapshot(), 'SNAPSHOT_SEND_FAILED');
          return;
        }
        if (parsed.type === 'pong') return;
        safeSend(socket, { type: 'error', code: 'UNSUPPORTED_MESSAGE' });
      });

      socket.on('pong', touchActivity);
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    },
  );
}

function verifySubscriber(request: FastifyRequest): JwtPayload | null {
  const queryToken = (request.query as Record<string, string>)['token'];
  const authHeaderValue = request.headers['authorization'];
  const headerToken =
    typeof authHeaderValue === 'string' && authHeaderValue.startsWith('Bearer ')
      ? authHeaderValue.slice('Bearer '.length).trim()
      : undefined;
  const authToken = headerToken || queryToken;
  if (!authToken) {
    return null;
  }
  try {
    return request.server.jwt.verify<JwtPayload>(authToken);
  } catch {
    return null;
  }
}

function safeSend(socket: WebSocket, payload: unknown): boolean {
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function safeClose(socket: WebSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    // 已经断了就没什么可关的。
  }
}
