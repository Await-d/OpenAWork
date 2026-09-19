import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import Fastify from 'fastify';
import { z } from 'zod';
import { expect, it } from 'vitest';
import { connectDb, migrate, closeDb, sqliteRun, sqliteGet } from '../../infra/db.js';
import authPlugin from '../../infra/auth.js';
import requestWorkflowPlugin from '../../runtime/request-workflow.js';
import { sshRoutes } from '../../routes/ssh.js';
import { sessionTerminalsRoutes } from '../../routes/session-terminals.js';
import { SshService, __resetSshServiceForTests } from '../../ssh/ssh-service.js';
import { __resetPersistentTerminalsForTest } from '../../session/persistent-terminals.js';

const execute = promisify(execFile);
const terminalResponse = z.object({
  terminal: z.object({
    terminalId: z.string(),
    cwd: z.string(),
    backend: z.string(),
    supportsResize: z.boolean(),
    outputTail: z.string(),
    status: z.string(),
  }),
});

it.skipIf(!process.env['SSH_QA_KEY'])(
  '真实 SSH PTY：HTTP 创建、输入、输出、调整尺寸、关闭、断线',
  async () => {
    await connectDb();
    await migrate();
    sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('live-ssh', 'live-ssh@test', 'x')",
    );
    sqliteRun(
      "INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json) VALUES ('live-session', 'live-ssh', 'SSH', '{\"workingDirectory\":\"/tmp\"}')",
    );
    const service = new SshService();
    __resetSshServiceForTests(service);
    const connection = service.createConnection('live-ssh', {
      name: 'loopback-qa',
      host: '127.0.0.1',
      port: 22249,
      username: 'await',
      authType: 'key',
      privateKey: readFileSync(process.env['SSH_QA_KEY'] ?? '', 'utf8'),
    });
    const app = Fastify();
    await app.register(requestWorkflowPlugin);
    await app.register(authPlugin);
    await app.register(sessionTerminalsRoutes);
    await app.register(sshRoutes);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const token = app.jwt.sign({ sub: 'live-ssh', email: 'live-ssh@test' });
    const base = '/sessions/live-session/terminals';
    async function request(method: string, path: string, body?: object): Promise<unknown> {
      const result = await execute('curl', [
        '--silent',
        '--show-error',
        '--fail-with-body',
        '-X',
        method,
        `${address}${path}`,
        '-H',
        `Authorization: Bearer ${token}`,
        '-H',
        'Content-Type: application/json',
        ...(body ? ['-d', JSON.stringify(body)] : []),
      ]);
      return JSON.parse(result.stdout);
    }
    async function outputContains(id: string, expected: string): Promise<void> {
      let output = '';
      for (let i = 0; i < 100; i += 1) {
        const result = terminalResponse.parse(await request('GET', `${base}/${id}`));
        output = result.terminal.outputTail;
        if (output.includes(expected)) return;
        await delay(50);
      }
      expect(output).toContain(expected);
    }
    try {
      await Promise.all([
        service.connect('live-ssh', connection.id),
        service.connect('live-ssh', connection.id),
      ]);
      service.bindSession('live-ssh', 'live-session', connection.id);
      const missing = await app.inject({
        method: 'POST',
        url: base,
        headers: { authorization: `Bearer ${token}` },
        payload: { cwd: '/openawork-nonexistent-directory-qa' },
      });
      expect(missing.statusCode).toBeGreaterThanOrEqual(400);
      expect(missing.body).toContain('SSH 工作目录不可访问');
      await service.mkdir('live-ssh', connection.id, '/tmp');

      const created = terminalResponse.parse(await request('POST', base, {})).terminal;
      expect(created.cwd).toBe('/tmp');
      expect(created.backend).toBe('pty');
      expect(created.supportsResize).toBe(true);
      await request('POST', `${base}/${created.terminalId}/stdin`, {
        data: "printf 'QA_CWD=%s\\n' \"$PWD\"; test -t 0 && printf 'QA_%s\\n' PTY\n",
      });
      await outputContains(created.terminalId, 'QA_CWD=/tmp');
      await outputContains(created.terminalId, 'QA_PTY');
      await request('POST', `${base}/${created.terminalId}/resize`, { cols: 101, rows: 37 });
      await request('POST', `${base}/${created.terminalId}/stdin`, { data: 'stty size\n' });
      await outputContains(created.terminalId, '37 101');
      await request('POST', `${base}/${created.terminalId}/close`, {});
      expect(
        terminalResponse.parse(await request('GET', `${base}/${created.terminalId}`)).terminal
          .status,
      ).toBe('killed');
      const second = terminalResponse.parse(await request('POST', base, {})).terminal;
      await request('POST', `${base}/${second.terminalId}/kill`, {});
      expect(
        terminalResponse.parse(await request('GET', `${base}/${second.terminalId}`)).terminal
          .status,
      ).toBe('killed');
      const third = terminalResponse.parse(await request('POST', base, {})).terminal;
      await service.disconnect('live-ssh', connection.id);
      await delay(100);
      expect(
        terminalResponse.parse(await request('GET', `${base}/${third.terminalId}`)).terminal.status,
      ).toBe('exited');
      await expect(request('POST', base, {})).rejects.toThrow();
      await delay(1_200);
      expect(service.getConnection('live-ssh', connection.id)?.status).toBe('disconnected');
      const known = sqliteGet<{ fingerprint: string }>(
        "SELECT fingerprint FROM ssh_known_hosts WHERE user_id = 'live-ssh'",
      );
      if (!known) throw new Error('missing known host');
      const changed = 'SHA256:' + 'A'.repeat(43);
      sqliteRun("UPDATE ssh_known_hosts SET fingerprint = ? WHERE user_id = 'live-ssh'", [changed]);
      await expect(service.connect('live-ssh', connection.id)).rejects.toThrow(/host key mismatch/);
      expect(service.getConnection('live-ssh', connection.id)?.status).toBe('error');
      await request('PUT', `/ssh/connections/${connection.id}/host-key`, {
        expectedFingerprint: changed,
        fingerprint: known.fingerprint,
      });
      await service.connect('live-ssh', connection.id);
      expect(service.getConnection('live-ssh', connection.id)?.status).toBe('connected');
      const restored = terminalResponse.parse(await request('POST', base, {})).terminal;
      await request('POST', `${base}/${restored.terminalId}/stdin`, {
        data: "printf 'SSH_%s\\n' RESTORED\n",
      });
      await outputContains(restored.terminalId, 'SSH_RESTORED');

      console.log(
        'SSH_LIVE_QA: cwd=/tmp; PTY=true; resize=37x101; close=killed; kill=killed; disconnect=exited; disconnected_create=rejected',
      );
    } finally {
      __resetPersistentTerminalsForTest();
      await service.disconnect('live-ssh', connection.id);
      __resetSshServiceForTests();
      await app.close();
      await closeDb();
    }
  },
  20_000,
);
