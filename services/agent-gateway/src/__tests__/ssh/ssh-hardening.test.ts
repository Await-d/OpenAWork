import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl } from '@openAwork/agent-core';
import { connectDb, migrate, closeDb, sqliteRun } from '../../infra/db.js';
import { SshService, __resetSshServiceForTests } from '../../ssh/ssh-service.js';
import { verifySshHostKey } from '../../ssh/ssh-host-trust.js';
import { SshReconnectScheduler } from '../../ssh/ssh-reconnect.js';
import { encryptSecret, decryptSecret } from '../../ssh/ssh-secret-cipher.js';
import { resolveSshSessionTarget } from '../../ssh/ssh-session-target.js';

const services: SshService[] = [];
const dataDir = mkdtempSync(join(tmpdir(), 'ssh-hardening-'));
beforeAll(async () => {
  await connectDb();
  await migrate();
  for (const [id, email] of [
    ['secure-user', 'secure@test'],
    ['secure-admin', 'admin@openAwork.local'],
  ]) {
    sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id ?? '',
      email ?? '',
      'x',
    ]);
  }
});
afterEach(() => {
  services.splice(0).forEach((service) => service.dispose());
  __resetSshServiceForTests();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
  rmSync(dataDir, { recursive: true, force: true });
});
function serviceWithManager(manager?: SSHConnectionManagerImpl): SshService {
  const service = new SshService(manager ? { manager } : {});
  services.push(service);
  return service;
}
function create(service: SshService, userId = 'secure-user') {
  return service.createConnection(userId, {
    name: 'secure',
    host: 'trust.test',
    port: 22,
    username: 'remote',
    authType: 'password',
    password: 'test',
  });
}

it('主机指纹首次持久化，同主机相同指纹通过，密钥变更阻断', async () => {
  const service = serviceWithManager();
  const connection = create(service);
  const runtime = service.getManager().getConnection(connection.id);
  if (!runtime) throw new Error('missing runtime');
  expect(await verifySshHostKey(runtime, 'SHA256:old')).toBe(true);
  expect(await verifySshHostKey(runtime, 'SHA256:old')).toBe(true);
  await expect(verifySshHostKey(runtime, 'SHA256:new')).rejects.toThrow(/host key mismatch/);
  const another = create(service);
  const otherRuntime = service.getManager().getConnection(another.id);
  if (!otherRuntime) throw new Error('missing runtime');
  await expect(verifySshHostKey(otherRuntime, 'SHA256:new')).rejects.toThrow(/host key mismatch/);
});

it('普通用户不得使用网关文件私钥或 ssh-agent', async () => {
  const service = serviceWithManager();
  for (const authType of ['key', 'agent'] as const) {
    const connection = service.createConnection('secure-user', {
      name: 'forbidden',
      host: 'localhost',
      port: 22,
      username: 'remote',
      authType,
      privateKeyPath: '/gateway/private-key',
    });
    await expect(service.connect('secure-user', connection.id)).rejects.toThrow(/部署管理员/);
  }
});

it('断线事件同步持久化连接状态，手动断开不自动重连', async () => {
  class Client extends EventEmitter {
    exec = vi.fn();
    sftp = vi.fn();
    end = vi.fn(() => {
      this.emit('close');
    });
    connect = vi.fn(() => {
      queueMicrotask(() => this.emit('ready'));
      return this;
    });
  }
  const client = new Client();
  const manager = new SSHConnectionManagerImpl({ clientFactory: async () => client });
  const service = serviceWithManager(manager);
  const connection = create(service);
  await service.connect('secure-user', connection.id);
  client.emit('close');
  expect(service.getConnection('secure-user', connection.id)?.status).toBe('disconnected');
  await service.disconnect('secure-user', connection.id);
  expect(
    service.listConnections('secure-user').find((entry) => entry.id === connection.id)?.status,
  ).toBe('disconnected');
});

