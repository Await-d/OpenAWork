/**
 * Regression tests for「按请求族（clientRequestId）读写」的五个入口。
 *
 * 背景：`getSessionMessageByRequestId` / `listSessionMessagesByRequestScope` /
 * `updateSessionMessagesStatusByRequestScope` / `deleteSessionMessagesByRequestScope` /
 * `deleteSessionMessagesByExactRequestRole` 过去一律 `SELECT … 整会话` 再在 JS 里逐行
 * `JSON.parse` 过滤（前两个还走更重的 `listSessionMessagesV2`，连带把全部 part 读出来）。
 * 现在过滤下沉到 SQL：`(role IN (…) OR role = '')` 走索引剪枝 +
 * `CASE WHEN json_valid(data) THEN json_extract(data, '$.clientRequestId') END` 预筛，
 * 再由与旧实现逐字一致的 `matchesRequestScopeRow` 做最终判定。
 *
 * 这组用例钉住两件事：
 *   1. 语义完全不变——前缀族、大小写、LIKE 元字符、role 过滤、精确 vs 前缀；
 *   2. 预筛是**超集**——索引列（role）尚未回填的行也不能被漏掉。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'message-v2-request-scope-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;

const USER_ID = 'u-request-scope';
const SESSION_ID = 'sess-request-scope';
const BASE_TIME = 1_700_000_000_000;

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'request-scope@example.test',
    'x',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, messages_json, state_status, metadata_json, title)
     VALUES (?, ?, '[]', 'idle', '{}', ?)`,
    [SESSION_ID, USER_ID, SESSION_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM part_v2 WHERE session_id = ?', [SESSION_ID]);
  dbModule.sqliteRun('DELETE FROM message_v2 WHERE session_id = ?', [SESSION_ID]);
});

function append(input: {
  clientRequestId?: string;
  content: string;
  createdAt: number;
  replaceExisting?: boolean;
  role: 'user' | 'assistant';
}): string {
  return adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: input.role,
    ...(input.clientRequestId === undefined ? {} : { clientRequestId: input.clientRequestId }),
    createdAt: input.createdAt,
    content: [{ type: 'text', text: input.content }],
    ...(input.replaceExisting === undefined ? {} : { replaceExisting: input.replaceExisting }),
  }).id;
}

/** 请求族 `req-1`：user(root) + assistant + assistant，外加另一族 `req-2`。 */
function seedTwoRequestFamilies(): {
  rootUserId: string;
  firstAssistantId: string;
  secondAssistantId: string;
  otherTurnUserId: string;
} {
  const rootUserId = append({
    clientRequestId: 'req-1',
    content: '第一问',
    createdAt: BASE_TIME,
    role: 'user',
  });
  const firstAssistantId = append({
    clientRequestId: 'req-1:assistant:1',
    content: '第一答',
    createdAt: BASE_TIME + 1,
    role: 'assistant',
  });
  const secondAssistantId = append({
    clientRequestId: 'req-1:assistant:2',
    content: '第一答续',
    createdAt: BASE_TIME + 2,
    role: 'assistant',
  });
  const otherTurnUserId = append({
    clientRequestId: 'req-2',
    content: '第二问',
    createdAt: BASE_TIME + 3,
    role: 'user',
  });
  return { rootUserId, firstAssistantId, secondAssistantId, otherTurnUserId };
}

function storedInfo(id: string): Record<string, unknown> {
  const row = dbModule.sqliteGet<{ data: string }>('SELECT data FROM message_v2 WHERE id = ?', [
    id,
  ]);
  return row ? (JSON.parse(row.data) as Record<string, unknown>) : {};
}

function storedStatus(id: string): string {
  return String(storedInfo(id)['status'] ?? '');
}

function liveIds(): string[] {
  return dbModule
    .sqliteAll<{ id: string }>(
      'SELECT id FROM message_v2 WHERE session_id = ? AND id IS NOT NULL ORDER BY time_created ASC, id ASC',
      [SESSION_ID],
    )
    .map((row) => row.id);
}

function textOf(message: { content: readonly unknown[] }): string {
  const first = message.content[0] as { text?: string } | undefined;
  return first?.text ?? '';
}

