/**
 * WebSocket coverage for the additive per-terminal transport
 * (`GET /sessions/:sessionId/terminals/:terminalId/ws`).
 *
 * Uses the real auth + registry stack with `app.injectWS`, so the frame
 * ordering, ownership checks, and the synchronous immediate-output channel are
 * exercised for real. Only external boundaries are replaced: the PTY
 * stdin/resize functions and the run-event bus (so `terminal_exited` can be
 * driven deterministically).
 */

import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionTerminalsRoutesModule from '../../routes/session-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';
import type * as PersistentTerminalsModule from '../../session/persistent-terminals.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const raceWindow = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: unknown) => void>>(),
  onSnapshot: undefined as (() => void) | undefined,
}));

const stdinSpy = vi.hoisted(() => ({
  calls: [] as Array<{ terminalId: string; data: string }>,
  result: { ok: true } as { ok: boolean; error?: string },
}));

const resizeSpy = vi.hoisted(() => ({
  calls: [] as Array<{ terminalId: string; cols: number; rows: number }>,
}));

// Plain factory (no importOriginal): the real run-event module pulls in the
// whole message/notification pipeline, which is irrelevant here and would also
// drag unrelated modules into the transform.
vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: (sessionId: string, event: unknown) => {
    const listeners = raceWindow.listeners.get(sessionId);
    if (listeners) {
      for (const listener of [...listeners]) listener(event);
    }
    return { seq: null, rowId: null };
  },
  subscribeSessionRunEvents: (sessionId: string, listener: (event: unknown) => void) => {
    let listeners = raceWindow.listeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      raceWindow.listeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
    };
  },
}));

vi.mock('../../session/persistent-terminals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PersistentTerminalsModule>();
  return {
    ...actual,
    writeStdinToTerminal: (terminalId: string, data: string) => {
      stdinSpy.calls.push({ terminalId, data });
      return stdinSpy.result;
    },
    resizeTerminal: (input: { terminalId: string; cols: number; rows: number }) => {
      resizeSpy.calls.push(input);
      return { ok: true };
    },
  };
});

// `getTerminalOutputSnapshot` is wrapped so a test can inject output into the
// precise gap between "immediate subscription active" and "snapshot written".
vi.mock('../../session/session-terminal-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistryModule>();
  return {
    ...actual,
    getTerminalOutputSnapshot: (terminalId: string) => {
      const snapshot = actual.getTerminalOutputSnapshot(terminalId);
      raceWindow.onSnapshot?.();
      return snapshot;
    },
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionTerminalsRoutes: typeof SessionTerminalsRoutesModule.sessionTerminalsRoutes;
let registry: typeof RegistryModule;

const USER_ID = 'u-term-ws';
const OTHER_USER_ID = 'u-term-ws-other';
const SESSION_ID = 's-term-ws';
const OTHER_SESSION_ID = 's-term-ws-other';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function seedSession(sessionId: string, userId: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    sessionId,
    userId,
  ]);
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(websocket);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionTerminalsRoutes);
  await app.ready();
  return app;
}

function tokenFor(app: FastifyInstance, userId = USER_ID): string {
  return app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
}

function wsUrl(
  terminalId: string,
  app: FastifyInstance,
  options: { sessionId?: string; userId?: string; afterSeq?: number } = {},
): string {
  const params = new URLSearchParams({ token: tokenFor(app, options.userId ?? USER_ID) });
  if (options.afterSeq !== undefined) params.set('afterSeq', String(options.afterSeq));
  return `/sessions/${options.sessionId ?? SESSION_ID}/terminals/${terminalId}/ws?${params.toString()}`;
}

interface TestWebSocket {
  send: (data: string) => void;
  terminate: () => void;
  on: (event: string, listener: (arg: unknown) => void) => void;
}

interface TerminalWsServerFrame {
  type: string;
  terminalId?: string;
  seq?: number;
  data?: string;
  outputBytesTotal?: number;
  status?: string;
  exitCode?: number;
  interactive?: boolean;
  code?: string;
  message?: string;
}

