import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as LspRouterModule from '../../lsp/router.js';

// Minimal structural stand-in for the LSP `Diagnostic` shape; the test
// only drives an empty diagnostics array through the dispatch seam.
type Diagnostic = Record<string, unknown>;

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let lspRouter: typeof LspRouterModule;

const USER_ID = 'u-lsp-events';

/**
 * Typed seam onto the manager's private diagnostics fan-out + handler
 * list so we can drive a push and assert subscription teardown without a
 * spawned language server.
 */
interface DiagnosticsSeam {
  diagnosticHandlers: Array<(path: string, diagnostics: Diagnostic[]) => void>;
  dispatchDiagnostics(path: string, diagnostics: Diagnostic[]): void;
}

function seam(): DiagnosticsSeam {
  return lspRouter.lspManager as unknown as DiagnosticsSeam;
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(lspRouter.lspRoutes);
  await app.ready();
  return app;
}

function token(app: FastifyInstance, userId = USER_ID): string {
  return app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
}

interface CapturedSocket {
  ws: { close: () => void; terminate: () => void };
  nextMessage: <T = Record<string, unknown>>() => Promise<T>;
  closed: Promise<{ code: number }>;
}

async function openSocket(
  app: FastifyInstance,
  path: string,
  authToken: string,
): Promise<CapturedSocket> {
  const queued: unknown[] = [];
  const resolvers: Array<(value: unknown) => void> = [];
  let capturedWs: {
    close: () => void;
    terminate: () => void;
    on: (event: string, cb: (arg: unknown) => void) => void;
  } | null = null;
  let resolveClosed: (value: { code: number }) => void = () => undefined;
  const closed = new Promise<{ code: number }>((resolve) => {
    resolveClosed = resolve;
  });

  const ws = (await app.injectWS(path, { headers: { authorization: `Bearer ${authToken}` } }, {
    onInit: (clientWs: unknown) => {
      capturedWs = clientWs as typeof capturedWs;
      capturedWs?.on('message', (data: unknown) => {
        const parsed = JSON.parse(String(data)) as unknown;
        const resolve = resolvers.shift();
        if (resolve) {
          resolve(parsed);
          return;
        }
        queued.push(parsed);
      });
      capturedWs?.on('close', (code: unknown) => {
        resolveClosed({ code: typeof code === 'number' ? code : 0 });
      });
    },
  } as never)) as unknown as typeof capturedWs;

  const target = capturedWs ?? ws;
  return {
    ws: target as unknown as { close: () => void; terminate: () => void },
    closed,
    nextMessage: async <T = Record<string, unknown>>() => {
      const q = queued.shift();
      if (q !== undefined) return q as T;
      return new Promise<T>((resolve) => {
        resolvers.push((value) => resolve(value as T));
      });
    },
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  dbModule.sqliteRun(
    'INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)',
    [USER_ID, `${USER_ID}@example.com`, 'hash'],
  );
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  lspRouter = await import('../../lsp/router.js');
});

beforeEach(() => {
  // Drop any leftover subscriptions from prior tests.
  seam().diagnosticHandlers.length = 0;
  delete process.env['OPENAWORK_LSP_EVENTS_IDLE_TIMEOUT_MS'];
  delete process.env['OPENAWORK_LSP_EVENTS_HEARTBEAT_INTERVAL_MS'];
});

afterEach(() => {
  delete process.env['OPENAWORK_LSP_EVENTS_IDLE_TIMEOUT_MS'];
  delete process.env['OPENAWORK_LSP_EVENTS_HEARTBEAT_INTERVAL_MS'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

async function waitForHandlerCount(target: number, timeoutMs = 1_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (seam().diagnosticHandlers.length === target) {
      return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return seam().diagnosticHandlers.length;
}

describe('GET /lsp/events 健壮性', () => {
  it('鉴权通过后注册诊断订阅，并把诊断推送转发给客户端', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, '/lsp/events', token(app));
      // 等订阅注册完成。
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seam().diagnosticHandlers.length).toBe(1);

      const message = socket.nextMessage<{ type: string; path: string }>();
      seam().dispatchDiagnostics('file:///a.ts', []);
      await expect(message).resolves.toMatchObject({ type: 'diagnostics', path: 'file:///a.ts' });

      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('客户端关闭后释放模块级诊断订阅', async () => {
    const app = await buildApp();
    try {
      const socket = await openSocket(app, '/lsp/events', token(app));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seam().diagnosticHandlers.length).toBe(1);

      socket.ws.terminate();
      expect(await waitForHandlerCount(0)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('idle 看门狗在超时后主动拆订阅并关闭半开连接', async () => {
    // 极短 idle 超时 + 心跳间隔，确定性地驱动看门狗。
    process.env['OPENAWORK_LSP_EVENTS_IDLE_TIMEOUT_MS'] = '40';
    process.env['OPENAWORK_LSP_EVENTS_HEARTBEAT_INTERVAL_MS'] = '20';
    const app = await buildApp();
    try {
      const socket = await openSocket(app, '/lsp/events', token(app));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(seam().diagnosticHandlers.length).toBe(1);

      // 不发任何活动 → idle 超时触发 finalize + 主动关闭。
      const result = await Promise.race([
        socket.closed,
        new Promise<{ code: number }>((resolve) => setTimeout(() => resolve({ code: -1 }), 2_000)),
      ]);
      expect(result.code).not.toBe(-1);
      expect(seam().diagnosticHandlers.length).toBe(0);
    } finally {
      await app.close();
    }
  });
});
