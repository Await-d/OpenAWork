/**
 * `channel_chat` 作用域孤儿的清理契约（真实内存 SQLite + 迁移）。
 *
 * 背景：渠道会话的记忆与规则落在 `memories` / `memory_rule_entries`，其作用域 id 由入站
 * 来源（`memory_message_provenance`）派生为
 * `channel:<platform>:<channelInstanceId>:chat:<chatId>`。这两张权威表**没有**指向
 * `sessions` 的外键，而注入侧按 scope id 字符串匹配、**不校验**对应渠道会话是否仍存在——
 * 于是会话删除后若不显式清理，会留下「删了会话仍被命中」的孤儿。
 *
 * 清理语义（刻意保守，本测试即冻结该契约）：
 *   1. 只清**本会话来源派生**且**已无其它会话引用**的 scope id（作用域失效）；
 *   2. 只碰 `scope_type = 'channel_chat'`，user / workspace / team 一律不动；
 *   3. 幂等。
 *
 * 夹具说明：以 `PRAGMA foreign_keys = OFF` 运行（与线上畸形恢复路径一致），因此不需要真
 * 造 `sessions` 行即可验证清理语义本身。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as CleanupModule from '../../memory/channel-chat-scope-cleanup.js';
import type * as RecoveryModule from '../../session/session-delete-recovery.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let cleanup: typeof CleanupModule;
let recovery: typeof RecoveryModule;

const USER_ID = 'u-scope-cleanup';
const TARGET_SESSION = 'sess-target';
const OTHER_SESSION = 'sess-other';

/** 与 `memoryChannelScopeKey` 同构：`channel:<platform>:<instance>:chat:<chatId>`。 */
function channelScopeId(platform: string, instanceId: string, chatId: string): string {
  return `channel:${platform}:${instanceId}:chat:${chatId}`;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  cleanup = await import('../../memory/channel-chat-scope-cleanup.js');
  recovery = await import('../../session/session-delete-recovery.js');
});

