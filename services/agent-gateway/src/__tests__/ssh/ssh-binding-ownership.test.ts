import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDb, migrate, closeDb, sqliteRun } from '../../infra/db.js';
import { SshService } from '../../ssh/ssh-service.js';

beforeAll(async () => {
  await connectDb();
  await migrate();
  for (const id of ['binding-owner', 'binding-other']) {
    sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      id,
      `${id}@test`,
      'x',
    ]);
  }
  sqliteRun(
    "INSERT OR IGNORE INTO sessions (id, user_id, title) VALUES ('owned-session', 'binding-owner', 'test')",
  );
});
afterAll(closeDb);

it('其他用户不能绑定或解绑他人的会话', () => {
  const service = new SshService();
  const owner = service.createConnection('binding-owner', {
    name: 'owner',
    host: 'localhost',
    port: 22,
    username: 'test',
    authType: 'password',
  });
  const other = service.createConnection('binding-other', {
    name: 'other',
    host: 'localhost',
    port: 22,
    username: 'test',
    authType: 'password',
  });
  service.bindSession('binding-owner', 'owned-session', owner.id);
  expect(() => service.bindSession('binding-other', 'owned-session', other.id)).toThrow(/session/i);
  expect(() => service.unbindSession('binding-other', 'owned-session')).toThrow(/session/i);
  expect(service.getBindings().getConnectionId('owned-session')).toBe(owner.id);
});

it('不存在的会话不创建悬空绑定', () => {
  const service = new SshService();
  const connection = service.createConnection('binding-owner', {
    name: 'test',
    host: 'localhost',
    port: 22,
    username: 'test',
    authType: 'password',
  });
  expect(() => service.bindSession('binding-owner', 'missing-session', connection.id)).toThrow(
    /session/i,
  );
  expect(service.getBindings().getConnectionId('missing-session')).toBeUndefined();
});
