import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let connectDb: typeof import('../../infra/db.js').connectDb;
let migrate: typeof import('../../infra/db.js').migrate;
let closeDb: typeof import('../../infra/db.js').closeDb;
let SshService: typeof import('../../ssh/ssh-service.js').SshService;
let __resetSshStoreForTests: typeof import('../../ssh/ssh-store.js').__resetSshStoreForTests;

const TEST_USER = 'u-ssh-persistence';
const OTHER_USER = 'u-ssh-other';

beforeAll(async () => {
  ({ connectDb, migrate, closeDb } = await import('../../infra/db.js'));
  ({ SshService } = await import('../../ssh/ssh-service.js'));
  ({ __resetSshStoreForTests } = await import('../../ssh/ssh-store.js'));
  await connectDb();
  await migrate();
  // The store relies on `users(user_id)` foreign keys. Seed test users so
  // ON DELETE CASCADE machinery is happy.
  const { sqliteRun } = await import('../../infra/db.js');
  for (const id of [TEST_USER, OTHER_USER]) {
    sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id,
      `${id}@example.test`,
      'x',
    ]);
  }
});

beforeEach(() => {
  __resetSshStoreForTests();
});

afterAll(async () => {
  await closeDb();
});

function createConnectingManager(behavior: 'ok' | 'fail') {
  const manager = {
    addConnection: () => undefined,
    getConnection: () => undefined,
    listConnections: () => [],
    connect: async () => {
      if (behavior === 'fail') throw new Error('boom');
    },
    disconnect: async () => undefined,
    execCommand: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async () => ({
      path: '/x',
      content: '',
      encoding: 'utf8' as const,
      truncated: false,
    }),
    writeFile: async () => undefined,
    listFiles: async () => [],
    getStatus: () => 'disconnected' as const,
  };
  return manager;
}

describe('SshService persistence', () => {
  it('createConnection persists a row scoped to the user', () => {
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'box',
      host: 'h.example',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'sekret',
    });
    expect(created.id).toBeTruthy();
    expect(created.host).toBe('h.example');
    expect(created.hasPassword).toBe(true);

    // Brand new service simulating a process restart.
    const fresh = new SshService({ manager: createConnectingManager('ok') as never });
    const persisted = fresh.listConnections(TEST_USER);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.id).toBe(created.id);
    expect(fresh.listConnections(OTHER_USER)).toHaveLength(0);
  });

  it('connect updates persisted status to connected, and failures preserve last_error', async () => {
    const okManager = createConnectingManager('ok');
    const okSvc = new SshService({ manager: okManager as never });
    const created = okSvc.createConnection(TEST_USER, {
      name: 'box',
      host: 'h.example',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'sekret',
    });
    await okSvc.connect(TEST_USER, created.id);
    const refreshed = okSvc.getConnection(TEST_USER, created.id);
    expect(refreshed?.status).toBe('connected');

    const failManager = createConnectingManager('fail');
    const failSvc = new SshService({ manager: failManager as never });
    await expect(failSvc.connect(TEST_USER, created.id)).rejects.toThrow('boom');
    const after = failSvc.getConnection(TEST_USER, created.id);
    expect(after?.status).toBe('error');
    expect(after?.lastError).toBe('boom');
  });

  it('reconcileOnBoot resets stale `connected` rows and re-projects bindings into the in-memory registry', async () => {
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'box',
      host: 'h.example',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'sekret',
      autoReconnect: false,
    });
    await svc.connect(TEST_USER, created.id);
    svc.bindSession(TEST_USER, 'session-1', created.id);
    expect(svc.getBindings().getConnectionId('session-1')).toBe(created.id);

    // Simulate a hard restart.
    const reconciled = new SshService({ manager: createConnectingManager('ok') as never });
    expect(reconciled.getConnection(TEST_USER, created.id)?.status).toBe('connected');
    expect(reconciled.getBindings().getConnectionId('session-1')).toBeUndefined();
    await reconciled.reconcileOnBoot();
    expect(reconciled.getConnection(TEST_USER, created.id)?.status).toBe('disconnected');
    expect(reconciled.getBindings().getConnectionId('session-1')).toBe(created.id);
  });

  it('upsertDialog records cwd / lastFile / pinned and getLastOpenedDialog returns the most recent', () => {
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const c1 = svc.createConnection(TEST_USER, {
      name: 'one',
      host: '1.example',
      port: 22,
      username: 'root',
      authType: 'agent',
    });
    const c2 = svc.createConnection(TEST_USER, {
      name: 'two',
      host: '2.example',
      port: 22,
      username: 'root',
      authType: 'agent',
    });
    svc.upsertDialog({
      userId: TEST_USER,
      connectionId: c1.id,
      cwd: '/srv',
      lastFilePath: '/srv/a.log',
    });
    svc.upsertDialog({ userId: TEST_USER, connectionId: c2.id, cwd: '/var', pinned: false });
    // Touch c1 again so it becomes "most recent".
    svc.upsertDialog({ userId: TEST_USER, connectionId: c1.id, cwd: '/srv/logs' });

    const dialogs = svc.listDialogs(TEST_USER);
    expect(dialogs.map((d) => d.connectionId)).toEqual([c1.id, c2.id]);
    expect(dialogs[0]?.cwd).toBe('/srv/logs');
    expect(dialogs[0]?.lastFilePath).toBe('/srv/a.log');

    const last = svc.getLastOpenedDialog(TEST_USER);
    expect(last?.connectionId).toBe(c1.id);

    // Other user must not see the dialog.
    expect(svc.getLastOpenedDialog(OTHER_USER)).toBeNull();
  });

  it('listFiles / readFile / writeFile each touch the dialog and survive a restart', async () => {
    const manager = {
      ...createConnectingManager('ok'),
      listFiles: async () => [{ name: 'a.txt', path: '/srv/a.txt', kind: 'file' as const }],
      readFile: async () => ({
        path: '/srv/a.txt',
        content: 'hello',
        encoding: 'utf8' as const,
        truncated: false,
      }),
    };
    const svc = new SshService({ manager: manager as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'box',
      host: 'h.example',
      port: 22,
      username: 'root',
      authType: 'agent',
    });
    await svc.listFiles(TEST_USER, created.id, '/srv');
    await svc.readFile(TEST_USER, created.id, '/srv/a.txt');

    const restarted = new SshService({ manager: manager as never });
    const last = restarted.getLastOpenedDialog(TEST_USER);
    expect(last?.connectionId).toBe(created.id);
    expect(last?.cwd).toBe('/srv');
    expect(last?.lastFilePath).toBe('/srv/a.txt');
  });

  it('deleteConnection removes bindings + dialogs + persisted row', async () => {
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'box',
      host: 'h.example',
      port: 22,
      username: 'root',
      authType: 'agent',
    });
    svc.bindSession(TEST_USER, 's', created.id);
    svc.upsertDialog({ userId: TEST_USER, connectionId: created.id, cwd: '/etc' });
    expect(svc.listDialogs(TEST_USER)).toHaveLength(1);
    expect(await svc.deleteConnection(TEST_USER, created.id)).toBe(true);

    const fresh = new SshService({ manager: createConnectingManager('ok') as never });
    expect(fresh.listConnections(TEST_USER)).toHaveLength(0);
    expect(fresh.listDialogs(TEST_USER)).toHaveLength(0);
    expect(fresh.getBindings().getConnectionId('s')).toBeUndefined();
  });
});
