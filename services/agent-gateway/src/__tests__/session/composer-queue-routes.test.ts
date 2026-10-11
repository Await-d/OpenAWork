/**
 * `registerSessionComposerQueueRoutes` 的 HTTP 契约。
 *
 * 关注三条不可退让的线：
 * 1. **归属校验走 404 而非 403**——会话 id 不可被探测（与会话子域其余路由一致）；
 * 2. **入队按 itemId 幂等**——客户端重试 / 双标签页不得产生重复条目；
 * 3. **入队不触碰消息历史**——待发条目在真正发出前对模型不可见。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as ErrorHandlerModule from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type { ComposerQueueItem } from '../../session/composer-queue-store.js';
import type * as ComposerQueueRoutesModule from '../../routes/session-composer-queue.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let dbModule: typeof DbModule;
let registerErrorHandler: typeof ErrorHandlerModule.registerErrorHandler;
let registerSessionComposerQueueRoutes: typeof ComposerQueueRoutesModule.registerSessionComposerQueueRoutes;

const USER_ID = 'u-composer-queue-route';
const OTHER_USER_ID = 'u-composer-queue-route-other';
const SESSION_ID = 'sess-composer-queue-route';
const OTHER_SESSION_ID = 'sess-composer-queue-route-other';

let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  // 每个 handler 都会开一个 workflow step，缺插件会直接 500。
  await instance.register(requestWorkflowPlugin);
  await instance.register(authPlugin);
  registerErrorHandler(instance);
  await instance.register(registerSessionComposerQueueRoutes);
  await instance.ready();
  return instance;
}

function authHeaders(userId = USER_ID): { authorization: string } {
  return {
    authorization: `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`,
  };
}

function queueUrl(sessionId = SESSION_ID, suffix = ''): string {
  return `/sessions/${sessionId}/composer-queue${suffix}`;
}

interface QueueListBody {
  items: ComposerQueueItem[];
  ok: boolean;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  registerErrorHandler = (await import('../../infra/error-handler.js')).registerErrorHandler;
  registerSessionComposerQueueRoutes = (await import('../../routes/session-composer-queue.js'))
    .registerSessionComposerQueueRoutes;
  app = await buildApp();
});

beforeEach(async () => {
  dbModule.sqliteRun('DELETE FROM session_composer_queue', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    'owner@example.com',
  ]);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    OTHER_USER_ID,
    'other@example.com',
  ]);
  dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [SESSION_ID, USER_ID]);
  dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [
    OTHER_SESSION_ID,
    USER_ID,
  ]);
});

afterAll(async () => {
  await app.close();
  await dbModule.closeDb();
});

describe('POST /sessions/:sessionId/composer-queue', () => {
  it('入队后可列出，且按入队顺序返回', async () => {
    const first = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'item-1', text: '第一条' },
      url: queueUrl(),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ created: boolean }>().created).toBe(true);

    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'item-2', text: '第二条' },
      url: queueUrl(),
    });

    const listed = await app.inject({
      headers: authHeaders(),
      method: 'GET',
      url: queueUrl(),
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<QueueListBody>();
    expect(body.ok).toBe(true);
    expect(body.items.map((item) => item.text)).toEqual(['第一条', '第二条']);
  });

  it('同一 itemId 重复入队返回 created=false 且不产生第二条', async () => {
    const payload = { itemId: 'same-id', text: '只应存在一条' };
    await app.inject({ headers: authHeaders(), method: 'POST', payload, url: queueUrl() });
    const second = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { ...payload, text: '重试内容' },
      url: queueUrl(),
    });

    expect(second.statusCode).toBe(200);
    expect(second.json<{ created: boolean }>().created).toBe(false);

    const listed = await app.inject({ headers: authHeaders(), method: 'GET', url: queueUrl() });
    const items = listed.json<QueueListBody>().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe('只应存在一条');
  });

  it('入队不会写入会话历史（待发条目对模型不可见）', async () => {
    const before = dbModule.sqliteGet<{ count: number }>(
      'SELECT COUNT(*) AS count FROM message_v2 WHERE session_id = ?',
      [SESSION_ID],
    );

    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'ghost', text: '不该出现在历史里' },
      url: queueUrl(),
    });

    const after = dbModule.sqliteGet<{ count: number }>(
      'SELECT COUNT(*) AS count FROM message_v2 WHERE session_id = ?',
      [SESSION_ID],
    );
    expect(after?.count ?? 0).toBe(before?.count ?? 0);
  });

  it('缺少 itemId 时返回 400', async () => {
    const response = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { text: '没有 id' },
      url: queueUrl(),
    });
    expect(response.statusCode).toBe(400);
  });

  it('未鉴权时返回 401', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: { itemId: 'x', text: '无 token' },
      url: queueUrl(),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('归属校验', () => {
  it('对不存在的会话返回 404（不泄露会话是否存在）', async () => {
    const response = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'x', text: '打到不存在的会话' },
      url: queueUrl('sess-does-not-exist'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('访问他人会话返回 404', async () => {
    // OTHER_SESSION_ID 属于同一用户，但下面这条用另一个用户去读，验证越权被挡。
    dbModule.sqliteRun('UPDATE sessions SET user_id = ? WHERE id = ?', [OTHER_USER_ID, SESSION_ID]);

    const response = await app.inject({
      headers: authHeaders(USER_ID),
      method: 'GET',
      url: queueUrl(),
    });
    expect(response.statusCode).toBe(404);
  });
});

describe('DELETE /sessions/:sessionId/composer-queue/:itemId', () => {
  it('删除命中返回 removed=true，重复删除仍返回 ok', async () => {
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'doomed', text: '待删除' },
      url: queueUrl(),
    });

    const first = await app.inject({
      headers: authHeaders(),
      method: 'DELETE',
      url: queueUrl(SESSION_ID, '/doomed'),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ removed: boolean }>().removed).toBe(true);

    // 幂等：可能刚被另一个标签页消费掉了，删除不应报错。
    const second = await app.inject({
      headers: authHeaders(),
      method: 'DELETE',
      url: queueUrl(SESSION_ID, '/doomed'),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json<{ ok: boolean }>().ok).toBe(true);
  });

  it('无法删除其他会话的条目', async () => {
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'protected', text: 'A 的条目' },
      url: queueUrl(),
    });

    const response = await app.inject({
      headers: authHeaders(),
      method: 'DELETE',
      url: queueUrl(OTHER_SESSION_ID, '/protected'),
    });
    expect(response.json<{ removed: boolean }>().removed).toBe(false);

    const listed = await app.inject({ headers: authHeaders(), method: 'GET', url: queueUrl() });
    expect(listed.json<QueueListBody>().items).toHaveLength(1);
  });
});

describe('发送权认领（多端互斥）', () => {
  async function enqueueOne(itemId: string): Promise<void> {
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId, text: '待认领' },
      url: queueUrl(),
    });
  }

  it('先到者认领成功，后来者被拒且仍返回 200', async () => {
    await enqueueOne('claim-1');

    const first = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { clientId: 'client-a' },
      url: queueUrl(SESSION_ID, '/claim-1/claim'),
    });
    expect(first.statusCode).toBe(200);
    expect(first.json<{ claimed: boolean }>().claimed).toBe(true);

    const second = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { clientId: 'client-b' },
      url: queueUrl(SESSION_ID, '/claim-1/claim'),
    });
    // 「别人正在处理」不是错误，回 200 + claimed:false，避免客户端把它当失败去重试。
    expect(second.statusCode).toBe(200);
    expect(second.json<{ claimed: boolean }>().claimed).toBe(false);
  });

  it('交还发送权后其他端可以接手', async () => {
    await enqueueOne('claim-2');

    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { clientId: 'client-a' },
      url: queueUrl(SESSION_ID, '/claim-2/claim'),
    });
    const released = await app.inject({
      headers: authHeaders(),
      method: 'DELETE',
      payload: { clientId: 'client-a' },
      url: queueUrl(SESSION_ID, '/claim-2/claim'),
    });
    expect(released.statusCode).toBe(200);
    expect(released.json<{ released: boolean }>().released).toBe(true);

    const handover = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { clientId: 'client-b' },
      url: queueUrl(SESSION_ID, '/claim-2/claim'),
    });
    expect(handover.json<{ claimed: boolean }>().claimed).toBe(true);
  });

  it('缺少 clientId 时返回 400', async () => {
    await enqueueOne('claim-3');
    const response = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: {},
      url: queueUrl(SESSION_ID, '/claim-3/claim'),
    });
    expect(response.statusCode).toBe(400);
  });

  it('认领他人会话的条目返回 404', async () => {
    await enqueueOne('claim-4');
    dbModule.sqliteRun('UPDATE sessions SET user_id = ? WHERE id = ?', [OTHER_USER_ID, SESSION_ID]);

    const response = await app.inject({
      headers: authHeaders(USER_ID),
      method: 'POST',
      payload: { clientId: 'client-a' },
      url: queueUrl(SESSION_ID, '/claim-4/claim'),
    });
    expect(response.statusCode).toBe(404);
  });

  it('未鉴权时返回 401', async () => {
    await enqueueOne('claim-5');
    const response = await app.inject({
      method: 'POST',
      payload: { clientId: 'client-a' },
      url: queueUrl(SESSION_ID, '/claim-5/claim'),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /sessions/:sessionId/composer-queue', () => {
  it('清空只影响目标会话并返回删除条数', async () => {
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'a', text: 'A1' },
      url: queueUrl(),
    });
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'b', text: 'A2' },
      url: queueUrl(),
    });
    await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { itemId: 'c', text: 'B1' },
      url: queueUrl(OTHER_SESSION_ID),
    });

    const response = await app.inject({
      headers: authHeaders(),
      method: 'DELETE',
      url: queueUrl(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ removedCount: number }>().removedCount).toBe(2);

    const other = await app.inject({
      headers: authHeaders(),
      method: 'GET',
      url: queueUrl(OTHER_SESSION_ID),
    });
    expect(other.json<QueueListBody>().items).toHaveLength(1);
  });
});
