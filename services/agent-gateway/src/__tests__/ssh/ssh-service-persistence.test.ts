import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type { SshService as SshServiceClass } from '../../ssh/ssh-service.js';
import type { __resetSshStoreForTests as ResetSshStoreForTests } from '../../ssh/ssh-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let connectDb: typeof DbModule.connectDb;
let migrate: typeof DbModule.migrate;
let closeDb: typeof DbModule.closeDb;
let SshService: typeof SshServiceClass;
let __resetSshStoreForTests: typeof ResetSshStoreForTests;

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

  it('createConnection 持久化粘贴式私钥：视图只暴露 hasPrivateKey，落盘为密文且重启后仍在', async () => {
    const plaintextKey =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET-KEY-BODY\n-----END OPENSSH PRIVATE KEY-----';
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'key-box',
      host: 'key.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKey: plaintextKey,
    });

    expect(created.hasPrivateKey).toBe(true);
    expect(created.privateKeyPath).toBeNull();
    // 视图绝不回传私钥原文。
    expect('privateKey' in created).toBe(false);

    // 模拟进程重启：新 service 从 SQLite 重新解密读取。
    const fresh = new SshService({ manager: createConnectingManager('ok') as never });
    const persisted = fresh.getConnection(TEST_USER, created.id);
    expect(persisted?.hasPrivateKey).toBe(true);
    expect(persisted != null && 'privateKey' in persisted).toBe(false);

    // 落盘的是密文，不是明文。
    const { sqliteGet } = await import('../../infra/db.js');
    const row = sqliteGet<{ private_key_cipher: string | null }>(
      'SELECT private_key_cipher FROM ssh_connections WHERE id = ?',
      [created.id],
    );
    expect(row?.private_key_cipher).toBeTruthy();
    expect(row?.private_key_cipher).not.toBe(plaintextKey);
    expect(row?.private_key_cipher?.startsWith('enc.v1.')).toBe(true);
  });

  it('updateConnection 支持保持 / 替换 / 清空粘贴式私钥', async () => {
    const { lookupConnectionById } = await import('../../ssh/ssh-service.js');
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'key-box',
      host: 'key.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKeyPath: '/home/root/.ssh/id_ed25519',
      privateKey: 'OLD-KEY',
    });
    expect(created.hasPrivateKey).toBe(true);

    // 省略 privateKey => 保持原值。
    const kept = svc.updateConnection(TEST_USER, created.id, { name: 'renamed' });
    expect(kept?.hasPrivateKey).toBe(true);
    expect(lookupConnectionById(created.id)?.privateKey).toBe('OLD-KEY');

    const replaced = svc.updateConnection(TEST_USER, created.id, { privateKey: 'NEW-KEY' });
    expect(replaced?.hasPrivateKey).toBe(true);
    expect(lookupConnectionById(created.id)?.privateKey).toBe('NEW-KEY');

    const cleared = svc.updateConnection(TEST_USER, created.id, { privateKey: null });
    expect(cleared?.hasPrivateKey).toBe(false);
    expect(lookupConnectionById(created.id)?.privateKey).toBeNull();
  });

  it('updateConnection 在 privateKeyPath 与 privateKey 之间互斥切换', async () => {
    const { lookupConnectionById } = await import('../../ssh/ssh-service.js');
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'key-box',
      host: 'key.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKeyPath: '/home/root/.ssh/id_ed25519',
      privateKey: 'INITIAL-KEY',
    });

    // 仅改无关字段 => 路径与粘贴内容都保留。
    svc.updateConnection(TEST_USER, created.id, { name: 'renamed' });
    let row = lookupConnectionById(created.id);
    expect(row?.privateKeyPath).toBe('/home/root/.ssh/id_ed25519');
    expect(row?.privateKey).toBe('INITIAL-KEY');

    // 仅设置粘贴内容 => 旧路径被清空。
    svc.updateConnection(TEST_USER, created.id, { privateKey: 'PASTED-ONLY' });
    row = lookupConnectionById(created.id);
    expect(row?.privateKey).toBe('PASTED-ONLY');
    expect(row?.privateKeyPath).toBeNull();

    // 仅设置路径 => 粘贴内容被清空。
    svc.updateConnection(TEST_USER, created.id, { privateKeyPath: '/home/root/.ssh/id_ecdsa' });
    row = lookupConnectionById(created.id);
    expect(row?.privateKeyPath).toBe('/home/root/.ssh/id_ecdsa');
    expect(row?.privateKey).toBeNull();

    // 两侧同时显式给出 => 原样保留（前端会为另一侧配一个显式 null）。
    svc.updateConnection(TEST_USER, created.id, {
      privateKey: 'BOTH-KEY',
      privateKeyPath: '/home/root/.ssh/id_rsa',
    });
    row = lookupConnectionById(created.id);
    expect(row?.privateKeyPath).toBe('/home/root/.ssh/id_rsa');
    expect(row?.privateKey).toBe('BOTH-KEY');
  });

  it('passphrase 加密持久化：落盘密文、重启后 hasPassphrase 为 true、keep / replace / clear', async () => {
    const { lookupConnectionById } = await import('../../ssh/ssh-service.js');
    const svc = new SshService({ manager: createConnectingManager('ok') as never });
    const created = svc.createConnection(TEST_USER, {
      name: 'enc-box',
      host: 'enc.example',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKey: 'ENCRYPTED-KEY',
      passphrase: 'PASS-1',
    });
    expect(created.hasPassphrase).toBe(true);
    // 视图绝不回传口令原文。
    expect('passphrase' in created).toBe(false);

    const { sqliteGet } = await import('../../infra/db.js');
    const cipherRow = sqliteGet<{ passphrase_cipher: string | null }>(
      'SELECT passphrase_cipher FROM ssh_connections WHERE id = ?',
      [created.id],
    );
    expect(cipherRow?.passphrase_cipher).toBeTruthy();
    expect(cipherRow?.passphrase_cipher).not.toBe('PASS-1');
    expect(cipherRow?.passphrase_cipher?.startsWith('enc.v1.')).toBe(true);

    // 模拟进程重启：新 service 从 SQLite 重新解密读取。
    const fresh = new SshService({ manager: createConnectingManager('ok') as never });
    expect(fresh.getConnection(TEST_USER, created.id)?.hasPassphrase).toBe(true);

    // 省略 => 保留；传字符串 => 替换；传 null => 清空。
    svc.updateConnection(TEST_USER, created.id, { name: 'renamed' });
    expect(lookupConnectionById(created.id)?.passphrase).toBe('PASS-1');

    svc.updateConnection(TEST_USER, created.id, { passphrase: 'PASS-2' });
    expect(lookupConnectionById(created.id)?.passphrase).toBe('PASS-2');

    const cleared = svc.updateConnection(TEST_USER, created.id, { passphrase: null });
    expect(cleared?.hasPassphrase).toBe(false);
    expect(lookupConnectionById(created.id)?.passphrase).toBeNull();
  });
});
