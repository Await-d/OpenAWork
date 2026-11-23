/**
 * Regression coverage for `channel_chat` scope leak across session deletion
 * (261104-渠道作用域记忆泄漏).
 *
 * `memories` / `memory_rule_entries` hold channel memories whose scope id is
 * derived from the frozen inbound provenance (`memory_message_provenance`):
 *
 *   `channel:<platform>:<channelInstanceId>:chat:<chatId>`
 *
 * Neither table has a foreign key to `sessions`, so deleting a session (normal
 * path cascades only the provenance rows; the malformed recovery path needs
 * explicit deletes) never reached them. Because injection matches the scope id
 * as a plain string without checking that the channel/session still exists,
 * those rows could still be hit after the session was gone.
 *
 * These tests freeze the contract: deleting a session purges the channel_chat
 * memories/rules that its provenance derived AND that no surviving session
 * still references, while user/workspace/team scopes and scopes backed by a
 * surviving sibling session are left untouched. Repeated deletion is a no-op.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthModule from '../../infra/auth.js';
import type * as DbModule from '../../infra/db.js';
import { registerErrorHandler } from '../../infra/error-handler.js';
import type * as RequestWorkflowModule from '../../runtime/request-workflow.js';
import type * as SessionsRoutesModule from '../../routes/sessions.js';

const workspaceRoot = mkdtempSync(join(tmpdir(), 'openawork-session-delete-channel-scope-'));

process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';
process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_DATA_DIR'] = workspaceRoot;
process.env['JWT_SECRET'] = 'session-delete-channel-scope-secret-1234567890';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['WORKSPACE_ACCESS_MODE'] = 'restricted';
process.env['WORKSPACE_ROOT'] = workspaceRoot;

vi.mock('../../provider/auxiliary-llm-config.js', () => ({
  resolveAuxiliaryLlmConfig: async () => null,
  resolveAuxiliaryLlmConfigCandidates: async () => [],
}));

vi.mock('../../provider/provider-catalog.js', () => ({
  getChatProvider: vi.fn(async () => ({
    provider: { id: 'snapshot-provider' },
    modelId: 'snapshot-model',
  })),
}));

let authPlugin: typeof AuthModule.default;
let dbModule: typeof DbModule;
let requestWorkflowPlugin: typeof RequestWorkflowModule.default;
let sessionsRoutes: typeof SessionsRoutesModule.sessionsRoutes;

const USER_ID = 'u-session-delete-channel-scope';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  registerErrorHandler(app);
  await app.register(requestWorkflowPlugin);
  await app.register(authPlugin);
  await app.register(sessionsRoutes);
  await app.ready();
  return app;
}

function bearer(app: FastifyInstance): string {
  return `Bearer ${app.jwt.sign({ sub: USER_ID, email: 'channel-scope@example.com' })}`;
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

function seedSession(sessionId: string): void {
  dbModule.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'session', '{"source":"channel"}', 'idle')`,
    [sessionId, USER_ID],
  );
}

/** 冻结一条入站来源（会话 metadata 写入时刻的那一次）。 */
function seedProvenance(input: {
  sessionId: string;
  channelMessageId: string;
  platform?: string;
  channelInstanceId: string;
  chatId: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_message_provenance (
       id, session_id, channel_message_id, platform, channel_instance_id, chat_id, chat_type,
       sender_id, sender_name, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'group', NULL, NULL, datetime('now'))`,
    [
      `${input.sessionId}-prov-${input.channelMessageId}`,
      input.sessionId,
      input.channelMessageId,
      input.platform ?? 'telegram',
      input.channelInstanceId,
      input.chatId,
    ],
  );
}

function seedMemory(input: { id: string; scopeType: string; scopeId: string; key: string }): void {
  dbModule.sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority, enabled,
       scope_type, scope_id, lifecycle, revision, change_seq
     ) VALUES (?, ?, 'fact', ?, 'v', 'auto_extracted', 1.0, 50, 1, ?, ?, 'active', 1, 1)`,
    [input.id, USER_ID, input.key, input.scopeType, input.scopeId],
  );
}