it('重连退避、手动暂停及销毁会回收定时器', async () => {
  vi.useFakeTimers();
  const scheduler = new SshReconnectScheduler();
  const reconnect = vi.fn().mockRejectedValue(new Error('offline'));
  scheduler.schedule('id', reconnect);
  scheduler.schedule('id', reconnect);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(reconnect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1_999);
  expect(reconnect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(reconnect).toHaveBeenCalledTimes(2);
  scheduler.pause('id');
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reconnect).toHaveBeenCalledTimes(2);
  scheduler.resume('id');
  scheduler.schedule('id', reconnect);
  scheduler.dispose();
  expect(vi.getTimerCount()).toBe(0);
});

it('凭证使用独立随机密钥，轮换 JWT 后仍解密，文件权限 0600', () => {
  vi.stubEnv('OPENAWORK_DATA_DIR', dataDir);
  vi.stubEnv('JWT_SECRET', 'original-jwt-secret');
  const ciphertext = encryptSecret('ssh-password');
  expect(ciphertext).toMatch(/^enc\.v2\./);
  vi.stubEnv('JWT_SECRET', 'rotated-jwt-secret');
  expect(decryptSecret(ciphertext)).toBe('ssh-password');
  expect(statSync(join(dataDir, 'ssh-credential-key.json')).mode & 0o777).toBe(0o600);
  expect(readFileSync(join(dataDir, 'ssh-credential-key.json'), 'utf8')).not.toContain(
    'ssh-password',
  );
});

it('子会话继承父会话远程目录及绑定，跨用户父链拒绝', () => {
  const service = serviceWithManager();
  __resetSshServiceForTests(service);
  const connection = create(service);
  sqliteRun(
    "INSERT OR REPLACE INTO sessions (id, user_id, title, metadata_json) VALUES ('secure-parent', 'secure-user', 'parent', '{\"workingDirectory\":\"/srv/project\"}')",
  );
  sqliteRun(
    "INSERT OR REPLACE INTO sessions (id, user_id, title, team_parent_session_id) VALUES ('secure-child', 'secure-user', 'child', 'secure-parent')",
  );
  service.bindSession('secure-user', 'secure-parent', connection.id);
  expect(resolveSshSessionTarget('secure-child', 'secure-user')).toEqual({
    connectionId: connection.id,
    workingDirectory: '/srv/project',
  });
  sqliteRun("UPDATE sessions SET user_id = 'secure-admin' WHERE id = 'secure-parent'");
  expect(() => resolveSshSessionTarget('secure-child', 'secure-user')).toThrow(/不属于/);
});

it('重连成功后状态回归 connected，手动取消握手保持 disconnected', async () => {
  class Client extends EventEmitter {
    exec = vi.fn();
    sftp = vi.fn();
    end = vi.fn(() => {
      this.emit('close');
    });
    connect = vi.fn(() => {
      queueMicrotask(() => this.emit('ready'));
      return this;
    });
  }
  const clients: Client[] = [];
  const manager = new SSHConnectionManagerImpl({
    clientFactory: async () => {
      const client = new Client();
      clients.push(client);
      return client;
    },
  });
  const service = serviceWithManager(manager);
  const connection = create(service);
  await service.connect('secure-user', connection.id);
  clients[0]?.emit('close');
  await vi.waitFor(
    () => expect(service.getConnection('secure-user', connection.id)?.status).toBe('connected'),
    { timeout: 2_000 },
  );
  expect(clients).toHaveLength(2);
  await service.disconnect('secure-user', connection.id);
});

it('改名不会关闭活连接，改变目标会关闭旧通道', async () => {
  class Client extends EventEmitter {
    exec = vi.fn();
    sftp = vi.fn();
    end = vi.fn(() => {
      this.emit('close');
    });
    connect = vi.fn(() => {
      queueMicrotask(() => this.emit('ready'));
      return this;
    });
  }
  const client = new Client();
  const service = serviceWithManager(
    new SSHConnectionManagerImpl({ clientFactory: async () => client }),
  );
  const connection = create(service);
  await service.connect('secure-user', connection.id);
  expect(service.updateConnection('secure-user', connection.id, { name: 'renamed' })?.status).toBe(
    'connected',
  );
  expect(client.end).not.toHaveBeenCalled();
  expect(
    service.updateConnection('secure-user', connection.id, { host: 'changed.test' })?.status,
  ).toBe('disconnected');
  expect(client.end).toHaveBeenCalledTimes(1);
});
