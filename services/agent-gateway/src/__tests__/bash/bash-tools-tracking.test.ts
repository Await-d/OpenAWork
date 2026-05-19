/**
 * End-to-end coverage for bash-tools' session_terminals tracking.
 *
 * These tests spawn real shell commands (like bash-tools.test.ts does)
 * but run against a real in-memory SQLite via `migrate()` so we can
 * observe the registry row created by `runBashCommand` + tracking.
 *
 * We verify three spawn outcomes land in the registry with the correct
 * final status: normal exit, external abort, and timeout.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as BashModule from '../../tools/bash-tools.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

// Silence publishSessionRunEvent — it walks message-store mirror paths
// that expect a fully-hydrated sessions row, which we seed just enough
// of for the registry rows themselves.
vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let bashModule: typeof BashModule;
let registry: typeof RegistryModule;

const USER_ID = 'u-bash-track';
const SESSION_ID = 's-bash-track';

let workdir: string;

function seed(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'u@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  bashModule = await import('../../tools/bash-tools.js');
  registry = await import('../../session/session-terminal-registry.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  seed();
  workdir = await mkdtemp(path.join(tmpdir(), 'openAwork-bash-track-'));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
});

describe('runBashCommand with tracking', () => {
  it('records status=exited and captures output tail on a normal run', async () => {
    const result = await bashModule.runBashCommand(
      { command: 'echo bash-tracking-probe', description: 'probe', workdir },
      {
        tracking: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          toolName: 'bash',
          kind: 'foreground',
        },
      },
    );
    expect(result.kind).toBe('exit');
    const rows = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: true,
    });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.status).toBe('exited');
    expect(row.exitCode).toBe(0);
    expect(row.toolName).toBe('bash');
    expect(row.kind).toBe('foreground');
    expect(row.command).toBe('echo bash-tracking-probe');
    expect(row.outputTail).toContain('bash-tracking-probe');
    expect(row.endedAtMs).toBeGreaterThan(0);
    expect(row.pid).toBeGreaterThan(0);
  });

  it('records status=aborted when the external signal aborts', async () => {
    const ac = new AbortController();
    const promise = bashModule.runBashCommand(
      { command: 'sleep 5', description: 'force abort', workdir },
      {
        signal: ac.signal,
        tracking: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          toolName: 'bash',
          kind: 'foreground',
          abortController: ac,
        },
      },
    );
    // Give spawn a tick so the abort handler registers.
    await new Promise((resolve) => setTimeout(resolve, 50));
    ac.abort();
    const result = await promise;
    expect(result.kind).toBe('aborted');
    const rows = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: true,
    });
    expect(rows[0]?.status).toBe('aborted');
  });

  it('records status=timeout when the command exceeds its timeout', async () => {
    const result = await bashModule.runBashCommand(
      {
        command: 'sleep 5',
        description: 'force timeout',
        workdir,
        timeout: 200,
      },
      {
        tracking: {
          sessionId: SESSION_ID,
          userId: USER_ID,
          toolName: 'bash',
          kind: 'foreground',
        },
      },
    );
    expect(result.kind).toBe('timeout');
    const rows = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: true,
    });
    expect(rows[0]?.status).toBe('timeout');
  });
});
