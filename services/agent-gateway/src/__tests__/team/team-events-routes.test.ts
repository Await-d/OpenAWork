import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as TeamEventsRoutesModule from '../../routes/team-events.js';
import type * as TeamEventsBusModule from '../../handoff/bus/team-events-bus.js';
import type * as DiagnosticsStoreModule from '../../team/team-runtime-diagnostics-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let teamEventsRoutes: typeof TeamEventsRoutesModule.teamEventsRoutes;
let teamEventsBus: typeof TeamEventsBusModule;
let diagnosticsStore: typeof DiagnosticsStoreModule;

const USER_ID = 'u-team-events-routes';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(teamEventsRoutes);
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

interface CapturedTeamEventsSocket {
  nextMessage: <T = Record<string, unknown>>() => Promise<T>;
  ws: TestWebSocket;
}

async function openTeamEventsSocket(
  app: FastifyInstance,
  path: string,
): Promise<CapturedTeamEventsSocket> {
  const queuedMessages: unknown[] = [];
  const pendingResolvers: Array<(value: unknown) => void> = [];
  let capturedWs: TestWebSocket | null = null;

  const ws = (await app.injectWS(
    path,
    {},
    {
      onInit: (clientWs) => {
        capturedWs = clientWs as TestWebSocket;
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
  )) as TestWebSocket;

  return {
    ws: capturedWs ?? ws,
    nextMessage: async <T = Record<string, unknown>>() => {
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

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  const auth = await import('../../infra/auth.js');
  authPlugin = auth.default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  teamEventsRoutes = (await import('../../routes/team-events.js')).teamEventsRoutes;
  teamEventsBus = await import('../../handoff/bus/team-events-bus.js');
  diagnosticsStore = await import('../../team/team-runtime-diagnostics-store.js');
});

beforeEach(() => {
  teamEventsBus.__clearTeamEventsBusForTesting();
  diagnosticsStore.__resetTeamRuntimeDiagnosticsForTesting();
  dbModule.sqliteRun('DELETE FROM team_audit_logs', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('GET /team-events', () => {
  it('缺少 token 时拒绝连接并返回 UNAUTHORIZED 事件', async () => {
    const app = await buildApp();
    try {
      const socket = await openTeamEventsSocket(app, '/team-events');
      const message = await socket.nextMessage<{ code: string; type: string }>();

      expect(message).toEqual({ type: 'error', code: 'UNAUTHORIZED' });
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('连接后支持 ping/pong，并对非法消息返回结构化错误', async () => {
    const app = await buildApp();
    try {
      const socket = await openTeamEventsSocket(
        app,
        `/team-events?token=${encodeURIComponent(token(app))}`,
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

  it('只把当前用户的 team event 转发到连接，并在关闭后释放订阅', async () => {
    const app = await buildApp();
    try {
      const socket = await openTeamEventsSocket(
        app,
        `/team-events?token=${encodeURIComponent(token(app))}`,
      );
      await socket.nextMessage();
      expect(teamEventsBus.getTeamEventsBusStats().listenerCount).toBe(1);

      teamEventsBus.publishTeamEvent({
        type: 'handoff.created',
        taskId: 'h-other',
        timestamp: Date.now(),
        payload: {},
        userId: 'u-other',
      });
      const forwarded = socket.nextMessage<{
        payload: Record<string, unknown>;
        taskId: string;
        type: string;
      }>();
      teamEventsBus.publishTeamEvent({
        type: 'handoff.created',
        taskId: 'h-current',
        timestamp: Date.now(),
        payload: { state: 'pending' },
        userId: USER_ID,
      });
      await expect(forwarded).resolves.toMatchObject({
        type: 'handoff.created',
        taskId: 'h-current',
        payload: { state: 'pending' },
      });

      socket.ws.terminate();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(teamEventsBus.getTeamEventsBusStats().listenerCount).toBe(0);
    } finally {
      await app.close();
    }
  });
});
