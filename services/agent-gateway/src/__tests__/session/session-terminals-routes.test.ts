/**
 * HTTP coverage for `/sessions/:sessionId/terminals` routes.
 *
 * Uses Fastify inject + the real auth + DB stack so the path enforces
 * session ownership and returns rows the registry actually wrote.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvent } from '@openAwork/shared';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionTerminalsRoutesModule from '../../routes/session-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';
import type * as RunEventsModule from '../../session/session-run-events.js';
import { detectTerminalBackend } from '../../session/pty-backend.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const raceWindow = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: unknown) => void>>(),
  onSnapshot: undefined as (() => void) | undefined,
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: (sessionId: string, event: unknown) => {
    const listeners = raceWindow.listeners.get(sessionId);
    if (!listeners) return;
    for (const listener of listeners) listener(event);
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

vi.mock('../../session/session-terminal-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof RegistryModule>();
  return {
    ...actual,
    getTerminalOutputSnapshot: (terminalId: string) => {
      raceWindow.onSnapshot?.();
      return actual.getTerminalOutputSnapshot(terminalId);
    },
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionTerminalsRoutes: typeof SessionTerminalsRoutesModule.sessionTerminalsRoutes;
let registry: typeof RegistryModule;
let runEvents: typeof RunEventsModule;

const USER_ID = 'u-term-route';
const OTHER_USER_ID = 'u-term-route-other';
const SESSION_ID = 's-term-route';
const OTHER_SESSION_ID = 's-term-route-other';

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
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionTerminalsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance, userId = USER_ID): string {
  const token = app.jwt.sign({ sub: userId, email: `${userId}@example.com` });
  return `Bearer ${token}`;
}

function resetState(): void {
  registry.__resetSessionTerminalsForTest();
  raceWindow.listeners.clear();
  raceWindow.onSnapshot = undefined;
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionTerminalsRoutes = (await import('../../routes/session-terminals.js'))
    .sessionTerminalsRoutes;
  registry = await import('../../session/session-terminal-registry.js');
  runEvents = await import('../../session/session-run-events.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  resetState();
  seedUser(USER_ID, 'a@example.com');
  seedUser(OTHER_USER_ID, 'b@example.com');
  seedSession(SESSION_ID, USER_ID);
  seedSession(OTHER_SESSION_ID, OTHER_USER_ID);
});

describe('GET /sessions/:sessionId/terminals', () => {
  it('rejects unauthenticated callers', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals`,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: '未授权或登录已失效。',
    });
    await app.close();
  });

  it('returns 404 when the caller does not own the session', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${OTHER_SESSION_ID}/terminals`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('lists terminals for the calling user', async () => {
    registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo a',
      cwd: '/tmp',
    });
    registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo b',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { terminals: unknown[] };
    expect(body.terminals).toHaveLength(2);
    await app.close();
  });

  it('honours status=running filter', async () => {
    const running = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 1',
      cwd: '/tmp',
    });
    const closed = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo done',
      cwd: '/tmp',
    });
    registry.markTerminalExited({
      terminalId: closed.terminalId,
      status: 'exited',
      exitCode: 0,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals?status=running`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { terminals: Array<{ terminalId: string }> };
    expect(body.terminals.map((t) => t.terminalId)).toEqual([running.terminalId]);
    await app.close();
  });
});

describe('GET /sessions/:sessionId/terminals/:terminalId', () => {
  it('returns 404 for a terminal in a different session', async () => {
    const record = registry.registerTerminal({
      sessionId: OTHER_SESSION_ID,
      userId: OTHER_USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo other',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('公共载荷加法暴露 backend/supportsResize，且不泄漏 metadata', async () => {
    const ptyRow = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'pty row',
      cwd: '/tmp',
      metadata: { backend: 'pty', serverOnly: 'secret' },
    });
    const legacyRow = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'legacy row',
      cwd: '/tmp',
    });
    const app = await buildApp();

    const ptyRes = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals/${ptyRow.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(ptyRes.statusCode).toBe(200);
    const ptyTerminal = (ptyRes.json() as { terminal: Record<string, unknown> }).terminal;
    // 既有字段保持不变 + 两个加法字段存在。
    expect(ptyTerminal).toMatchObject({
      terminalId: ptyRow.terminalId,
      sessionId: SESSION_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'pty row',
      cwd: '/tmp',
      status: 'running',
      outputBytesTotal: 0,
      outputTail: '',
      backend: 'pty',
      supportsResize: true,
    });
    expect(ptyTerminal).not.toHaveProperty('metadata');

    const legacyRes = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals/${legacyRow.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(legacyRes.statusCode).toBe(200);
    const legacyTerminal = (legacyRes.json() as { terminal: Record<string, unknown> }).terminal;
    // 没有 metadata.backend 的存量行按运行时探测兜底（vitest/Node → pipe）。
    expect(legacyTerminal['backend']).toBe(detectTerminalBackend().kind);
    expect(legacyTerminal['supportsResize']).toBe(detectTerminalBackend().kind === 'pty');
    await app.close();
  });
});

describe('POST /sessions/:sessionId/terminals/:terminalId/kill', () => {
  it('triggers the abort controller and returns the updated row', async () => {
    const ac = new AbortController();
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 5',
      cwd: '/tmp',
      abortController: ac,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}/kill`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(ac.signal.aborted).toBe(true);
    const body = res.json() as {
      result: { found: boolean; killed: boolean };
      terminal: { terminalId: string } | null;
    };
    expect(body.result).toMatchObject({ found: true, killed: true });
    expect(body.terminal?.terminalId).toBe(record.terminalId);
    await app.close();
  });

  it('returns 404 for a terminal owned by another session', async () => {
    const record = registry.registerTerminal({
      sessionId: OTHER_SESSION_ID,
      userId: OTHER_USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 1',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}/kill`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe('DELETE /sessions/:sessionId/terminals/:terminalId', () => {
  it('refuses to delete a running terminal', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 5',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'terminal_running',
      message: '终端仍在运行，请先终止后再删除记录。',
    });
    await app.close();
  });

  it('deletes a closed terminal', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo done',
      cwd: '/tmp',
    });
    registry.markTerminalExited({
      terminalId: record.terminalId,
      status: 'exited',
      exitCode: 0,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'DELETE',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    expect(registry.getTerminal(record.terminalId, USER_ID)).toBeNull();
    await app.close();
  });

  it('stdin 写入到一次性终端时返回中文 message，同时保留错误码', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo once',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}/stdin`,
      headers: {
        authorization: bearer(app),
        'content-type': 'application/json',
      },
      payload: { data: 'ls\n' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'terminal_not_persistent',
      message: '该终端是 agent 的一次性命令，不支持继续输入。',
    });
    await app.close();
  });
});

interface SseEvent {
  event: string;
  data: string;
}

function parseSseBlock(block: string): SseEvent | undefined {
  let event = '';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart());
  }
  if (event.length === 0) return undefined;
  return { event, data: dataLines.join('\n') };
}

async function readSseEvents(
  body: ReadableStream<Uint8Array> | null,
  count: number,
): Promise<SseEvent[]> {
  if (body === null) throw new Error('SSE response has no body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = '';
  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf('\n\n');
    while (separator !== -1 && events.length < count) {
      const block = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const parsed = parseSseBlock(block);
      if (parsed !== undefined) events.push(parsed);
      separator = buffer.indexOf('\n\n');
    }
  }
  await reader.cancel();
  return events;
}

describe('GET /sessions/:sessionId/terminals/:terminalId/stream', () => {
  it('快照与订阅之间的竞态窗口内产生的事件不丢且顺序正确', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 5',
      cwd: '/tmp',
    });
    const app = await buildApp();
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    const token = app.jwt.sign({ sub: USER_ID, email: `${USER_ID}@example.com` });

    const raceData = 'race-window-output';
    const raceSeq = 7;
    // Fires synchronously from inside getTerminalOutputSnapshot, i.e. exactly
    // in the gap between the snapshot being captured and the subscription
    // becoming active in the buggy ordering.
    raceWindow.onSnapshot = () => {
      const event: RunEvent = {
        type: 'terminal_output',
        terminalId: record.terminalId,
        seq: raceSeq,
        data: raceData,
        outputTail: raceData,
        outputBytesTotal: raceSeq,
        occurredAt: Date.now(),
      };
      runEvents.publishSessionRunEvent(SESSION_ID, event);
    };

    const controller = new AbortController();
    const response = await fetch(
      `${address}/sessions/${SESSION_ID}/terminals/${record.terminalId}/stream?token=${encodeURIComponent(token)}`,
      { signal: controller.signal },
    );
    expect(response.status).toBe(200);
    const events = await readSseEvents(response.body, 2);
    controller.abort();
    await app.close();

    expect(events[0]?.event).toBe('snapshot');
    expect(events[1]?.event).toBe('output');
    const outputPayload = JSON.parse(events[1]!.data) as { terminalId: string; data?: string };
    expect(outputPayload.terminalId).toBe(record.terminalId);
    expect(outputPayload.data).toBe(raceData);
    const occurrences = events.filter(
      (entry) =>
        entry.event === 'output' &&
        (JSON.parse(entry.data) as { data?: string }).data === raceData,
    );
    expect(occurrences).toHaveLength(1);
  });
});
