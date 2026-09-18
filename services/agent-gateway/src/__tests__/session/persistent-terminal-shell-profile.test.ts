/**
 * Integration coverage for `spawnPersistentTerminal` shell-profile selection.
 *
 * `node:child_process` is mocked so no real shell is spawned; the assertions
 * cover the server-side resolution path and the persisted metadata shape.
 */

import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as PersistentTerminalsModule from '../../session/persistent-terminals.js';
import type * as ShellProfilesModule from '../../session/shell-profiles.js';
import { resolveShellChoiceForPlatform } from '../../tools/shell-choice.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

interface SpawnCall {
  shell: string;
  args: string[];
}

const spawnState = vi.hoisted(() => ({ calls: [] as SpawnCall[] }));

class FakeChild extends EventEmitter {
  pid = Math.floor(Math.random() * 100000) + 1000;
  stdin = { write: () => true, end: () => undefined };
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill(): boolean {
    return true;
  }
}

vi.mock('node:child_process', () => ({
  spawn: (shell: string, args: string[]) => {
    spawnState.calls.push({ shell, args });
    return new FakeChild();
  },
  spawnSync: () => ({ status: 1, error: null }),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
}));

let dbModule: typeof DbModule;
let mod: typeof PersistentTerminalsModule;
let shellProfiles: typeof ShellProfilesModule;

const USER_ID = 'u-term-shell-spawn';
const SESSION_ID = 's-term-shell-spawn';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  mod = await import('../../session/persistent-terminals.js');
  shellProfiles = await import('../../session/shell-profiles.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'shell-spawn@example.com',
  ]);
  dbModule.sqliteRun("INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES (?, ?, 'demo')", [
    SESSION_ID,
    USER_ID,
  ]);
});

beforeEach(() => {
  spawnState.calls.length = 0;
});

afterEach(() => {
  mod.__resetPersistentTerminalsForTest();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('spawnPersistentTerminal shell profiles', () => {
  it('keeps the runtime default and writes no shellProfileId when none is requested', () => {
    const { terminal } = mod.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: '/tmp',
      source: 'user',
    });

    const expectedDefault = resolveShellChoiceForPlatform(process.platform, process.env).shell;
    expect(terminal.metadata['shell']).toBe(expectedDefault);
    expect(terminal.metadata['shellProfileId']).toBeUndefined();
    expect(spawnState.calls[0]?.shell).toBe(expectedDefault);
  });

  it('spawns the allowlisted executable and persists metadata.shellProfileId', () => {
    const profiles = shellProfiles.listPublicShellProfiles(process.platform, process.env);
    if (profiles.length === 0) return;
    const chosen = profiles.find((profile) => profile.isDefault) ?? profiles[0]!;
    const resolved = shellProfiles.resolveShellProfile(chosen.id, process.platform, process.env);
    expect(resolved).toBeDefined();

    const { terminal } = mod.spawnPersistentTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      cwd: '/tmp',
      source: 'user',
      shellProfileId: chosen.id,
    });

    expect(terminal.metadata['shellProfileId']).toBe(chosen.id);
    expect(terminal.metadata['shell']).toBe(resolved!.shell);
    expect(spawnState.calls[0]?.shell).toBe(resolved!.shell);
    expect(spawnState.calls[0]?.args).toEqual(
      resolved!.isPowerShell ? ['-NoLogo', '-NoProfile'] : ['-i'],
    );
  });

  it('throws InvalidShellProfileError for an unknown id and never spawns', () => {
    expect(() =>
      mod.spawnPersistentTerminal({
        sessionId: SESSION_ID,
        userId: USER_ID,
        cwd: '/tmp',
        source: 'user',
        shellProfileId: '/bin/evil',
      }),
    ).toThrow(shellProfiles.InvalidShellProfileError);
    expect(spawnState.calls).toHaveLength(0);
  });
});
