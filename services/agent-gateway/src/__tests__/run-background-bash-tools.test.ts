/**
 * Background bash dispatcher coverage.
 *
 * Exercises the full lifecycle: spawn → poll via bash_output → kill
 * via bash_kill → post-kill status check. Real spawn so we can observe
 * that fire-and-forget + registry bookkeeping holds end to end.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../db.js';
import type * as BgModule from '../run-background-bash-tools.js';
import type * as RegistryModule from '../session-terminal-registry.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

vi.mock('../session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let bg: typeof BgModule;
let registry: typeof RegistryModule;

const USER_ID = 'u-bg';
const SESSION_ID = 's-bg';
const OTHER_SESSION_ID = 's-bg-other';

let workdir: string;

function seed(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'bg@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'other')", [
    OTHER_SESSION_ID,
    USER_ID,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../db.js');
  bg = await import('../run-background-bash-tools.js');
  registry = await import('../session-terminal-registry.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  seed();
  workdir = await mkdtemp(path.join(tmpdir(), 'openAwork-bg-bash-'));
});

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true });
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
});

async function waitForStatus(
  terminalId: string,
  expected: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = registry.getTerminal(terminalId, USER_ID);
    if (row && row.status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  const actual = registry.getTerminal(terminalId, USER_ID)?.status ?? 'missing';
  throw new Error(`Timed out waiting for status=${expected}; actual=${actual}`);
}

describe('dispatchRunBashInBackground', () => {
  it('returns a terminalId immediately and the command exits on its own', async () => {
    const result = await bg.dispatchRunBashInBackground({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: {
        command: 'echo bg-probe-ok',
        description: 'bg probe',
        workdir,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.output.terminalId).toMatch(/^term_/);
    expect(result.output.command).toBe('echo bg-probe-ok');

    await waitForStatus(result.output.terminalId, 'exited');
    const row = registry.getTerminal(result.output.terminalId, USER_ID);
    expect(row?.outputTail).toContain('bg-probe-ok');
    expect(row?.exitCode).toBe(0);
  });

  it('rejects when the per-session active background ceiling is hit', async () => {
    // Register 8 dummy active background rows (the default max).
    const live: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const r = registry.registerTerminal({
        sessionId: SESSION_ID,
        userId: USER_ID,
        toolName: 'run_bash_in_background',
        kind: 'background',
        command: `sleep ${i}`,
        cwd: workdir,
      });
      live.push(r.terminalId);
    }
    const result = await bg.dispatchRunBashInBackground({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: {
        command: 'echo should-not-spawn',
        description: 'ceiling probe',
        workdir,
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.error).toContain('上限');
  });
});

describe('dispatchBashOutput', () => {
  it('returns a 404-ish error for unknown terminalId', () => {
    const result = bg.dispatchBashOutput({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { terminal_id: 'term_does_not_exist' },
    });
    expect(result.ok).toBe(false);
  });

  it('refuses cross-session terminal lookup', async () => {
    const spawn = await bg.dispatchRunBashInBackground({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { command: 'echo cross-probe', description: 'cross', workdir },
    });
    if (!spawn.ok) throw new Error('spawn failed');
    await waitForStatus(spawn.output.terminalId, 'exited');
    const result = bg.dispatchBashOutput({
      context: { sessionId: OTHER_SESSION_ID, userId: USER_ID },
      rawInput: { terminal_id: spawn.output.terminalId },
    });
    expect(result.ok).toBe(false);
  });

  it('returns the latest outputTail and status for a known terminal', async () => {
    const spawn = await bg.dispatchRunBashInBackground({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { command: 'echo live-probe', description: 'live', workdir },
    });
    if (!spawn.ok) throw new Error('spawn failed');
    await waitForStatus(spawn.output.terminalId, 'exited');
    const out = bg.dispatchBashOutput({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { terminal_id: spawn.output.terminalId },
    });
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('expected ok');
    expect(out.output.status).toBe('exited');
    expect(out.output.exitCode).toBe(0);
    expect(out.output.outputTail).toContain('live-probe');
  });
});

describe('dispatchBashKill', () => {
  it('kills a running background terminal and reports killed=true', async () => {
    const spawn = await bg.dispatchRunBashInBackground({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { command: 'sleep 5', description: 'long probe', workdir },
    });
    if (!spawn.ok) throw new Error('spawn failed');
    // Let spawn actually establish so the abortController wires up.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const killed = bg.dispatchBashKill({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { terminal_id: spawn.output.terminalId },
    });
    expect(killed.ok).toBe(true);
    if (!killed.ok) throw new Error('expected ok');
    expect(killed.output.found).toBe(true);
    expect(killed.output.killed).toBe(true);

    // The underlying spawn resolution flips the row to aborted.
    await waitForStatus(spawn.output.terminalId, 'aborted');
  });

  it('reports found=false for unknown terminalId', () => {
    const result = bg.dispatchBashKill({
      context: { sessionId: SESSION_ID, userId: USER_ID },
      rawInput: { terminal_id: 'term_does_not_exist' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.output.found).toBe(false);
  });
});
