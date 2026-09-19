import { afterAll, beforeAll, expect, it } from 'vitest';
import { connectDb, migrate, closeDb, sqliteRun, sqliteGet } from '../../infra/db.js';
import { SshService, __resetSshServiceForTests } from '../../ssh/ssh-service.js';
import { resolveSshSessionTarget } from '../../ssh/ssh-session-target.js';
import { normalizeSshRemoteWorkingDirectory } from '../../session/session-workspace-metadata.js';

beforeAll(async () => {
  await connectDb();
  await migrate();
  sqliteRun(
    "INSERT OR IGNORE INTO users (id,email,password_hash) VALUES ('gap-user','gap@test','x')",
  );
});
afterAll(closeDb);

it('Windows 远程工作目录不会被 metadata 归一化删除', () => {
  expect(normalizeSshRemoteWorkingDirectory('C:\\Work Dir\\app')).toBe('C:\\Work Dir\\app');
  expect(normalizeSshRemoteWorkingDirectory('C:relative')).toBeNull();
  expect(normalizeSshRemoteWorkingDirectory('/tmp\ncommand')).toBeNull();
});

it('解绑清除 metadata 中的 SSH 与远程目录，并阻止重新继承父会话', () => {
  const service = new SshService();
  __resetSshServiceForTests(service);
  try {
    const connection = service.createConnection('gap-user', {
      name: 'gap',
      host: 'localhost',
      port: 22,
      username: 'remote',
      authType: 'password',
    });
    sqliteRun('INSERT INTO sessions (id,user_id,title,metadata_json) VALUES (?,?,?,?)', [
      'gap-session',
      'gap-user',
      'test',
      JSON.stringify({
        sshConnectionId: connection.id,
        workingDirectory: '/remote',
        title: 'keep',
      }),
    ]);
    service.bindSession('gap-user', 'gap-session', connection.id);
    service.unbindSession('gap-user', 'gap-session');
    expect(resolveSshSessionTarget('gap-session', 'gap-user')).toBeNull();
    const row = sqliteGet<{ metadata_json: string }>(
      'SELECT metadata_json FROM sessions WHERE id = ?',
      ['gap-session'],
    );
    service.bindSession('gap-user', 'gap-session', connection.id);
    expect(resolveSshSessionTarget('gap-session', 'gap-user')?.connectionId).toBe(connection.id);
    expect(JSON.parse(row?.metadata_json ?? '{}')).toEqual({
      sshConnectionId: null,
      title: 'keep',
    });
  } finally {
    service.dispose();
    __resetSshServiceForTests(null);
  }
});
