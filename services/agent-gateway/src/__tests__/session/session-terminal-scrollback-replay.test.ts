/**
 * T-12 — scrollback recovery: the ring buffer must be able to replay history
 * after a refresh / SSE reconnect.
 *
 * Two layers are covered:
 *   1. Registry-level: `getTerminalOutputSnapshot` returns the bounded ring
 *      content with a UTF-8-safe head and the correct `seq` / byte totals.
 *   2. Route-level: the `/stream` snapshot SSE payload is exactly
 *      `{ terminalId, seq, data, outputBytesTotal, status }` and matches what
 *      the registry reports.
 */

import { request } from 'node:http';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionTerminalsRoutesModule from '../../routes/session-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionTerminalsRoutes: typeof SessionTerminalsRoutesModule.sessionTerminalsRoutes;
let registry: typeof RegistryModule;

const USER_ID = 'u-scrollback';
const SESSION_ID = 's-scrollback';

function registerProbe(command = 'scrollback probe'): RegistryModule.SessionTerminalRecord {
  return registry.registerTerminal({
    sessionId: SESSION_ID,
    userId: USER_ID,
    toolName: 'bash',
    kind: 'foreground',
    command,
    cwd: '/tmp',
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
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'scrollback@openawork.local',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'rb')", [
    SESSION_ID,
    USER_ID,
  ]);
});

describe('getTerminalOutputSnapshot replay', () => {
  it('replays all buffered output and keeps seq === outputBytesTotal === byte length', () => {
    const record = registerProbe();
    const text = 'A'.repeat(64 * 1024);
    registry.appendTerminalOutputDelta(record.terminalId, text);

    const snapshot = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.data).toBe(text);
    const bytes = Buffer.byteLength(text, 'utf-8');
    expect(snapshot!.seq).toBe(bytes);
    expect(snapshot!.outputBytesTotal).toBe(bytes);
  });

  it('bounds the ring to TERMINAL_OUTPUT_RING_BYTES with a utf-8 safe head', () => {
    const record = registerProbe();
    const ringBytes = registry.TERMINAL_OUTPUT_RING_BYTES;
    const unit = '中';
    const unitBytes = Buffer.byteLength(unit, 'utf-8');
    const content = unit.repeat(Math.ceil((ringBytes + 5) / unitBytes));
    registry.appendTerminalOutputDelta(record.terminalId, content);

    const snapshot = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(snapshot).not.toBeNull();
    const keptBytes = Buffer.byteLength(snapshot!.data, 'utf-8');
    expect(keptBytes).toBeLessThanOrEqual(ringBytes);
    expect(keptBytes).toBeGreaterThan(ringBytes - unitBytes);

    const first = Buffer.from(snapshot!.data, 'utf-8')[0]!;
    expect(first & 0b1100_0000).not.toBe(0b1000_0000);
    expect(snapshot!.data).not.toContain('\uFFFD');
    expect(snapshot!.data.startsWith(unit)).toBe(true);
    expect(snapshot!.data.endsWith(unit)).toBe(true);
    expect(snapshot!.seq).toBe(Buffer.byteLength(content, 'utf-8'));
  });

  it('returns null for a terminal that is no longer live', () => {
    expect(registry.getTerminalOutputSnapshot('term_not_live')).toBeNull();
  });
});

interface SnapshotPayload {
  terminalId?: unknown;
  seq?: unknown;
  data?: unknown;
  outputBytesTotal?: unknown;
  status?: unknown;
}

function fetchSnapshot(input: {
  port: number;
  sessionId: string;
  terminalId: string;
  token: string;
}): Promise<SnapshotPayload> {
  return new Promise((resolve, reject) => {
    const url =
      `http://127.0.0.1:${input.port}/sessions/${input.sessionId}/terminals/` +
      `${input.terminalId}/stream?token=${encodeURIComponent(input.token)}`;
    const req = request(url, (res) => {
      let buffer = '';
      const timer = setTimeout(() => {
        req.destroy();
        reject(new Error('timed out waiting for snapshot event'));
      }, 5_000);
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        const match = /event: snapshot\ndata: (.*)\n\n/.exec(buffer);
        if (match && typeof match[1] === 'string') {
          clearTimeout(timer);
          req.destroy();
          resolve(JSON.parse(match[1]) as SnapshotPayload);
        }
      });
      res.on('error', () => {
        clearTimeout(timer);
      });
    });
    req.on('error', (error) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    req.end();
  });
}

describe('SSE snapshot payload', () => {
  it('transmits the ring snapshot as {terminalId, seq, data, outputBytesTotal, status}', async () => {
    const record = registerProbe('snapshot route');
    registry.appendTerminalOutputDelta(record.terminalId, 'scrollback-snapshot-line\n');
    const expected = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(expected).not.toBeNull();

    const app: FastifyInstance = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(sessionTerminalsRoutes);
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });

    try {
      const address = app.server.address();
      if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP address from the gateway test server');
      }
      const token = app.jwt.sign({ sub: USER_ID, email: 'scrollback@openawork.local' });
      const payload = await fetchSnapshot({
        port: address.port,
        sessionId: SESSION_ID,
        terminalId: record.terminalId,
        token,
      });

      expect(Object.keys(payload).sort()).toEqual(
        ['data', 'outputBytesTotal', 'seq', 'status', 'terminalId'].sort(),
      );
      expect(payload.terminalId).toBe(record.terminalId);
      expect(payload.seq).toBe(expected!.seq);
      expect(payload.data).toBe(expected!.data);
      expect(payload.outputBytesTotal).toBe(expected!.outputBytesTotal);
      expect(payload.status).toBe('running');
    } finally {
      await app.close();
    }
  });
});
