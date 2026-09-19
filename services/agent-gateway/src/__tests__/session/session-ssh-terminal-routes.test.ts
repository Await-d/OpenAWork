import type * as PtyBackend from '../../session/pty-backend.js';
import Fastify from 'fastify';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { SSHConnectionManagerImpl } from '@openAwork/agent-core';
import { connectDb, migrate, closeDb, sqliteRun } from '../../infra/db.js';
import authPlugin from '../../infra/auth.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';
import { sessionTerminalsRoutes } from '../../routes/session-terminals.js';
import { SshService, __resetSshServiceForTests } from '../../ssh/ssh-service.js';
import { __resetSessionTerminalsForTest } from '../../session/session-terminal-registry.js';

const localSpawn = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('LOCAL_SPAWN_REACHED');
  }),
);
vi.mock('../../session/pty-backend.js', async (original) => ({
  ...(await original<typeof PtyBackend>()),
  spawnTerminalProcess: localSpawn,
}));

beforeAll(async () => {
  await connectDb();
  await migrate();
});
afterAll(async () => {
  __resetSshServiceForTests();
  await closeDb();
});
beforeEach(() => {
  localSpawn.mockClear();
  __resetSessionTerminalsForTest();
  sqliteRun(
    "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('ssh-user', 'ssh-terminal@test', 'x')",
  );
  sqliteRun(
    "INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES ('ssh-session', 'ssh-user', 'SSH')",
  );
  const service = new SshService({ manager: new SSHConnectionManagerImpl() });
  __resetSshServiceForTests(service);
  const connection = service.createConnection('ssh-user', {
    name: 'test',
    host: 'localhost',
    port: 22,
    username: 'test',
    authType: 'password',
    password: 'test',
  });
  service.bindSession('ssh-user', 'ssh-session', connection.id);
});

it('断开的 SSH 会话创建终端明确报错，绝不启动本地 Shell', async () => {
  const app = Fastify();
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionTerminalsRoutes);
  const token = app.jwt.sign({ sub: 'ssh-user', email: 'ssh-terminal@test' });
  const response = await app.inject({
    method: 'POST',
    url: '/sessions/ssh-session/terminals',
    headers: { authorization: `Bearer ${token}` },
    payload: { cwd: '/remote-only/project' },
  });
  expect(localSpawn).not.toHaveBeenCalled();
  expect(response.statusCode).toBe(500);
  expect(response.json().message).toMatch(/SSH/);
  await app.close();
});
