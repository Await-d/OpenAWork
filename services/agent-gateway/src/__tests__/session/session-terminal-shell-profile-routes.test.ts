/**
 * Route coverage for terminal shell-profile selection.
 *
 * Security boundary under test: the client only ever supplies an opaque
 * `shellProfileId`. A path-like or unknown id must be rejected with 400
 * `invalid_shell_profile` BEFORE the spawn function is reached, and the
 * profile-list endpoint must never leak a filesystem path.
 *
 * `spawnPersistentTerminal` and `resolveShellProfile` are mocked so the suite
 * never spawns a real shell and never depends on host shell detection.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as AuthModule from '../../infra/auth.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionTerminalsRoutesModule from '../../routes/session-terminals.js';
import type * as RegistryModule from '../../session/session-terminal-registry.js';
import type * as ShellProfilesModule from '../../session/shell-profiles.js';
import type * as PersistentTerminalsModule from '../../session/persistent-terminals.js';
import type {
  SpawnPersistentTerminalInput,
  SpawnPersistentTerminalResult,
} from '../../session/persistent-terminals.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const mocks = vi.hoisted(() => ({
  spawnPersistentTerminal: vi.fn(),
  resolveShellProfile: vi.fn(),
}));

vi.mock('../../session/session-run-events.js', () => ({
  publishSessionRunEvent: vi.fn(),
  subscribeSessionRunEvents: () => () => undefined,
}));

vi.mock('../../session/shell-profiles.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ShellProfilesModule>();
  return {
    ...actual,
    resolveShellProfile: mocks.resolveShellProfile,
  };
});

vi.mock('../../session/persistent-terminals.js', async (importOriginal) => {
  const actual = await importOriginal<typeof PersistentTerminalsModule>();
  return {
    ...actual,
    spawnPersistentTerminal: mocks.spawnPersistentTerminal,
  };
});

let dbModule: typeof DbModule;
let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionTerminalsRoutes: typeof SessionTerminalsRoutesModule.sessionTerminalsRoutes;
let registry: typeof RegistryModule;
let shellProfiles: typeof ShellProfilesModule;

const USER_ID = 'u-term-shell-profile';
const SESSION_ID = 's-term-shell-profile';

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

function buildRecord(input: SpawnPersistentTerminalInput): RegistryModule.SessionTerminalRecord {
  return registry.registerTerminal({
    sessionId: input.sessionId,
    userId: input.userId,
    toolName: 'quick_terminal',
    kind: 'foreground',
    command: '(交互终端)',
    cwd: input.cwd,
    initialStatus: 'running',
    metadata: {
      persistent: true,
      source: 'user',
      shell: '/bin/bash',
      ...(input.shellProfileId ? { shellProfileId: input.shellProfileId } : {}),
      backend: 'pipe',
    },
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionTerminalsRoutes = (await import('../../routes/session-terminals.js'))
    .sessionTerminalsRoutes;
  registry = await import('../../session/session-terminal-registry.js');
  shellProfiles = await import('../../session/shell-profiles.js');
  await dbModule.connectDb();
  await dbModule.migrate();
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  registry.__resetSessionTerminalsForTest();
  mocks.spawnPersistentTerminal.mockReset();
  mocks.resolveShellProfile.mockReset();
  dbModule.sqliteRun('DELETE FROM sessions');
  dbModule.sqliteRun('DELETE FROM users');
  seedUser(USER_ID, 'shell-profile@example.com');
  seedSession(SESSION_ID, USER_ID);
});

describe('GET /terminals/shell-profiles', () => {
  it('requires auth', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/terminals/shell-profiles' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('returns only id/label/isDefault and never leaks a filesystem path', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/terminals/shell-profiles',
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      profiles: Array<{ id: string; label: string; isDefault: boolean }>;
    };
    expect(Array.isArray(body.profiles)).toBe(true);
    for (const profile of body.profiles) {
      expect(Object.keys(profile).sort()).toEqual(['id', 'isDefault', 'label']);
      expect(profile.id).not.toContain('/');
      expect(profile.id).not.toContain('\\');
      expect(profile.label).not.toContain('/');
      expect(profile.label).not.toContain('\\');
    }
    // Security assertion: no path separators anywhere in the serialized payload.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/');
    expect(serialized).not.toContain('\\');
    await app.close();
  });
});

describe('POST /sessions/:sessionId/terminals — shellProfileId security', () => {
  it('rejects a shell path with 400 invalid_shell_profile and never spawns', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { shellProfileId: '/bin/evil', shell: '/bin/evil', args: ['-c', 'evil'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_shell_profile' });
    expect(mocks.spawnPersistentTerminal).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a non-allowlisted id with 400 invalid_shell_profile and never spawns', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { shellProfileId: 'definitely-not-a-real-shell' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_shell_profile' });
    expect(mocks.spawnPersistentTerminal).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a non-string shellProfileId with 400 invalid_shell_profile and never spawns', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { shellProfileId: 123 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_shell_profile' });
    expect(mocks.spawnPersistentTerminal).not.toHaveBeenCalled();
    await app.close();
  });

  it('maps a spawn-time InvalidShellProfileError to 400 invalid_shell_profile', async () => {
    mocks.resolveShellProfile.mockReturnValue({
      id: 'bash',
      label: 'Bash',
      shell: '/bin/bash',
      isPowerShell: false,
      isDefault: true,
    });
    mocks.spawnPersistentTerminal.mockImplementation(() => {
      throw new shellProfiles.InvalidShellProfileError('ghost');
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { shellProfileId: 'bash' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_shell_profile' });
    await app.close();
  });
});

describe('POST /sessions/:sessionId/terminals — shellProfileId happy paths', () => {
  it('omitting shellProfileId preserves the default path and injects no shell/argv', async () => {
    mocks.spawnPersistentTerminal.mockImplementation(
      (input: SpawnPersistentTerminalInput): SpawnPersistentTerminalResult => ({
        terminal: buildRecord(input),
      }),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(mocks.spawnPersistentTerminal).toHaveBeenCalledTimes(1);
    const call = mocks.spawnPersistentTerminal.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['shellProfileId']).toBeUndefined();
    expect(call).not.toHaveProperty('shell');
    expect(call).not.toHaveProperty('args');
    await app.close();
  });

  it('forwards only the server-validated opaque id and projects shell:{id,label}', async () => {
    mocks.resolveShellProfile.mockReturnValue({
      id: 'bash',
      label: 'Bash',
      shell: '/bin/bash',
      isPowerShell: false,
      isDefault: true,
    });
    mocks.spawnPersistentTerminal.mockImplementation(
      (input: SpawnPersistentTerminalInput): SpawnPersistentTerminalResult => ({
        terminal: buildRecord(input),
      }),
    );
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/sessions/${SESSION_ID}/terminals`,
      headers: { authorization: bearer(app), 'content-type': 'application/json' },
      payload: { shellProfileId: 'bash' },
    });
    expect(res.statusCode).toBe(200);
    const call = mocks.spawnPersistentTerminal.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call['shellProfileId']).toBe('bash');
    // The resolved executable / argv are never part of the spawn input.
    expect(call).not.toHaveProperty('shell');
    expect(call).not.toHaveProperty('args');
    const body = res.json() as { terminal: { shell?: { id: string; label: string } } };
    expect(body.terminal.shell).toEqual({ id: 'bash', label: 'Bash' });
    await app.close();
  });
});

describe('terminal reload — persisted shell profile projection', () => {
  it('survives a reload, exposes shell:{id,label}, and keeps metadata hidden', async () => {
    const record = registry.registerTerminal({
      sessionId: SESSION_ID,
      userId: USER_ID,
      toolName: 'quick_terminal',
      kind: 'foreground',
      command: '(交互终端)',
      cwd: '/tmp',
      metadata: {
        persistent: true,
        source: 'user',
        shell: '/usr/bin/zsh',
        shellProfileId: 'zsh',
        backend: 'pipe',
      },
    });
    // Re-read from SQLite to emulate a post-restart projection.
    const reloaded = registry.getTerminal(record.terminalId, USER_ID);
    expect(reloaded?.metadata['shellProfileId']).toBe('zsh');

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/sessions/${SESSION_ID}/terminals/${record.terminalId}`,
      headers: { authorization: bearer(app) },
    });
    expect(res.statusCode).toBe(200);
    const terminal = (res.json() as { terminal: Record<string, unknown> }).terminal;
    expect(terminal['shell']).toEqual({ id: 'zsh', label: 'Zsh' });
    expect(terminal).not.toHaveProperty('metadata');
    expect(JSON.stringify(terminal['shell'])).not.toContain('/');
    await app.close();
  });
});
