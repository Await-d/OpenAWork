/**
 * HTTP coverage for `/sessions/:sessionId/terminals` routes.
 *
 * Uses Fastify inject + the real auth + DB stack so the path enforces
 * session ownership and returns rows the registry actually wrote.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionTerminalsRoutesModule from '../../routes/session-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionTerminalsRoutes: typeof SessionTerminalsRoutesModule.sessionTerminalsRoutes;
let registry: typeof RegistryModule;

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
});
