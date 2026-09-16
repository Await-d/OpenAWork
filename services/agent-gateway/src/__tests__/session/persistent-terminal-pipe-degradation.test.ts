/**
 * T-10 — Node runtime pipe-degradation regression.
 *
 * Under Node there is no built-in PTY, so `detectTerminalBackend()` must
 * report `kind: 'pipe'` with a reason and the persistent-terminal API must
 * keep working over piped stdio. These cases are skipped when the suite is
 * run under Bun (where a real PTY is available), mirroring the PTY-only
 * skips in `pty-backend.test.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { StreamTerminalOutputChunk } from '@openAwork/shared';
import type * as DbModule from '../../infra/db.js';
import type * as PtyBackendModule from '../../session/pty-backend.js';
import type * as PersistentModule from '../../session/persistent-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';
import type * as RunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const bunAvailable = typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined';
const ptySupported = bunAvailable && process.platform !== 'win32';
const itPipe = ptySupported ? it.skip : it;

let dbModule: typeof DbModule;
let ptyBackend: typeof PtyBackendModule;
let persistent: typeof PersistentModule;
let registry: typeof RegistryModule;
let runEvents: typeof RunEventsModule;

const USER_ID = 'u-pipe-degrade';
const SESSION_ID = 's-pipe-degrade';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForMarker(
  terminalId: string,
  marker: string,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = registry.getTerminalOutputSnapshot(terminalId);
    if (snapshot && snapshot.data.includes(marker)) return snapshot.data;
    await delay(80);
  }
  throw new Error(`timeout waiting for marker ${marker}`);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  ptyBackend = await import('../../session/pty-backend.js');
  persistent = await import('../../session/persistent-terminals.js');
  registry = await import('../../session/session-terminal-registry.js');
  runEvents = await import('../../session/session-run-events.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'pipe-degrade@openawork.local',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'pipe')", [
    SESSION_ID,
    USER_ID,
  ]);
});

afterAll(async () => {
  persistent.__resetPersistentTerminalsForTest();
  const deadline = Date.now() + 5_000;
  while (registry.__liveTerminalCountForTest() > 0 && Date.now() < deadline) {
    await delay(50);
  }
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
});

describe('Node pipe degradation', () => {
  it('detects the pipe backend with a non-empty reason under Node', () => {
    const capabilities = ptyBackend.detectTerminalBackend();
    if (ptySupported) {
      expect(capabilities.kind).toBe('pty');
      return;
    }
    expect(capabilities.kind).toBe('pipe');
    expect(capabilities.runtime).toBe('node');
    expect(capabilities.supportsResize).toBe(false);
    expect(typeof capabilities.reason).toBe('string');
    expect((capabilities.reason ?? '').length).toBeGreaterThan(0);
  });

  itPipe('streams shell output, accepts stdin, and reports resize as ok no-op', async () => {
    const { terminal } = persistent.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: process.cwd(),
      source: 'user',
    });

    try {
      const writeResult = persistent.writeStdinToTerminal(terminal.terminalId, 'echo PIPE_ECHO_OK\n');
      expect(writeResult.ok).toBe(true);

      const output = await waitForMarker(terminal.terminalId, 'PIPE_ECHO_OK');
      expect(output).toContain('PIPE_ECHO_OK');

      const resizeResult = persistent.resizeTerminal({
        terminalId: terminal.terminalId,
        cols: 140,
        rows: 50,
      });
      expect(resizeResult).toEqual({ ok: true });

      const secondWrite = persistent.writeStdinToTerminal(
        terminal.terminalId,
        'echo PIPE_AFTER_RESIZE\n',
      );
      expect(secondWrite.ok).toBe(true);
      const afterResize = await waitForMarker(terminal.terminalId, 'PIPE_AFTER_RESIZE');
      expect(afterResize).not.toContain('\uFFFD');
    } finally {
      persistent.closePersistentTerminal(terminal.terminalId);
    }
  });

  itPipe('emits monotonic seq with incremental data matching the ring snapshot', async () => {
    const events: StreamTerminalOutputChunk[] = [];
    const unsubscribe = runEvents.subscribeSessionRunEvents(SESSION_ID, (event) => {
      if (event.type === 'terminal_output') events.push(event);
    });

    const { terminal } = persistent.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: process.cwd(),
      source: 'user',
    });

    try {
      persistent.writeStdinToTerminal(terminal.terminalId, 'echo PIPE_SEQ_ONE\n');
      await waitForMarker(terminal.terminalId, 'PIPE_SEQ_ONE');
      persistent.writeStdinToTerminal(terminal.terminalId, 'echo PIPE_SEQ_TWO\n');
      await waitForMarker(terminal.terminalId, 'PIPE_SEQ_TWO');
      await delay(300);

      const terminalEvents = events.filter((event) => event.terminalId === terminal.terminalId);
      expect(terminalEvents.length).toBeGreaterThan(0);
      let previousSeq = -1;
      for (const event of terminalEvents) {
        expect(typeof event.seq).toBe('number');
        expect(typeof event.data).toBe('string');
        expect(event.seq! > previousSeq).toBe(true);
        previousSeq = event.seq!;
      }

      const concatenated = terminalEvents.map((event) => event.data ?? '').join('');
      const snapshot = registry.getTerminalOutputSnapshot(terminal.terminalId);
      expect(snapshot).not.toBeNull();
      expect(concatenated).toBe(snapshot!.data);
      const last = terminalEvents[terminalEvents.length - 1]!;
      expect(last.seq).toBe(snapshot!.seq);
      expect(last.outputBytesTotal).toBe(last.seq);
    } finally {
      unsubscribe();
      persistent.closePersistentTerminal(terminal.terminalId);
    }
  });
});
