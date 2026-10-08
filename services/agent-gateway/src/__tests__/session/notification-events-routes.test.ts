import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as NotificationStoreModule from '../../session/notification-store.js';
import type * as NotificationEventsBusModule from '../../session/notification-events-bus.js';
import type * as NotificationEventsRoutesModule from '../../routes/notification-events.js';
import type * as NotificationsRoutesModule from '../../routes/notifications.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let dbModule: typeof DbModule;
let notificationStore: typeof NotificationStoreModule;
let notificationEventsBus: typeof NotificationEventsBusModule;
let notificationEventsRoutes: typeof NotificationEventsRoutesModule.notificationEventsRoutes;
let notificationsRoutes: typeof NotificationsRoutesModule.notificationsRoutes;

const USER_ID = 'u-notification-events';
const OTHER_USER_ID = 'u-notification-events-other';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  // GET /notifications 的每个 handler 都开一个 workflow step，缺插件会直接 500。
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(notificationsRoutes);
  await app.register(notificationEventsRoutes);
  await app.ready();
  return app;
}

function token(app: FastifyInstance, userId = USER_ID): string {
  return app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
}

interface TestWebSocket {
  on: (event: 'message', listener: (data: { toString(): string }) => void) => void;
  send: (data: string) => void;
  terminate: () => void;
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

async function openSocket(app: FastifyInstance, path: string) {
  const queuedMessages: unknown[] = [];
  const pendingResolvers: Array<(value: unknown) => void> = [];
  let capturedWs: TestWebSocket | null = null;

  const ws = await app.injectWS(
    path,
    {},
    {
      onInit: (clientWs) => {
        assertIsTestWebSocket(clientWs);
        capturedWs = clientWs;
        capturedWs.on('message', (data) => {
          const parsed = JSON.parse(data.toString()) as unknown;
          const resolve = pendingResolvers.shift();
          if (resolve) {
            resolve(parsed);
            return;
          }
          queuedMessages.push(parsed);
        });
      },
    },
  );
  assertIsTestWebSocket(ws);

  return {
    ws: capturedWs ?? ws,
    nextMessage: async <T = Record<string, unknown>>(): Promise<T> => {
      const queued = queuedMessages.shift();
      if (queued !== undefined) {
        return queued as T;
      }
      return new Promise<T>((resolve) => {
        pendingResolvers.push((value) => resolve(value as T));
      });
    },
  };
}

function createPermissionNotification(id: string, userId = USER_ID): void {
  const sessionId = `session-${id}`;
  // notifications.session_id 有外键指向 sessions，建通知前必须先把会话种下去。
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'session', '{}', 'idle')`,
    [sessionId, userId],
  );
  notificationStore.createNotification({
    body: `requestId=req-${id}\n需要执行\nbash\nmedium`,
    dedupeKey: `permission_asked:req-${id}`,
    eventType: 'permission_asked',
    id,
    sessionId,
    title: '等待权限 · bash',
    userId,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  notificationStore = await import('../../session/notification-store.js');
  notificationEventsBus = await import('../../session/notification-events-bus.js');
  notificationEventsRoutes = (await import('../../routes/notification-events.js'))
    .notificationEventsRoutes;
  notificationsRoutes = (await import('../../routes/notifications.js')).notificationsRoutes;
});

beforeEach(() => {
  notificationEventsBus.__clearNotificationEventsBusForTesting();
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  for (const id of [USER_ID, OTHER_USER_ID]) {
    dbModule.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id,
      `${id}@example.com`,
      'x',
    ]);
  }
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /notification-events', () => {
  it('缺少 token 时拒绝连接并返回 UNAUTHORIZED', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, '/notification-events');
      await expect(socket.nextMessage<{ code: string; type: string }>()).resolves.toEqual({
        type: 'error',
        code: 'UNAUTHORIZED',
      });
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('连接后支持 ping/pong，并对非法消息返回结构化错误', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/notification-events?token=${encodeURIComponent(token(app))}`,
      );
      await expect(socket.nextMessage<{ type: string; userId: string }>()).resolves.toEqual({
        type: 'connected',
        userId: USER_ID,
      });

      const invalidJson = socket.nextMessage<{ code: string; type: string }>();
      socket.ws.send('{bad-json');
      await expect(invalidJson).resolves.toEqual({ type: 'error', code: 'INVALID_JSON' });

      const unsupported = socket.nextMessage<{ code: string; type: string }>();
      socket.ws.send(JSON.stringify({ type: 'unknown' }));
      await expect(unsupported).resolves.toEqual({
        type: 'error',
        code: 'UNSUPPORTED_MESSAGE',
      });

      const pong = socket.nextMessage<{ timestamp: number; type: string }>();
      socket.ws.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toMatchObject({ type: 'pong' });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  /**
   * 握手快照是这套机制**替代轮询**的地基：它必须与 `GET /notifications?view=pending`
   * 逐字段一致，否则「快照首屏」与「事件后拉取」会在用户眼前来回跳。
   */
  it('sync 快照与 GET /notifications?view=pending 完全同口径', async () => {
    const app = await buildApp();
    try {
      createPermissionNotification('notif-1');
      createPermissionNotification('notif-2');
      createPermissionNotification('notif-other', OTHER_USER_ID);

      const socket = await openSocket(
        app,
        `/notification-events?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      const snapshotPromise = socket.nextMessage<{
        browserBroadcasts: unknown[];
        notifications: { id: string }[];
        pendingActionableCount: number;
        type: string;
      }>();
      socket.ws.send(JSON.stringify({ type: 'sync' }));
      const snapshot = await snapshotPromise;

      const response = await app.inject({
        headers: { authorization: `Bearer ${token(app)}` },
        method: 'GET',
        url: '/notifications?view=pending&limit=30',
      });
      expect(response.statusCode).toBe(200);
      const rest = response.json() as {
        browserBroadcasts: unknown[];
        notifications: { id: string }[];
        pendingActionableCount: number;
      };

      expect(snapshot.type).toBe('notification.snapshot');
      expect(snapshot.pendingActionableCount).toBe(rest.pendingActionableCount);
      expect(snapshot.notifications.map((item) => item.id)).toEqual(
        rest.notifications.map((item) => item.id),
      );
      expect(snapshot.browserBroadcasts).toEqual(rest.browserBroadcasts);
      // 别的用户的待办绝不能出现在这条连接上。
      expect(snapshot.notifications.map((item) => item.id)).not.toContain('notif-other');

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('通知落库即推送脏标记，且红点计数为服务端权威值', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/notification-events?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();
      expect(notificationEventsBus.getNotificationEventsBusStats().listenerCount).toBe(1);

      const pushed = socket.nextMessage<{
        pendingActionableCount: number;
        reason: string;
        type: string;
      }>();
      createPermissionNotification('notif-1');
      await expect(pushed).resolves.toMatchObject({
        pendingActionableCount: 1,
        reason: 'created',
        type: 'notification.changed',
      });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('已读 / 忽略同样推送事件，让多标签页红点同步收敛', async () => {
    const app = await buildApp();
    try {
      createPermissionNotification('notif-1');
      const socket = await openSocket(
        app,
        `/notification-events?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();

      const readPushed = socket.nextMessage<{ pendingActionableCount: number; reason: string }>();
      notificationStore.markNotificationRead({ id: 'notif-1', userId: USER_ID });
      await expect(readPushed).resolves.toMatchObject({
        pendingActionableCount: 0,
        reason: 'read',
      });

      const archivedPushed = socket.nextMessage<{
        pendingActionableCount: number;
        reason: string;
      }>();
      notificationStore.archiveNotification({ id: 'notif-1', userId: USER_ID });
      await expect(archivedPushed).resolves.toMatchObject({
        pendingActionableCount: 0,
        reason: 'archived',
      });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('关闭连接后释放订阅', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        `/notification-events?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();
      expect(notificationEventsBus.getNotificationEventsBusStats().listenerCount).toBe(1);

      socket.ws.terminate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(notificationEventsBus.getNotificationEventsBusStats().listenerCount).toBe(0);
    } finally {
      await app.close();
    }
  });
});
