/**
 * 渠道隔离的端到端回归（261101-记忆确认写入与周期整理）。
 *
 * 这是本次改造要修的**核心越权面**：消息渠道会话由外部群成员驱动，但运行身份是渠道 owner。
 * 历史实现按「owner 的全量启用记忆」注入，等于把 owner 的私人记忆喂给了群里的任意提问者。
 *
 * 本文件不复用他人用例，直接从库里种数据、走真实的 `buildMemoryBlockForSession` 断言：
 *   1. 渠道会话看得到**本对话**的记忆，看不到 owner 的个人记忆；
 *   2. 个人会话看得到自己的个人记忆，看不到渠道对话的记忆（双向隔离，不只是单向）；
 *   3. 「按作用域查库」与「注入块白名单」两个入口永远给出同一批作用域（防分叉）。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MemoryRuntimeModule from '../../memory/memory-runtime.js';
import type * as ScopeResolverModule from '../../memory/governance/memory-scope-resolver.js';
import type * as AgentCoreModule from '@openAwork/agent-core';
import type { MemorySourceProvenance } from '@openAwork/agent-core';

process.env['DATABASE_URL'] = ':memory:';

let dbModule: typeof DbModule;
let buildMemoryBlockForSession: typeof MemoryRuntimeModule.buildMemoryBlockForSession;
let resolveAllowedInjectionScopes: typeof ScopeResolverModule.resolveAllowedInjectionScopes;
let resolveAllowedInjectionScopeObjects: typeof ScopeResolverModule.resolveAllowedInjectionScopeObjects;
let userMemoryScope: typeof AgentCoreModule.userMemoryScope;
let channelChatMemoryScope: typeof AgentCoreModule.channelChatMemoryScope;
let memoryScopeKey: typeof AgentCoreModule.memoryScopeKey;

const USER_ID = 'u-isolation';

const PROVENANCE: MemorySourceProvenance = {
  platform: 'telegram',
  channelInstanceId: 'inst-1',
  chatId: 'grp-1',
  chatType: 'group',
  senderId: 'member-1',
  senderName: '群成员',
  platformMessageId: 'msg-1',
};

/** 渠道会话 metadata（`source: 'channel'` 是隔离判定的依据）。 */
const CHANNEL_METADATA = JSON.stringify({
  source: 'channel',
  channelChatId: 'grp-1',
  channelActor: { platformUserId: 'member-1' },
});

function seedMemory(input: {
  id: string;
  key: string;
  value: string;
  scopeType: string;
  scopeId: string;
}): void {
  dbModule.sqliteRun(
    `INSERT INTO memories (
       id, user_id, type, key, value, source, confidence, priority, workspace_root,
       team_workspace_id, role_layers_json, enabled, created_at, updated_at,
       scope_type, scope_id, lifecycle, revision, change_seq, confirmation_kind
     ) VALUES (?, ?, 'fact', ?, ?, 'manual', 1, 50, NULL, NULL, NULL, 1,
       datetime('now'), datetime('now'), ?, ?, 'active', 1, 1, 'manual')`,
    [input.id, USER_ID, input.key, input.value, input.scopeType, input.scopeId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  const runtime = await import('../../memory/memory-runtime.js');
  buildMemoryBlockForSession = runtime.buildMemoryBlockForSession;
  const resolver = await import('../../memory/governance/memory-scope-resolver.js');
  resolveAllowedInjectionScopes = resolver.resolveAllowedInjectionScopes;
  resolveAllowedInjectionScopeObjects = resolver.resolveAllowedInjectionScopeObjects;
  const core = await import('@openAwork/agent-core');
  userMemoryScope = core.userMemoryScope;
  channelChatMemoryScope = core.channelChatMemoryScope;
  memoryScopeKey = core.memoryScopeKey;
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memories', []);
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

function seedBothScopes(): void {
  const user = userMemoryScope(USER_ID);
  const chat = channelChatMemoryScope(PROVENANCE);
  seedMemory({
    id: 'm-private',
    key: 'personal-preference',
    value: 'PRIVATE-OWNER-NOTE',
    scopeType: user.type,
    scopeId: user.id,
  });
  seedMemory({
    id: 'm-chat',
    key: 'chat-convention',
    value: 'CHAT-ONLY-NOTE',
    scopeType: chat.type,
    scopeId: chat.id,
  });
}

describe('渠道会话与个人记忆的隔离', () => {
  it('渠道会话只看到本对话的记忆，看不到 owner 的个人记忆', () => {
    seedBothScopes();

    const block = buildMemoryBlockForSession(USER_ID, CHANNEL_METADATA, PROVENANCE) ?? '';

    expect(block).toContain('CHAT-ONLY-NOTE');
    expect(block).not.toContain('PRIVATE-OWNER-NOTE');
  });

  it('渠道会话缺少来源信息时不注入任何记忆（fail-closed）', () => {
    seedBothScopes();

    const block = buildMemoryBlockForSession(USER_ID, CHANNEL_METADATA, null) ?? '';

    expect(block).not.toContain('CHAT-ONLY-NOTE');
    expect(block).not.toContain('PRIVATE-OWNER-NOTE');
  });

  it('个人会话看得到自己的记忆，看不到渠道对话的记忆（双向隔离）', () => {
    seedBothScopes();

    const block = buildMemoryBlockForSession(USER_ID, '{}', null) ?? '';

    expect(block).toContain('PRIVATE-OWNER-NOTE');
    expect(block).not.toContain('CHAT-ONLY-NOTE');
  });

  it('「按作用域查库」与「注入块白名单」始终给出同一批作用域', () => {
    const inputs = [
      { userId: USER_ID, metadataJson: '{}', provenance: null },
      { userId: USER_ID, metadataJson: JSON.stringify({ workingDirectory: '/tmp/proj' }) },
      { userId: USER_ID, metadataJson: JSON.stringify({ teamWorkspaceId: 'tw-1' }) },
      {
        userId: USER_ID,
        metadataJson: CHANNEL_METADATA,
        provenance: PROVENANCE,
      },
      { userId: USER_ID, metadataJson: CHANNEL_METADATA, provenance: null },
      { userId: USER_ID, metadataJson: 'not-json' },
    ];

    for (const input of inputs) {
      const keys = resolveAllowedInjectionScopes(input);
      const objects = resolveAllowedInjectionScopeObjects(input);
      expect([...keys]).toEqual(objects.map(memoryScopeKey));
    }
  });
});
