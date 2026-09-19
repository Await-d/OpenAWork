import Fastify from 'fastify';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import authPlugin from '../../infra/auth.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';
import { connectDb, migrate, closeDb, sqliteRun, sqliteGet } from '../../infra/db.js';
import { SshService, __resetSshServiceForTests } from '../../ssh/ssh-service.js';
import { verifySshHostKey } from '../../ssh/ssh-host-trust.js';
import { sshRoutes } from '../../routes/ssh.js';

beforeAll(async () => {
  await connectDb();
  await migrate();
  sqliteRun(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('host-key-user', 'host-key@test', 'x')",
  );
});
afterAll(closeDb);

it('指纹冲突返回 409 且不影响连接；更新成功后才断开', async () => {
  const service = new SshService();
  __resetSshServiceForTests(service);
  const app = Fastify();
  try {
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(sshRoutes);
    const connection = service.createConnection('host-key-user', {
      name: 'test',
      host: 'key.test',
      port: 22,
      username: 'remote',
      authType: 'password',
    });
    const runtime = service.getManager().getConnection(connection.id)!;
    runtime.status = 'connected';
    const oldKey = `SHA256:${'a'.repeat(43)}`;
    const newKey = `SHA256:${'b'.repeat(43)}`;
    await verifySshHostKey(runtime, oldKey);
    const readKey = () =>
      sqliteGet<{ fingerprint: string }>(
        'SELECT fingerprint FROM ssh_known_hosts WHERE user_id = ?',
        ['host-key-user'],
      )?.fingerprint;
    const disconnect = vi.spyOn(service, 'disconnect');
    const request = (expectedFingerprint: string) =>
      app.inject({
        method: 'PUT',
        url: `/ssh/connections/${connection.id}/host-key`,
        headers: {
          authorization: `Bearer ${app.jwt.sign({ sub: 'host-key-user', email: 'host-key@test' })}`,
        },
        payload: { expectedFingerprint, fingerprint: newKey },
      });
    const conflict = await request(newKey);
    expect(conflict.statusCode).toBe(409);
    expect(disconnect).not.toHaveBeenCalled();
    expect(service.getManager().getConnection(connection.id)?.status).toBe('connected');
    expect(readKey()).toBe(oldKey);
    const success = await request(oldKey);
    expect(success.statusCode).toBe(200);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(readKey()).toBe(newKey);
    expect(service.getManager().getConnection(connection.id)?.status).toBe('disconnected');
  } finally {
    await app.close();
    service.dispose();
    __resetSshServiceForTests(null);
    vi.restoreAllMocks();
  }
});
