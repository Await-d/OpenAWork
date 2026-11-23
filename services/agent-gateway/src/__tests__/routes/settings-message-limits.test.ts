import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as StoreModule from '../../infra/message-limits-store.js';
import type * as StreamModule from '../../routes/stream.js';

let db: typeof DbModule;
let store: typeof StoreModule;
let stream: typeof StreamModule;
let app: FastifyInstance;
let directory: string;
const adminEmail = 'admin@openAwork.local';

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'message-limits-'));
  process.env['OPENAWORK_DATABASE_PATH'] = join(directory, 'test.sqlite');
  process.env['JWT_SECRET'] = 'message-limits-test-secret-at-least-32-chars';
  delete process.env['ADMIN_EMAIL'];
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  store = await import('../../infra/message-limits-store.js');
  stream = await import('../../routes/stream.js');
  app = Fastify();
  const { registerErrorHandler } = await import('../../infra/error-handler.js');
  registerErrorHandler(app);
  await app.register((await import('../../runtime/request-workflow.js')).default);
  await app.register((await import('../../infra/auth.js')).default);
  await app.register(
    (await import('../../routes/settings-message-limits.js')).registerSettingsMessageLimitsRoutes,
  );
  await app.ready();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM message_limits');
  db.sqliteRun('INSERT OR REPLACE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    'admin',
    adminEmail,
    'x',
  ]);
  db.sqliteRun('INSERT OR REPLACE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    'member',
    'member@test.local',
    'x',
  ]);
});

afterAll(async () => {
  await app?.close();
  await db?.closeDb();
  rmSync(directory, { recursive: true, force: true });
});

function headers(sub = 'admin', email = adminEmail) {
  return { authorization: `Bearer ${app.jwt.sign({ sub, email })}` };
}

describe('全局消息字符上限', () => {
  it('认证读取完整契约，普通用户只读', async () => {
    expect((await app.inject({ url: '/settings/message-limits' })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/settings/message-limits',
          payload: { maxChars: 1024 },
        })
      ).statusCode,
    ).toBe(401);
    const response = await app.inject({
      url: '/settings/message-limits',
      headers: headers('member'),
    });
    expect(response.json()).toEqual({
      maxChars: 32768,
      minChars: 1024,
      hardMaxChars: 200000,
      defaultMaxChars: 32768,
      canEdit: false,
    });
  });

  it('权限按数据库邮箱判断，伪造或过期 JWT 邮箱不提权', async () => {
    for (const sub of ['member', 'missing']) {
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: '/settings/message-limits',
            headers: headers(sub),
            payload: { maxChars: 1024 },
          })
        ).statusCode,
      ).toBe(sub === 'missing' ? 401 : 403);
    }
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/settings/message-limits',
          headers: headers('admin', 'old@test.local'),
          payload: { maxChars: 1024 },
        })
      ).statusCode,
    ).toBe(200);
    db.sqliteRun('UPDATE users SET email = ? WHERE id = ?', ['changed@test.local', 'admin']);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/settings/message-limits',
          headers: headers(),
          payload: { maxChars: 2048 },
        })
      ).statusCode,
    ).toBe(403);
  });

  it.each([1023, 200001, 1024.5, '2048', null])('拒绝无效配置 %j', async (maxChars) => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/settings/message-limits',
          headers: headers(),
          payload: { maxChars },
        })
      ).statusCode,
    ).toBe(400);
    expect(store.readMessageMaxChars()).toBe(32768);
  });

  it.each([1024, 200000])('接受边界 %i，全局用户立即可见', async (maxChars) => {
    const response = await app.inject({
      method: 'PUT',
      url: '/settings/message-limits',
      headers: headers(),
      payload: { maxChars },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ maxChars, canEdit: true });
    expect(
      (await app.inject({ url: '/settings/message-limits', headers: headers('member') })).json(),
    ).toMatchObject({ maxChars, canEdit: false });
  });

  it('持久化跨连接并且迁移幂等', async () => {
    store.writeMessageMaxChars(65536);
    await db.closeDb();
    await db.connectDb();
    await db.migrate();
    expect(store.readMessageMaxChars()).toBe(65536);
  });

  it('损坏值告警回退，但数据库错误向上传播', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    db.sqliteRun('INSERT INTO message_limits (id, max_chars) VALUES (1, ?)', ['broken']);
    expect(store.readMessageMaxChars()).toBe(32768);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    db.db.exec('ALTER TABLE message_limits RENAME TO message_limits_backup');
    try {
      expect(() => store.readMessageMaxChars()).toThrow();
    } finally {
      db.db.exec('ALTER TABLE message_limits_backup RENAME TO message_limits');
    }
  });

  it('动态校验两个文本字段、立即读新值；内部续跑仅受硬上限约束', () => {
    const input = { clientRequestId: 'request', message: '文'.repeat(32769) };
    expect(stream.createExternalStreamRequestSchema().safeParse(input).success).toBe(false);
    store.writeMessageMaxChars(65536);
    expect(stream.createExternalStreamRequestSchema().safeParse(input).success).toBe(true);
    store.writeMessageMaxChars(1024);
    for (const field of ['message', 'displayMessage']) {
      const valid = { ...input, message: '', [field]: '文'.repeat(1024) };
      expect(stream.createExternalStreamRequestSchema().safeParse(valid).success).toBe(true);
      expect(
        stream
          .createExternalStreamRequestSchema()
          .safeParse({ ...valid, [field]: '文'.repeat(1025) }).success,
      ).toBe(false);
    }
    expect(stream.streamRequestSchema.safeParse(input).success).toBe(true);
    expect(
      stream.streamRequestSchema.safeParse({ ...input, message: 'x'.repeat(200001) }).success,
    ).toBe(false);
  });
});
