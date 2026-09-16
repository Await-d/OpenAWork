/**
 * Unit coverage for the session terminal registry.
 *
 * Uses a real in-memory SQLite via `db.migrate()` so DB writes exercise
 * the production schema. We mute `publishSessionRunEvent` because the
 * notification pipeline and message-store mirror are heavier than the
 * registry contract — we test the registry semantics, not the event bus.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamTerminalOutputChunk } from '@openAwork/shared';
import type * as DbModule from '../../infra/db.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';
import type * as RunEventsModule from '../../session/session-run-events.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let registry: typeof RegistryModule;
let runEvents: typeof RunEventsModule;

const USER_ID = 'u-term-1';
const OTHER_USER_ID = 'u-term-2';
const SESSION_ID = 's-term-1';

function seedUserAndSession(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'a@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    OTHER_USER_ID,
    'b@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  registry = await import('../../session/session-terminal-registry.js');
  runEvents = await import('../../session/session-run-events.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  seedUserAndSession();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
});

describe('registerTerminal', () => {
  it('creates a session_terminals row with running status and broadcasts terminal_started', async () => {
    const { publishSessionRunEvent } = await import('../../session/session-run-events.js');
    const before = registry.listSessionTerminals({ sessionId: SESSION_ID, userId: USER_ID });
    expect(before).toHaveLength(0);

    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'echo hi',
      description: 'sanity probe',
      cwd: '/tmp',
    });

    expect(record.terminalId).toMatch(/^term_/);
    expect(record.status).toBe('running');
    expect(record.outputBytesTotal).toBe(0);
    expect(record.outputTail).toBe('');

    const list = registry.listSessionTerminals({ sessionId: SESSION_ID, userId: USER_ID });
    expect(list).toHaveLength(1);
    expect(list[0]?.command).toBe('echo hi');

    const startedCall = vi.mocked(publishSessionRunEvent).mock.calls.find((call) => {
      const [, event] = call;
      return (
        event !== undefined &&
        typeof event === 'object' &&
        'type' in event &&
        event.type === 'terminal_started'
      );
    });
    expect(startedCall).toBeDefined();
    expect(startedCall?.[0]).toBe(SESSION_ID);
    const startedEvent = startedCall?.[1] as { terminalId?: string };
    expect(startedEvent.terminalId).toBe(record.terminalId);
  });

  it('records pid when setTerminalPid is called', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'true',
      cwd: '/tmp',
    });
    registry.setTerminalPid(record.terminalId, 12345);
    const fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.pid).toBe(12345);
  });

  it('registers a tmux-spawned pseudo-terminal that shows up in the active list', async () => {
    const { publishSessionRunEvent } = await import('../../session/session-run-events.js');
    vi.mocked(publishSessionRunEvent).mockClear();

    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'interactive_bash',
      kind: 'tmux',
      command: 'new-session -d -s foo',
      cwd: process.cwd(),
      initialStatus: 'tmux-spawned',
      terminalId: 'term_tmux_foo',
    });

    expect(record.status).toBe('tmux-spawned');
    // tmux sessions are pseudo-terminals we don't own a pid for, so they
    // stay in the active list (includeClosed=false) until kill-session.
    const active = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: false,
    });
    expect(active.map((t) => t.terminalId)).toContain('term_tmux_foo');
    const events = vi
      .mocked(publishSessionRunEvent)
      .mock.calls.map((c) => (c[1] as { type?: string } | undefined)?.type);
    expect(events).toContain('terminal_started');
  });
});

describe('appendTerminalOutput', () => {
  it('updates outputTail and outputBytesTotal cumulatively', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 0.1',
      cwd: '/tmp',
    });

    registry.appendTerminalOutput(record.terminalId, 'line 1\n');
    let fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.outputBytesTotal).toBe(Buffer.byteLength('line 1\n', 'utf-8'));
    expect(fetched?.outputTail).toBe('line 1\n');

    registry.appendTerminalOutput(record.terminalId, 'line 1\nline 2\n');
    fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.outputBytesTotal).toBeGreaterThan(7);
    expect(fetched?.outputTail).toContain('line 2');
  });

  it('truncates output_tail to TERMINAL_OUTPUT_TAIL_BYTES on utf-8 boundary', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'yes',
      cwd: '/tmp',
    });
    const big = 'a'.repeat(registry.TERMINAL_OUTPUT_TAIL_BYTES + 5_000);
    registry.appendTerminalOutput(record.terminalId, big);
    const fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.outputBytesTotal).toBe(big.length);
    expect(Buffer.byteLength(fetched?.outputTail ?? '', 'utf-8')).toBeLessThanOrEqual(
      registry.TERMINAL_OUTPUT_TAIL_BYTES,
    );
  });
});

describe('markTerminalExited', () => {
  it('flips status and stamps endedAtMs / exitCode', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'true',
      cwd: '/tmp',
    });
    registry.markTerminalExited({
      terminalId: record.terminalId,
      status: 'exited',
      exitCode: 0,
      finalSnapshot: 'ok\n',
    });
    const fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.status).toBe('exited');
    expect(fetched?.exitCode).toBe(0);
    expect(fetched?.endedAtMs).toBeGreaterThan(0);
    expect(fetched?.outputTail).toBe('ok\n');
  });
});

describe('killTerminal', () => {
  it('returns alreadyClosed=true for a terminal that already exited', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'true',
      cwd: '/tmp',
    });
    registry.markTerminalExited({ terminalId: record.terminalId, status: 'exited', exitCode: 0 });
    const result = registry.killTerminal({ terminalId: record.terminalId, userId: USER_ID });
    expect(result).toEqual({ found: true, alreadyClosed: true, killed: false });
  });

  it('returns found=false for an unknown terminal', () => {
    const result = registry.killTerminal({ terminalId: 'term_does_not_exist', userId: USER_ID });
    expect(result).toEqual({ found: false, alreadyClosed: false, killed: false });
  });

  it('triggers the stored AbortController on a running terminal', () => {
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
    const result = registry.killTerminal({ terminalId: record.terminalId, userId: USER_ID });
    expect(result.found).toBe(true);
    expect(result.alreadyClosed).toBe(false);
    expect(result.killed).toBe(true);
    expect(ac.signal.aborted).toBe(true);
  });

  it('refuses to expose terminals owned by another user', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 1',
      cwd: '/tmp',
    });
    const result = registry.killTerminal({
      terminalId: record.terminalId,
      userId: OTHER_USER_ID,
    });
    expect(result.found).toBe(false);
  });
});

describe('listSessionTerminals', () => {
  it('returns running-only when includeClosed=false', () => {
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
      command: 'echo ok',
      cwd: '/tmp',
    });
    registry.markTerminalExited({ terminalId: closed.terminalId, status: 'exited', exitCode: 0 });

    const all = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: true,
    });
    expect(all.map((t) => t.terminalId).sort()).toEqual(
      [running.terminalId, closed.terminalId].sort(),
    );

    const onlyRunning = registry.listSessionTerminals({
      sessionId: SESSION_ID,
      userId: USER_ID,
      includeClosed: false,
    });
    expect(onlyRunning.map((t) => t.terminalId)).toEqual([running.terminalId]);
  });
});

describe('reconcileStaleRunningTerminalsAtBoot', () => {
  it('flips all running rows to stale', () => {
    registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 1',
      cwd: '/tmp',
    });
    registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 2',
      cwd: '/tmp',
    });
    const updated = registry.reconcileStaleRunningTerminalsAtBoot();
    expect(updated).toBe(2);
    const stale = registry
      .listSessionTerminals({ sessionId: SESSION_ID, userId: USER_ID })
      .filter((t) => t.status === 'stale');
    expect(stale).toHaveLength(2);
    for (const row of stale) {
      expect(row.endedAtMs).toBeGreaterThan(0);
    }
  });
});

describe('deleteTerminalRecord', () => {
  it('refuses to delete a running terminal', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'sleep 1',
      cwd: '/tmp',
    });
    const result = registry.deleteTerminalRecord({
      terminalId: record.terminalId,
      userId: USER_ID,
    });
    expect(result).toEqual({ found: true, deleted: false, refusedRunning: true });
  });

  it('deletes a closed terminal', () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'bash',
      kind: 'foreground',
      command: 'true',
      cwd: '/tmp',
    });
    registry.markTerminalExited({ terminalId: record.terminalId, status: 'exited', exitCode: 0 });
    const result = registry.deleteTerminalRecord({
      terminalId: record.terminalId,
      userId: USER_ID,
    });
    expect(result).toEqual({ found: true, deleted: true, refusedRunning: false });
    expect(registry.getTerminal(record.terminalId, USER_ID)).toBeNull();
  });
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function outputChunks(): StreamTerminalOutputChunk[] {
  return vi
    .mocked(runEvents.publishSessionRunEvent)
    .mock.calls.map((call) => call[1])
    .filter(
      (event): event is StreamTerminalOutputChunk =>
        typeof event === 'object' &&
        event !== null &&
        (event as { type?: unknown }).type === 'terminal_output',
    );
}

function registerProbe(command = 'probe'): RegistryModule.SessionTerminalRecord {
  return registry.registerTerminal({
    sessionId: SESSION_ID,
    userId: USER_ID,
    toolName: 'bash',
    kind: 'foreground',
    command,
    cwd: '/tmp',
  });
}

describe('terminal output ring buffer and seq', () => {
  beforeEach(() => {
    vi.mocked(runEvents.publishSessionRunEvent).mockClear();
  });

  it('emits incrementing seq with incremental data and merges throttled deltas in order', async () => {
    const record = registerProbe();
    registry.appendTerminalOutputDelta(record.terminalId, 'alpha');
    registry.appendTerminalOutputDelta(record.terminalId, 'beta');
    registry.appendTerminalOutputDelta(record.terminalId, 'gamma');
    await delay(160);

    const chunks = outputChunks();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const seqs = chunks.map((chunk) => chunk.seq ?? 0);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1]!);
    }
    expect(chunks.map((chunk) => chunk.data ?? '').join('')).toBe('alphabetagamma');
    const last = chunks[chunks.length - 1]!;
    expect(last.seq).toBe(last.outputBytesTotal);
    expect(last.outputBytesTotal).toBe(Buffer.byteLength('alphabetagamma', 'utf-8'));
    expect(last.outputTail).toBe('alphabetagamma');
  });

  it('preserves order when several deltas land inside one throttle window', async () => {
    const record = registerProbe();
    registry.appendTerminalOutputDelta(record.terminalId, 'first-');
    registry.appendTerminalOutputDelta(record.terminalId, 'second-');
    registry.appendTerminalOutputDelta(record.terminalId, 'third');
    await delay(160);

    const joined = outputChunks()
      .map((chunk) => chunk.data ?? '')
      .join('');
    expect(joined).toBe('first-second-third');
    const snapshot = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(snapshot?.data).toBe('first-second-third');
    expect(snapshot?.outputBytesTotal).toBe(Buffer.byteLength('first-second-third', 'utf-8'));
  });

  it('returns null from getTerminalOutputSnapshot for an unknown terminal', () => {
    expect(registry.getTerminalOutputSnapshot('term_missing')).toBeNull();
  });

  it('bounds the ring buffer and snaps the dropped head to a utf-8 boundary', () => {
    const record = registerProbe();
    const ringBytes = registry.TERMINAL_OUTPUT_RING_BYTES;
    const unit = '€';
    const unitBytes = Buffer.byteLength(unit, 'utf-8');
    const content = unit.repeat(Math.ceil((ringBytes + 2) / unitBytes));
    registry.appendTerminalOutputDelta(record.terminalId, content);

    const snapshot = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(snapshot).not.toBeNull();
    expect(Buffer.byteLength(snapshot!.data, 'utf-8')).toBeLessThanOrEqual(ringBytes);
    expect(snapshot!.data).not.toContain('\uFFFD');
    expect(snapshot!.data.startsWith(unit)).toBe(true);
    expect(snapshot!.data.endsWith(unit)).toBe(true);
    expect(snapshot!.seq).toBe(Buffer.byteLength(content, 'utf-8'));
  });

  it('converts the legacy cumulative snapshot path into ordered deltas', async () => {
    const record = registerProbe();
    registry.appendTerminalOutput(record.terminalId, 'one\n');
    registry.appendTerminalOutput(record.terminalId, 'one\ntwo\n');
    registry.appendTerminalOutput(record.terminalId, 'one\ntwo\nthree\n');
    await delay(160);

    const expected = 'one\ntwo\nthree\n';
    expect(
      outputChunks()
        .map((chunk) => chunk.data ?? '')
        .join(''),
    ).toBe(expected);
    const fetched = registry.getTerminal(record.terminalId, USER_ID);
    expect(fetched?.outputBytesTotal).toBe(Buffer.byteLength(expected, 'utf-8'));
    expect(fetched?.outputTail).toBe(expected);
    expect(registry.getTerminalOutputSnapshot(record.terminalId)?.data).toBe(expected);
  });

  it('re-sends the whole snapshot when the cumulative text shrinks', () => {
    const record = registerProbe();
    registry.appendTerminalOutput(record.terminalId, 'abcdef');
    registry.appendTerminalOutput(record.terminalId, 'xy');

    const snapshot = registry.getTerminalOutputSnapshot(record.terminalId);
    expect(snapshot?.data).toBe('abcdefxy');
    expect(snapshot?.seq).toBe(Buffer.byteLength('abcdefxy', 'utf-8'));
  });
});