function seedRule(input: { id: string; scopeType: string; scopeId: string; name: string }): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_rule_entries (
       id, user_id, scope_type, scope_id, name, body, revision, enabled, confirmed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'body', 1, 1, datetime('now'), datetime('now'), datetime('now'))`,
    [input.id, USER_ID, input.scopeType, input.scopeId, input.name],
  );
}

function channelScopeId(channelInstanceId: string, chatId: string, platform = 'telegram'): string {
  return `channel:${platform}:${channelInstanceId}:chat:${chatId}`;
}

function countMemoriesById(id: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM memories WHERE id = ?',
    [id],
  );
  return row?.count ?? 0;
}

function countRulesById(id: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM memory_rule_entries WHERE id = ?',
    [id],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  authPlugin = (await import('../../infra/auth.js')).default;
  requestWorkflowPlugin = (await import('../../runtime/request-workflow.js')).default;
  sessionsRoutes = (await import('../../routes/sessions.js')).sessionsRoutes;
});

beforeEach(() => {
  // provenance 有 sessions 外键，但 memories / memory_rule_entries 没有，需各自清理。
  dbModule.sqliteRun('DELETE FROM memory_message_provenance', []);
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM memory_rule_entries', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
  rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('会话删除清理 channel_chat 作用域记忆/规则', () => {
  it('删除会话后其 channel_chat 记忆与规则被清理，其它作用域不受影响', async () => {
    seedSession('sess-channel');
    seedProvenance({
      sessionId: 'sess-channel',
      channelMessageId: 'm1',
      channelInstanceId: 'tg-1',
      chatId: '100',
    });
    const scopeId = channelScopeId('tg-1', '100');
    seedMemory({ id: 'mem-channel', scopeType: 'channel_chat', scopeId, key: '群记忆' });
    seedRule({ id: 'rule-channel', scopeType: 'channel_chat', scopeId, name: '群规则' });
    // 其它作用域：user / workspace / team，必须原样保留。
    seedMemory({ id: 'mem-user', scopeType: 'user', scopeId: USER_ID, key: '个人记忆' });
    seedMemory({
      id: 'mem-ws',
      scopeType: 'workspace',
      scopeId: '/tmp/ws',
      key: '工作区记忆',
    });
    seedMemory({ id: 'mem-team', scopeType: 'team', scopeId: 'tw-1', key: '团队记忆' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-channel',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    expect(countMemoriesById('mem-channel')).toBe(0);
    expect(countRulesById('rule-channel')).toBe(0);
    expect(countMemoriesById('mem-user')).toBe(1);
    expect(countMemoriesById('mem-ws')).toBe(1);
    expect(countMemoriesById('mem-team')).toBe(1);
  });

  it('同一渠道对话仍有存活的兄弟会话时，作用域仍有效、记忆不被误删', async () => {
    // 两个会话共享同一 (channelInstance, chatId) → 同一 channel_chat scope id。
    seedSession('sess-a');
    seedSession('sess-b');
    seedProvenance({
      sessionId: 'sess-a',
      channelMessageId: 'a1',
      channelInstanceId: 'tg-2',
      chatId: '200',
    });
    seedProvenance({
      sessionId: 'sess-b',
      channelMessageId: 'b1',
      channelInstanceId: 'tg-2',
      chatId: '200',
    });
    const scopeId = channelScopeId('tg-2', '200');
    seedMemory({ id: 'mem-shared', scopeType: 'channel_chat', scopeId, key: '共享记忆' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-a',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    // sess-b 仍在，作用域未失效 → 不清理。
    expect(countMemoriesById('mem-shared')).toBe(1);
  });

  it('畸形恢复路径同样清理，且重复执行幂等不报错', async () => {
    const { deleteSessionWithMalformedRecovery } =
      await import('../../session/session-delete-recovery.js');
    seedSession('sess-malformed');
    seedProvenance({
      sessionId: 'sess-malformed',
      channelMessageId: 'x1',
      channelInstanceId: 'tg-3',
      chatId: '300',
    });
    const scopeId = channelScopeId('tg-3', '300');
    seedMemory({ id: 'mem-malformed', scopeType: 'channel_chat', scopeId, key: '待清记忆' });
    seedRule({ id: 'rule-malformed', scopeType: 'channel_chat', scopeId, name: '待清规则' });

    deleteSessionWithMalformedRecovery({ sessionId: 'sess-malformed', userId: USER_ID });
    expect(countMemoriesById('mem-malformed')).toBe(0);
    expect(countRulesById('rule-malformed')).toBe(0);

    // 幂等：重复执行不抛错、也不影响其它数据。
    seedMemory({ id: 'mem-user-2', scopeType: 'user', scopeId: USER_ID, key: '个人记忆2' });
    expect(() =>
      deleteSessionWithMalformedRecovery({ sessionId: 'sess-malformed', userId: USER_ID }),
    ).not.toThrow();
    expect(countMemoriesById('mem-user-2')).toBe(1);
  });

  it('没有入站来源的用户手动 channel_chat 记忆不会被会话删除误删', async () => {
    seedSession('sess-no-provenance');
    // 手动创建的 channel_chat 记忆：scope id 结构合法，但没有对应来源行。
    seedMemory({
      id: 'mem-manual-channel',
      scopeType: 'channel_chat',
      scopeId: channelScopeId('tg-manual', '999'),
      key: '手动渠道记忆',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'DELETE',
        url: '/sessions/sess-no-provenance',
        headers: { authorization: bearer(app) },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }

    // 无法从任何来源派生 → 不属于该会话作用域 → 保留（语义存疑，见回报）。
    expect(countMemoriesById('mem-manual-channel')).toBe(1);
  });
});
