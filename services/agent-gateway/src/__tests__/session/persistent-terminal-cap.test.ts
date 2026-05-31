/**
 * Regression: spawnPersistentTerminal must enforce a per-session concurrency
 * cap. Before the fix it spawned a shell on every call with no ceiling, so a
 * runaway frontend retry loop or malicious client hammering
 * `POST /sessions/:id/terminals` could spawn unbounded child processes and
 * exhaust the host's PIDs / file descriptors. The cap is checked against the
 * live in-memory entries, so a terminal exiting frees a slot again.
 *
 * We mock node:child_process so no real shells are spawned (which would emit
 * async `exit` events writing to the DB after teardown); a fake child lets us
 * deterministically simulate a terminal exiting to free its slot.
 */

import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PersistentTerminalsModule from '../../session/persistent-terminals.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
// Small cap so the test exercises the limit with few spawns.
process.env['OPENAWORK_MAX_PERSISTENT_TERMINALS_PER_SESSION'] = '2';

class FakeChild extends EventEmitter {
  pid = Math.floor(Math.random() * 100000) + 1000;
  stdin = { write: () => true, end: () => undefined };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(): boolean {
    return true;
  }
}

const spawnedChildren: FakeChild[] = [];

vi.mock('node:child_process', () => ({
  spawn: () => {
    const child = new FakeChild();
    spawnedChildren.push(child);
    return child;
  },
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let mod: typeof PersistentTerminalsModule;

const USER_ID = 'u-term-cap';
const SESSION_ID = 's-term-cap';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  mod = await import('../../session/persistent-terminals.js');
});

beforeEach(() => {
  spawnedChildren.length = 0;
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'cap@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
});

afterEach(() => {
  mod.__resetPersistentTerminalsForTest();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('spawnPersistentTerminal per-session cap', () => {
  it('达到上限后再 spawn 抛 PersistentTerminalLimitError，终端退出后释放名额可再 spawn', () => {
    const spawnOne = () =>
      mod.spawnPersistentTerminal({
        sessionId: SESSION_ID,
        userId: USER_ID,
        cwd: '/tmp',
        source: 'user',
      });

    const first = spawnOne();
    spawnOne();
    expect(first.terminal.terminalId).toBeTruthy();

    // Third exceeds the cap of 2.
    expect(() => spawnOne()).toThrow(mod.PersistentTerminalLimitError);

    // Simulate the first terminal's shell exiting → its exit handler removes
    // it from the live map, freeing a slot.
    spawnedChildren[0]!.emit('exit', 0, null);
    const replacement = spawnOne();
    expect(replacement.terminal.terminalId).toBeTruthy();
  });

  it('不同 session 各自独立计数，互不影响', () => {
    const other = 's-term-cap-2';
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')",
      [other, USER_ID],
    );

    mod.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: '/tmp',
      source: 'user',
    });
    mod.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: '/tmp',
      source: 'user',
    });
    // SESSION_ID is at cap; a different session still has its full budget.
    expect(() =>
      mod.spawnPersistentTerminal({
        sessionId: other,
        userId: USER_ID,
        cwd: '/tmp',
        source: 'user',
      }),
    ).not.toThrow();
  });
});
