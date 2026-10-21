/**
 * `registerSessionComposerInputHistoryRoutes` 的 HTTP 契约。
 *
 * 关注三条不可退让的线：
 * 1. **归属校验走 404 而非 403**——会话 id 不可被探测；
 * 2. **每会话最多 50 条**——写入后立刻裁剪，历史表不会无限增长；
 * 3. **相邻去重、批量迁移**——与客户端上下键语义一致，且新会话能把 pending 历史一次带入。
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import type * as ErrorHandlerModule from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as ComposerInputHistoryRoutesModule from '../../routes/session-composer-input-history.js';
import { COMPOSER_INPUT_HISTORY_MAX_ENTRIES } from '../../session/composer-input-history-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let authPlugin: typeof AuthModule.default;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let dbModule: typeof DbModule;
let registerErrorHandler: typeof ErrorHandlerModule.registerErrorHandler;
let registerSessionComposerInputHistoryRoutes: typeof ComposerInputHistoryRoutesModule.registerSessionComposerInputHistoryRoutes;

const USER_ID = 'u-composer-input-history-route';
const OTHER_USER_ID = 'u-composer-input-history-route-other';
const SESSION_ID = 'sess-composer-input-history-route';
const OTHER_SESSION_ID = 'sess-composer-input-history-route-other';

let app: FastifyInstance;

async function buildApp(): Promise<FastifyInstance> {
  const instance = Fastify();
  await instance.register(requestWorkflowPlugin);
  await instance.register(authPlugin);
  registerErrorHandler(instance);
  await instance.register(registerSessionComposerInputHistoryRoutes);
  await instance.ready();
  return instance;
}

function authHeaders(userId = USER_ID): { authorization: string } {
  return {
    authorization: `Bearer ${app.jwt.sign({ sub: userId, email: `${userId}@example.com` })}`,
  };
}

function historyUrl(sessionId = SESSION_ID): string {
  return `/sessions/${sessionId}/composer-input-history`;
}

interface HistoryBody {
  entries: string[];
  ok: boolean;
}

async function listEntries(sessionId = SESSION_ID): Promise<string[]> {
  const response = await app.inject({
    headers: authHeaders(),
    method: 'GET',
    url: historyUrl(sessionId),
  });
  expect(response.statusCode).toBe(200);
  return response.json<HistoryBody>().entries;
}

async function appendEntries(
  entries: string[],
  sessionId = SESSION_ID,
): Promise<{ body: HistoryBody; statusCode: number }> {
  const response = await app.inject({
    headers: authHeaders(),
    method: 'POST',
    payload: { entries },
    url: historyUrl(sessionId),
  });
  return {
    body: response.json<HistoryBody>(),
    statusCode: response.statusCode,
  };
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  registerErrorHandler = (await import('../../infra/error-handler.js')).registerErrorHandler;
  registerSessionComposerInputHistoryRoutes = (
    await import('../../routes/session-composer-input-history.js')
  ).registerSessionComposerInputHistoryRoutes;
  app = await buildApp();
});

beforeEach(async () => {
  dbModule.sqliteRun('DELETE FROM session_composer_input_history', []);
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

describe('输入历史路由', () => {
  it('追加后按旧 → 新列出', async () => {
    const { statusCode } = await appendEntries(['第一条']);
    expect(statusCode).toBe(200);

    await appendEntries(['第二条']);

    await expect(listEntries()).resolves.toEqual(['第一条', '第二条']);
  });

  it('未拥有会话的读写一律 404', async () => {
    const getResponse = await app.inject({
      headers: authHeaders(OTHER_USER_ID),
      method: 'GET',
      url: historyUrl(),
    });
    expect(getResponse.statusCode).toBe(404);

    const postResponse = await app.inject({
      headers: authHeaders(OTHER_USER_ID),
      method: 'POST',
      payload: { entries: ['越权写入'] },
      url: historyUrl(),
    });
    expect(postResponse.statusCode).toBe(404);
    expect(await listEntries()).toEqual([]);
  });

  it('只保留最新五十条', async () => {
    const entries = Array.from(
      { length: COMPOSER_INPUT_HISTORY_MAX_ENTRIES + 5 },
      (_, index) => `prompt-${index + 1}`,
    );

    for (const entry of entries) {
      await appendEntries([entry]);
    }

    const listed = await listEntries();
    expect(listed).toHaveLength(COMPOSER_INPUT_HISTORY_MAX_ENTRIES);
    expect(listed[0]).toBe('prompt-6');
    expect(listed.at(-1)).toBe(`prompt-${COMPOSER_INPUT_HISTORY_MAX_ENTRIES + 5}`);
  });

  it('批量写满后再追加一条，仍裁剪到最新五十条', async () => {
    const entries = Array.from(
      { length: COMPOSER_INPUT_HISTORY_MAX_ENTRIES },
      (_, index) => `batch-${index + 1}`,
    );
    await appendEntries(entries);
    await appendEntries(['batch-51']);

    const listed = await listEntries();
    expect(listed).toHaveLength(COMPOSER_INPUT_HISTORY_MAX_ENTRIES);
    expect(listed[0]).toBe('batch-2');
    expect(listed.at(-1)).toBe('batch-51');
  });

  it('跨请求与单次批量都做相邻去重', async () => {
    await appendEntries(['重复']);
    await appendEntries(['重复']);
    expect(await listEntries()).toEqual(['重复']);

    await appendEntries(['重复', '下一条', '下一条']);
    expect(await listEntries()).toEqual(['重复', '下一条']);
  });

  it('批量追加可用于迁移 pending 历史，空文本被忽略', async () => {
    const { statusCode, body } = await appendEntries(['迁移一', '   ', '迁移二']);

    expect(statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.entries).toEqual(['迁移一', '迁移二']);
    await expect(listEntries()).resolves.toEqual(['迁移一', '迁移二']);
  });

  it('不同会话的历史互相隔离', async () => {
    await appendEntries(['A 会话']);
    await appendEntries(['B 会话'], OTHER_SESSION_ID);

    await expect(listEntries()).resolves.toEqual(['A 会话']);
    await expect(listEntries(OTHER_SESSION_ID)).resolves.toEqual(['B 会话']);
  });

  it('批量超过五十条或空数组被拒绝', async () => {
    const tooMany = Array.from(
      { length: COMPOSER_INPUT_HISTORY_MAX_ENTRIES + 1 },
      (_, index) => `entry-${index}`,
    );
    const tooManyResponse = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { entries: tooMany },
      url: historyUrl(),
    });
    expect(tooManyResponse.statusCode).toBe(400);

    const emptyResponse = await app.inject({
      headers: authHeaders(),
      method: 'POST',
      payload: { entries: [] },
      url: historyUrl(),
    });
    expect(emptyResponse.statusCode).toBe(400);
  });
});