beforeEach(() => {
  // 恢复路径本身即在 FK 关闭下运行；这里同样关闭，避免为夹具真造 sessions 行。
  dbModule.db.exec('PRAGMA foreign_keys = OFF');
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM memory_rule_entries', []);
  dbModule.sqliteRun('DELETE FROM memory_message_provenance', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function addProvenance(input: {
  id: string;
  sessionId: string;
  platform?: string;
  instanceId?: string;
  chatId?: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_message_provenance
       (id, session_id, channel_message_id, platform, channel_instance_id, chat_id, chat_type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'group', datetime('now'))`,
    [
      input.id,
      input.sessionId,
      `msg-${input.id}`,
      input.platform ?? 'wechat',
      input.instanceId ?? 'inst-1',
      input.chatId ?? 'chat-1',
    ],
  );
}

function addMemory(scopeType: string, scopeId: string, key: string): void {
  dbModule.sqliteRun(
    `INSERT INTO memories (id, user_id, type, key, value, scope_type, scope_id)
     VALUES (?, ?, 'fact', ?, ?, ?, ?)`,
    [`mem-${scopeType}-${key}`, USER_ID, key, `value-${key}`, scopeType, scopeId],
  );
}

function addRule(scopeType: string, scopeId: string, name: string): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_rule_entries
       (id, user_id, scope_type, scope_id, name, body, confirmed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'body', datetime('now'), datetime('now'), datetime('now'))`,
    [`rule-${scopeType}-${name}`, USER_ID, scopeType, scopeId, name],
  );
}

function countMemories(scopeType: string, scopeId: string): number {
  return (
    dbModule.sqliteGet<{ n: number }>(
      'SELECT COUNT(*) AS n FROM memories WHERE user_id = ? AND scope_type = ? AND scope_id = ?',
      [USER_ID, scopeType, scopeId],
    )?.n ?? 0
  );
}

function countRules(scopeType: string, scopeId: string): number {
  return (
    dbModule.sqliteGet<{ n: number }>(
      'SELECT COUNT(*) AS n FROM memory_rule_entries WHERE user_id = ? AND scope_type = ? AND scope_id = ?',
      [USER_ID, scopeType, scopeId],
    )?.n ?? 0
  );
}

function runCleanup(sessionId = TARGET_SESSION): void {
  recovery.purgeOrphanedChannelChatScopeRows({ sessionId, userId: USER_ID });
}

describe('channel_chat 作用域孤儿清理', () => {
  it('会话删除后清掉「本会话派生、且已无其它会话引用」的记忆与规则', () => {
    const scopeId = channelScopeId('wechat', 'inst-1', 'chat-1');
    addProvenance({ id: 'p-target', sessionId: TARGET_SESSION, chatId: 'chat-1' });
    addMemory('channel_chat', scopeId, 'group-topic');
    addRule('channel_chat', scopeId, '群规');

    expect(countMemories('channel_chat', scopeId)).toBe(1);
    expect(countRules('channel_chat', scopeId)).toBe(1);

    runCleanup();

    expect(countMemories('channel_chat', scopeId)).toBe(0);
    expect(countRules('channel_chat', scopeId)).toBe(0);
  });

  it('同一作用域仍被其它会话引用时保留（作用域未失效，避免误删仍可达的群记忆）', () => {
    const scopeId = channelScopeId('wechat', 'inst-1', 'chat-shared');
    addProvenance({ id: 'p-target', sessionId: TARGET_SESSION, chatId: 'chat-shared' });
    addProvenance({ id: 'p-other', sessionId: OTHER_SESSION, chatId: 'chat-shared' });
    addMemory('channel_chat', scopeId, 'shared-topic');
    addRule('channel_chat', scopeId, '共享群规');

    runCleanup();

    expect(countMemories('channel_chat', scopeId)).toBe(1);
    expect(countRules('channel_chat', scopeId)).toBe(1);
  });

  it('其它作用域（user / workspace / team）一律不动', () => {
    // 让本会话派生一个真实的 channel scope，确保清理的 IN 子查询非空。
    addProvenance({ id: 'p-target', sessionId: TARGET_SESSION, chatId: 'chat-2' });
    addMemory('user', USER_ID, 'pref');
    addMemory('workspace', '/repo/a', 'ws-note');
    addMemory('team', 'team-1', 'team-note');
    addRule('user', USER_ID, '全局规则');

    runCleanup();

    expect(countMemories('user', USER_ID)).toBe(1);
    expect(countMemories('workspace', '/repo/a')).toBe(1);
    expect(countMemories('team', 'team-1')).toBe(1);
    expect(countRules('user', USER_ID)).toBe(1);
  });

  it('幂等：来源行未删时重复执行不误删；来源行删净后再次执行也不报错', () => {
    const scopeId = channelScopeId('wechat', 'inst-1', 'chat-3');
    addProvenance({ id: 'p-target', sessionId: TARGET_SESSION, chatId: 'chat-3' });
    addMemory('channel_chat', scopeId, 'topic-3');

    runCleanup();
    expect(countMemories('channel_chat', scopeId)).toBe(0);

    // 未删来源行时重复执行：仍不报错、且不会波及别的作用域。
    expect(() => runCleanup()).not.toThrow();

    // 模拟真实顺序的后半段：来源行随会话删除被清掉，再次执行（子查询为空集）仍安全。
    dbModule.sqliteRun('DELETE FROM memory_message_provenance WHERE session_id = ?', [
      TARGET_SESSION,
    ]);
    expect(() => runCleanup()).not.toThrow();
    expect(countMemories('channel_chat', scopeId)).toBe(0);
  });

  it('清理语句只删除 memories / memory_rule_entries（SQL 形状与来源派生表达式一致）', () => {
    // 冻结 SQL 契约：作用域表达式必须由 provenance 四字段拼出，且限定 channel_chat。
    const memoriesSql = cleanup.buildDeleteOrphanedChannelChatMemoriesSql();
    const rulesSql = cleanup.buildDeleteOrphanedChannelChatRulesSql();
    for (const sql of [memoriesSql, rulesSql]) {
      expect(sql).toContain("scope_type = 'channel_chat'");
      expect(sql).toContain(cleanup.DERIVED_CHANNEL_SCOPE_EXPRESSION);
      expect(sql).toContain('WHERE session_id <> ?');
    }
    expect(memoriesSql).toContain('DELETE FROM memories');
    expect(rulesSql).toContain('DELETE FROM memory_rule_entries');
  });
});