interface CapturedSocket {
  ws: TestWebSocket;
  nextMessage: <T = TerminalWsServerFrame>() => Promise<T>;
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
      clientWs.on('message', (data: unknown) => {
        const parsed = JSON.parse(String(data)) as unknown;
        const resolve = resolvers.shift();
        if (resolve) {
          resolve(parsed);
          return;
        }
        queued.push(parsed);
      });
      clientWs.on('close', (code: unknown) => {
        resolveClosed({ code: typeof code === 'number' ? code : 0 });
      });
    },
  } as never);

  assertIsTestWebSocket(ws);
  const target = captured ?? ws;
  return {
    ws: target,
    closed,
    nextMessage: async <T = TerminalWsServerFrame>() => {
      const queuedMessage = queued.shift();
      if (queuedMessage !== undefined) return queuedMessage as T;
      return new Promise<T>((resolve) => {
        resolvers.push((value) => resolve(value as T));
      });
    },
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(predicate()).toBe(true);
}

function registerTerminal(
  sessionId = SESSION_ID,
  userId = USER_ID,
): RegistryModule.SessionTerminalRecord {
  return registry.registerTerminal({
    sessionId,
    userId,
    toolName: 'bash',
    kind: 'foreground',
    command: 'shell',
    cwd: '/tmp',
    metadata: { backend: 'pty', interactive: true },
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionTerminalsRoutes = (await import('../../routes/session-terminals.js'))
    .sessionTerminalsRoutes;
  registry = await import('../../session/session-terminal-registry.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
  raceWindow.listeners.clear();
  raceWindow.onSnapshot = undefined;
  stdinSpy.calls.length = 0;
  stdinSpy.result = { ok: true };
  resizeSpy.calls.length = 0;
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  seedUser(USER_ID, 'ws@example.com');
  seedUser(OTHER_USER_ID, 'ws-other@example.com');
  seedSession(SESSION_ID, USER_ID);
  seedSession(OTHER_SESSION_ID, OTHER_USER_ID);
});

describe('GET /sessions/:sessionId/terminals/:terminalId/ws', () => {
  it('无 token / 非法 token 时以 4401 关闭且不订阅', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      const anonymous = await openSocket(
        app,
        `/sessions/${SESSION_ID}/terminals/${record.terminalId}/ws`,
      );
      await expect(anonymous.closed).resolves.toEqual({ code: 4401 });

      const invalid = await openSocket(
        app,
        `/sessions/${SESSION_ID}/terminals/${record.terminalId}/ws?token=not-a-jwt`,
      );
      await expect(invalid.closed).resolves.toEqual({ code: 4401 });
      expect(registry.__immediateOutputListenerCountForTest(record.terminalId)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('会话归属校验失败时以 4401 关闭', async () => {
    const record = registerTerminal(OTHER_SESSION_ID, OTHER_USER_ID);
    const app = await buildApp();
    try {
      const socket = await openSocket(
        app,
        wsUrl(record.terminalId, app, { sessionId: OTHER_SESSION_ID }),
      );
      await expect(socket.closed).resolves.toEqual({ code: 4401 });
      expect(registry.__immediateOutputListenerCountForTest(record.terminalId)).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('连接后先收到唯一 snapshot，随后同步推送 output 且 seq 单调递增', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      const snapshot = await socket.nextMessage();
      expect(snapshot).toMatchObject({
        type: 'snapshot',
        terminalId: record.terminalId,
        seq: 0,
        data: '',
        outputBytesTotal: 0,
        status: 'running',
        interactive: true,
      });

      registry.appendTerminalOutputDelta(record.terminalId, 'abc');
      registry.appendTerminalOutputDelta(record.terminalId, 'de');
      const first = await socket.nextMessage();
      const second = await socket.nextMessage();
      expect(first).toEqual({
        type: 'output',
        terminalId: record.terminalId,
        seq: 3,
        data: 'abc',
        outputBytesTotal: 3,
      });
      expect(second).toEqual({
        type: 'output',
        terminalId: record.terminalId,
        seq: 5,
        data: 'de',
        outputBytesTotal: 5,
      });
      expect(second.seq!).toBeGreaterThan(first.seq!);
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('快照与订阅竞态窗口内的输出被缓冲，并按序在 snapshot 之后补发', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      raceWindow.onSnapshot = () => {
        registry.appendTerminalOutputDelta(record.terminalId, 'race');
      };
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      const snapshot = await socket.nextMessage();
      const output = await socket.nextMessage();
      expect(snapshot).toMatchObject({ type: 'snapshot', seq: 0, data: '' });
      expect(output).toEqual({
        type: 'output',
        terminalId: record.terminalId,
        seq: 4,
        data: 'race',
        outputBytesTotal: 4,
      });
      socket.ws.terminate();
    } finally {
      raceWindow.onSnapshot = undefined;
      await app.close();
    }
  });

  it('afterSeq 命中已渲染游标时，竞态窗口内的重复 output 被去重', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      raceWindow.onSnapshot = () => {
        registry.appendTerminalOutputDelta(record.terminalId, 'dup');
      };
      const socket = await openSocket(app, wsUrl(record.terminalId, app, { afterSeq: 3 }));
      await socket.nextMessage(); // snapshot
      const raced = await Promise.race([
        socket.nextMessage().then(() => 'message'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 60)),
      ]);
      expect(raced).toBe('timeout');
      socket.ws.terminate();
    } finally {
      raceWindow.onSnapshot = undefined;
      await app.close();
    }
  });

  it('input 帧走既有 stdin 写入路径，resize 帧走 resize 路径，ping 得到 pong', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      await socket.nextMessage(); // snapshot

      socket.ws.send(JSON.stringify({ type: 'input', data: 'ls\r' }));
      await waitFor(() => stdinSpy.calls.length === 1);
      expect(stdinSpy.calls).toEqual([{ terminalId: record.terminalId, data: 'ls\r' }]);

      socket.ws.send(JSON.stringify({ type: 'resize', cols: 101, rows: 37 }));
      await waitFor(() => resizeSpy.calls.length === 1);
      expect(resizeSpy.calls).toEqual([{ terminalId: record.terminalId, cols: 101, rows: 37 }]);

      const pong = socket.nextMessage();
      socket.ws.send(JSON.stringify({ type: 'ping' }));
      await expect(pong).resolves.toEqual({ type: 'pong' });
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('非持久终端写入 stdin 时回结构化 error 帧', async () => {
    const record = registerTerminal();
    stdinSpy.result = { ok: false, error: 'terminal_not_persistent' };
    const app = await buildApp();
    try {
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      await socket.nextMessage(); // snapshot
      const error = socket.nextMessage();
      socket.ws.send(JSON.stringify({ type: 'input', data: 'x' }));
      await expect(error).resolves.toMatchObject({
        type: 'error',
        code: 'terminal_not_persistent',
        message: '该终端是 agent 的一次性命令，不支持继续输入。',
      });
      socket.ws.terminate();
    } finally {
      await app.close();
    }
  });

  it('连接关闭后立即退订 immediate 通道（无监听器泄漏）', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      await socket.nextMessage(); // snapshot
      expect(registry.__immediateOutputListenerCountForTest(record.terminalId)).toBe(1);
      socket.ws.terminate();
      await waitFor(() => registry.__immediateOutputListenerCountForTest(record.terminalId) === 0);
    } finally {
      await app.close();
    }
  });

  it('终端退出时发送 exit 帧、关闭连接并清理监听器', async () => {
    const record = registerTerminal();
    const app = await buildApp();
    try {
      const socket = await openSocket(app, wsUrl(record.terminalId, app));
      await socket.nextMessage(); // snapshot

      registry.markTerminalExited({
        terminalId: record.terminalId,
        status: 'exited',
        exitCode: 0,
      });
      const exit = await socket.nextMessage();
      expect(exit).toEqual({
        type: 'exit',
        terminalId: record.terminalId,
        status: 'exited',
        exitCode: 0,
      });
      await expect(socket.closed).resolves.toEqual({ code: 1000 });
      expect(registry.__immediateOutputListenerCountForTest(record.terminalId)).toBe(0);
    } finally {
      await app.close();
    }
  });
});