describe('listSessionMessagesByRequestScope', () => {
  it('返回 root 与其派生子回合（时间升序），不碰其它请求族', () => {
    const seeded = seedTwoRequestFamilies();

    const messages = adapter.listSessionMessagesByRequestScope({
      clientRequestId: 'req-1',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(messages.map((message) => message.id)).toEqual([
      seeded.rootUserId,
      seeded.firstAssistantId,
      seeded.secondAssistantId,
    ]);
    expect(messages.map(textOf)).toEqual(['第一问', '第一答', '第一答续']);
  });

  it('大小写敏感：LIKE 预筛不得把 REQ-9 当成 req-9', () => {
    const lower = append({
      clientRequestId: 'req-9:assistant:1',
      content: '小写',
      createdAt: BASE_TIME,
      role: 'assistant',
    });
    append({
      clientRequestId: 'REQ-9:assistant:1',
      content: '大写',
      createdAt: BASE_TIME + 1,
      role: 'assistant',
    });

    const messages = adapter.listSessionMessagesByRequestScope({
      clientRequestId: 'req-9',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(messages.map((message) => message.id)).toEqual([lower]);
  });

  it('LIKE 元字符按字面处理：50%off 不匹配 50Xoff', () => {
    const literal = append({
      clientRequestId: '50%off',
      content: '字面',
      createdAt: BASE_TIME,
      role: 'user',
    });
    append({ clientRequestId: '50Xoff', content: '干扰', createdAt: BASE_TIME + 1, role: 'user' });

    const messages = adapter.listSessionMessagesByRequestScope({
      clientRequestId: '50%off',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(messages.map((message) => message.id)).toEqual([literal]);
  });

  it('无命中时返回空数组', () => {
    seedTwoRequestFamilies();

    expect(
      adapter.listSessionMessagesByRequestScope({
        clientRequestId: 'never-used',
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toEqual([]);
  });
});

describe('getSessionMessageByRequestId', () => {
  it('精确命中并带回完整正文（part 已挂载）', () => {
    const seeded = seedTwoRequestFamilies();

    const found = adapter.getSessionMessageByRequestId({
      clientRequestId: 'req-1:assistant:2',
      role: 'assistant',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(found?.message.id).toBe(seeded.secondAssistantId);
    expect(textOf(found!.message)).toBe('第一答续');
    expect(found?.status).toBe('final');
  });

  it('只有前缀相同的兄弟消息时返回 null（精确语义，不回退成前缀匹配）', () => {
    seedTwoRequestFamilies();

    expect(
      adapter.getSessionMessageByRequestId({
        clientRequestId: 'req-1:assistant:1',
        role: 'user',
        sessionId: SESSION_ID,
        userId: USER_ID,
      }),
    ).toBeNull();
  });

  it('status=error 的回合被如实回传（重放判定依赖它）', () => {
    const seeded = seedTwoRequestFamilies();
    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      roles: ['assistant'],
      sessionId: SESSION_ID,
      status: 'error',
      userId: USER_ID,
    });

    const found = adapter.getSessionMessageByRequestId({
      clientRequestId: 'req-1:assistant:1',
      role: 'assistant',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(found?.message.id).toBe(seeded.firstAssistantId);
    expect(found?.status).toBe('error');
  });
});

describe('updateSessionMessagesStatusByRequestScope', () => {
  it('按 role 过滤前缀命中：只改本回合的 assistant 行，且不新增行', () => {
    const seeded = seedTwoRequestFamilies();
    const before = liveIds().length;

    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      roles: ['assistant'],
      sessionId: SESSION_ID,
      status: 'error',
      userId: USER_ID,
    });

    expect(liveIds().length).toBe(before);
    expect(storedStatus(seeded.firstAssistantId)).toBe('error');
    expect(storedStatus(seeded.secondAssistantId)).toBe('error');
    expect(storedStatus(seeded.rootUserId)).toBe('');
    expect(storedStatus(seeded.otherTurnUserId)).toBe('');
    // 落库形态与 projector 一致：data 里不重复存 id / sessionID。
    expect(storedInfo(seeded.firstAssistantId)).not.toHaveProperty('id');
    expect(storedInfo(seeded.firstAssistantId)).not.toHaveProperty('sessionID');
  });

  it('roles 只给 user 时只命中 root 消息', () => {
    const seeded = seedTwoRequestFamilies();

    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      roles: ['user'],
      sessionId: SESSION_ID,
      status: 'final',
      userId: USER_ID,
    });

    expect(storedStatus(seeded.rootUserId)).toBe('final');
    expect(storedStatus(seeded.firstAssistantId)).toBe('');
  });

  it('role 反规范化列尚未回填（空串）时仍按 data.role 命中（SQL 预筛必须是超集）', () => {
    const seeded = seedTwoRequestFamilies();
    // 模拟迁移前写入的行：索引列缺失，role 只存在于 data JSON 里。
    dbModule.sqliteRun('UPDATE message_v2 SET role = ? WHERE session_id = ?', ['', SESSION_ID]);

    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req-1',
      roles: ['assistant'],
      sessionId: SESSION_ID,
      status: 'error',
      userId: USER_ID,
    });

    expect(storedStatus(seeded.firstAssistantId)).toBe('error');
    expect(storedStatus(seeded.secondAssistantId)).toBe('error');
  });
});

describe('deleteSessionMessagesByRequestScope', () => {
  it('带 roles 时只删助手行', () => {
    const seeded = seedTwoRequestFamilies();

    adapter.deleteSessionMessagesByRequestScope({
      clientRequestId: 'req-1',
      roles: ['assistant'],
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(liveIds()).toEqual([seeded.rootUserId, seeded.otherTurnUserId]);
    expect(
      dbModule.sqliteGet<{ c: number }>('SELECT count(*) AS c FROM part_v2 WHERE session_id = ?', [
        SESSION_ID,
      ])?.c,
    ).toBe(2);
  });

  it('不带 roles 时整族删除，其它请求族不受影响', () => {
    const seeded = seedTwoRequestFamilies();

    adapter.deleteSessionMessagesByRequestScope({
      clientRequestId: 'req-1',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(liveIds()).toEqual([seeded.otherTurnUserId]);
  });
});

describe('replaceExisting 重复写入（deleteSessionMessagesByExactRequestRole）', () => {
  it('只覆盖精确同 clientRequestId + role 的行，不误删派生子回合', () => {
    const first = append({
      clientRequestId: 'req-3',
      content: '旧提问',
      createdAt: BASE_TIME,
      role: 'user',
    });
    const sibling = append({
      clientRequestId: 'req-3:assistant:1',
      content: '旧回答',
      createdAt: BASE_TIME + 1,
      role: 'assistant',
    });

    const replacement = append({
      clientRequestId: 'req-3',
      content: '新提问',
      createdAt: BASE_TIME + 2,
      replaceExisting: true,
      role: 'user',
    });

    expect(liveIds()).toEqual([sibling, replacement]);
    expect(liveIds()).not.toContain(first);
  });
});

describe('读路径对残缺 tokens 的容错', () => {
  it('assistant 行缺 tokens / cache 时不再让整会话读取抛错，且不虚构用量', () => {
    const seeded = seedTwoRequestFamilies();
    dbModule.sqliteRun("UPDATE message_v2 SET data = json_remove(data, '$.tokens') WHERE id = ?", [
      seeded.firstAssistantId,
    ]);

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    const broken = messages.find((message) => message.id === seeded.firstAssistantId);

    expect(broken).toBeDefined();
    expect(broken?.providerUsage).toBeUndefined();
    // 同一会话里其它消息照常可读。
    expect(messages.map((message) => message.id)).toContain(seeded.secondAssistantId);
  });

  it('tokens 存在但缺 cache 子对象时同样不抛错', () => {
    const seeded = seedTwoRequestFamilies();
    dbModule.sqliteRun(
      "UPDATE message_v2 SET data = json_remove(data, '$.tokens.cache') WHERE id = ?",
      [seeded.firstAssistantId],
    );

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    const message = messages.find((item) => item.id === seeded.firstAssistantId);

    expect(message?.providerUsage).toBeUndefined();
  });

  it('正常带 tokens 的 assistant 行仍回传 providerUsage', () => {
    const assistantId = append({
      clientRequestId: 'req-usage',
      content: '带用量',
      createdAt: BASE_TIME,
      role: 'assistant',
    });
    dbModule.sqliteRun(
      "UPDATE message_v2 SET data = json_set(data, '$.tokens.input', 120, '$.tokens.output', 30, '$.tokens.cache.read', 10, '$.tokens.cache.write', 5, '$.tokens.total', 165) WHERE id = ?",
      [assistantId],
    );

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    const message = messages.find((item) => item.id === assistantId);

    expect(message?.providerUsage).toMatchObject({
      inputTokens: 120,
      outputTokens: 30,
      cacheReadTokens: 10,
      cacheWriteTokens: 5,
      totalTokens: 165,
    });
  });
});

describe('client_request_id 反规范化列与请求族区间扫描', () => {
  function storedRequestIds(): string[] {
    return dbModule
      .sqliteAll<{ client_request_id: string }>(
        'SELECT client_request_id FROM message_v2 WHERE session_id = ? ORDER BY time_created ASC, id ASC',
        [SESSION_ID],
      )
      .map((row) => row.client_request_id);
  }

  function scopeIds(clientRequestId: string): string[] {
    return adapter
      .listSessionMessagesByRequestScope({
        clientRequestId,
        sessionId: SESSION_ID,
        userId: USER_ID,
      })
      .map((message) => message.id);
  }

  it('projector 写入时同步落列（请求族查询不再解析 data）', () => {
    seedTwoRequestFamilies();

    expect(storedRequestIds()).toEqual([
      'req-1',
      'req-1:assistant:1',
      'req-1:assistant:2',
      'req-2',
    ]);
  });

  it('同一消息改写请求族时索引列同步刷新（列与 data 不得脱节）', () => {
    const seeded = seedTwoRequestFamilies();

    // 同一个 messageId 重写 → ON CONFLICT 分支必须刷新 client_request_id，
    // 否则旧族还能命中、新族永远查不到。
    adapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'assistant',
      messageId: seeded.firstAssistantId,
      clientRequestId: 'req-rebound',
      createdAt: BASE_TIME + 1,
      content: [{ type: 'text', text: '第一答' }],
    });

    const row = dbModule.sqliteGet<{ client_request_id: string }>(
      'SELECT client_request_id FROM message_v2 WHERE id = ?',
      [seeded.firstAssistantId],
    );
    expect(row?.client_request_id).toBe('req-rebound');
    expect(scopeIds('req-rebound')).toEqual([seeded.firstAssistantId]);
    expect(scopeIds('req-1')).toEqual([seeded.rootUserId, seeded.secondAssistantId]);
  });

  it('更短的 root 不吞并 req-1 / req-2（区间是超集，判定必须精确）', () => {
    const seeded = seedTwoRequestFamilies();

    expect(scopeIds('req')).toEqual([]);

    adapter.updateSessionMessagesStatusByRequestScope({
      clientRequestId: 'req',
      roles: ['assistant'],
      sessionId: SESSION_ID,
      status: 'error',
      userId: USER_ID,
    });
    expect(storedStatus(seeded.firstAssistantId)).toBe('');
    expect(storedStatus(seeded.secondAssistantId)).toBe('');
  });

  it('请求族查询骑 idx_message_v2_session_request，不退化成扫描整个会话', () => {
    seedTwoRequestFamilies();

    const plan = dbModule.sqliteAll<{ detail: string }>(
      `EXPLAIN QUERY PLAN
       SELECT * FROM message_v2
        WHERE session_id = ? AND user_id = ? AND id IS NOT NULL
          AND client_request_id >= ? AND client_request_id < ?
        ORDER BY time_created ASC, id ASC`,
      [SESSION_ID, USER_ID, 'req-1', 'req-1;'],
    );

    expect(plan.some((row) => row.detail.includes('idx_message_v2_session_request'))).toBe(true);
  });

  it('backfill 回填存量行；列缺失时索引查询查不到（列为唯一真相源）', () => {
    const seeded = seedTwoRequestFamilies();
    dbModule.sqliteRun('UPDATE message_v2 SET client_request_id = ? WHERE session_id = ?', [
      '',
      SESSION_ID,
    ]);
    expect(scopeIds('req-1')).toEqual([]);

    dbModule.backfillMessageClientRequestId();

    expect(scopeIds('req-1')).toEqual([
      seeded.rootUserId,
      seeded.firstAssistantId,
      seeded.secondAssistantId,
    ]);
  });

  it('backfill 跳过损坏 / 缺 clientRequestId 的 data，不抛错也不写坏值', () => {
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, role, client_request_id, data)
       VALUES ('m-broken-request', ?, ?, ?, 'assistant', '', 'not-json')`,
      [SESSION_ID, USER_ID, BASE_TIME],
    );
    dbModule.sqliteRun(
      `INSERT INTO message_v2 (id, session_id, user_id, time_created, role, client_request_id, data)
       VALUES ('m-no-request', ?, ?, ?, 'assistant', '', '{"role":"assistant"}')`,
      [SESSION_ID, USER_ID, BASE_TIME + 1],
    );

    expect(() => dbModule.backfillMessageClientRequestId()).not.toThrow();

    const rows = dbModule.sqliteAll<{ id: string; client_request_id: string }>(
      'SELECT id, client_request_id FROM message_v2 WHERE session_id = ? ORDER BY id ASC',
      [SESSION_ID],
    );
    expect(rows).toEqual([
      { id: 'm-broken-request', client_request_id: '' },
      { id: 'm-no-request', client_request_id: '' },
    ]);
  });

  it('backfill 幂等：重复执行不会污染已回填的行', () => {
    seedTwoRequestFamilies();
    dbModule.backfillMessageClientRequestId();
    dbModule.backfillMessageClientRequestId();

    expect(storedRequestIds()).toEqual([
      'req-1',
      'req-1:assistant:1',
      'req-1:assistant:2',
      'req-2',
    ]);
  });
});
