/**
 * 可信来源解析与授权门回归（真实内存 SQLite）。
 *
 * 重点是**祖先链**：渠道会话派生的 `task` 子会话不复制 `source: 'channel'`，
 * 只靠当前会话 metadata 判断会被绕过。这些用例锁定修复行为。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as OriginModule from '../../session-extension/session-extension-origin.js';
import type * as AuthzModule from '../../session-extension/session-extension-authorization.js';
import type * as StoreModule from '../../session-extension/session-extension-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let db: typeof DbModule;
let origin: typeof OriginModule;
let authz: typeof AuthzModule;
let store: typeof StoreModule;

const OWNER = 'u-origin-owner';
const OTHER = 'u-origin-other';

function seedUser(id: string): void {
  db.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    `${id}@example.com`,
  ]);
}

function seedSession(params: {
  id: string;
  owner?: string;
  metadata?: Record<string, unknown>;
  roleLayer?: string | null;
  teamParent?: string | null;
}): void {
  db.sqliteRun(
    `INSERT INTO sessions (id, user_id, title, metadata_json, state_status, role_layer, team_parent_session_id)
     VALUES (?, ?, 'demo', ?, 'idle', ?, ?)`,
    [
      params.id,
      params.owner ?? OWNER,
      JSON.stringify(params.metadata ?? {}),
      params.roleLayer ?? null,
      params.teamParent ?? null,
    ],
  );
}

beforeAll(async () => {
  db = await import('../../infra/db.js');
  await db.connectDb();
  await db.migrate();
  origin = await import('../../session-extension/session-extension-origin.js');
  authz = await import('../../session-extension/session-extension-authorization.js');
  store = await import('../../session-extension/session-extension-store.js');
});

afterAll(async () => {
  await db.closeDb();
});

beforeEach(() => {
  db.sqliteRun('DELETE FROM sessions', []);
  // 管理员清单要显式清：用例会写清单行，残留会串到后面的用例。
  db.sqliteRun('DELETE FROM session_extension_admins', []);
  db.sqliteRun('DELETE FROM users', []);
  seedUser(OWNER);
  seedUser(OTHER);
});

describe('来源解析', () => {
  it('渠道标识从 channel.id 读出，而不是恒为 null', () => {
    // 渠道会话的 metadata 形状由 `buildChannelSessionMetadata` 决定：渠道 id 在
    // `channel.id` 下，只有 chatId 在顶层。以前只读顶层 `channelId`，于是
    // `origin.channelId` 永远是 null、操作记录的 channel_id 一直是空的。
    seedSession({
      id: 's-ch-origin',
      metadata: {
        source: 'channel',
        channelChatId: 'chat-1',
        channelExtensionManagementEnabled: true,
        channel: { id: 'plugin-42', type: 'telegram' },
        // 发言者身份同样嵌套存放：顶层没有 `channelActorId` / `actorId`。
        channelActor: { userId: 'u-actor-9', platformUserId: 'platform-9' },
      },
    });

    const resolved = origin.resolveSessionExtensionOrigin('s-ch-origin');
    expect(resolved?.source).toBe('channel');
    expect(resolved?.channelId).toBe('plugin-42');
    expect(resolved?.chatId).toBe('chat-1');
    // 没有它，操作记录的 `requester_actor_id` 恒为 null，规格的「原 requester」落不了地。
    expect(resolved?.actorId).toBe('u-actor-9');
  });

  it('个人会话解析为 web 且默认可管理', () => {
    seedSession({ id: 's-web' });
    const resolved = origin.resolveSessionExtensionOrigin('s-web');
    expect(resolved?.source).toBe('web');
    expect(resolved?.managementEnabled).toBe(true);
    expect(resolved?.ownerUserId).toBe(OWNER);
  });

  it('渠道会话默认不开启扩展管理', () => {
    seedSession({
      id: 's-ch',
      metadata: { source: 'channel', channelId: 'ch-1', channelChatId: 'chat-1' },
    });
    const resolved = origin.resolveSessionExtensionOrigin('s-ch');
    expect(resolved?.source).toBe('channel');
    expect(resolved?.channelId).toBe('ch-1');
    expect(resolved?.chatId).toBe('chat-1');
    expect(resolved?.managementEnabled).toBe(false);
  });

  it('渠道配置显式开启后 managementEnabled 为 true', () => {
    seedSession({
      id: 's-ch-on',
      metadata: {
        source: 'channel',
        channelId: 'ch-1',
        channelExtensionManagementEnabled: true,
      },
    });
    expect(origin.resolveSessionExtensionOrigin('s-ch-on')?.managementEnabled).toBe(true);
  });

  it('渠道派生的 task 子会话沿祖先链继承 channel 来源（回归）', () => {
    seedSession({ id: 's-ch-parent', metadata: { source: 'channel', channelId: 'ch-9' } });
    // delegation.ts 构造的子会话 metadata：只有 parentSessionId，没有 source。
    seedSession({
      id: 's-child',
      metadata: { parentSessionId: 's-ch-parent', createdByTool: 'task' },
    });

    const resolved = origin.resolveSessionExtensionOrigin('s-child');
    expect(resolved?.source).toBe('channel');
    expect(resolved?.originSessionId).toBe('s-ch-parent');
    expect(resolved?.ancestorChain).toEqual(['s-child', 's-ch-parent']);
    expect(resolved?.managementEnabled).toBe(false);
  });

  it('管理工具守卫对渠道子会话返回渠道拒绝文案（子代理不能绕过）', () => {
    seedSession({ id: 's-ch-parent', metadata: { source: 'channel' } });
    seedSession({
      id: 's-child2',
      metadata: { parentSessionId: 's-ch-parent', createdByTool: 'task' },
    });

    const denial = origin.resolveManageToolAncestorDenial(
      origin.resolveSessionExtensionOrigin('s-child2'),
      { subject: '技能安装', missingObject: '技能变更' },
    );
    expect(denial).toBe('消息渠道会话不允许修改技能安装，请在设置页或桌面端操作。');
  });

  it('管理工具守卫对个人会话放行且文案与既有断言一致', () => {
    seedSession({ id: 's-web2' });
    expect(
      origin.resolveManageToolAncestorDenial(origin.resolveSessionExtensionOrigin('s-web2'), {
        subject: 'MCP 配置',
        missingObject: 'MCP 配置变更',
      }),
    ).toBeNull();
    expect(
      origin.resolveManageToolAncestorDenial(null, {
        subject: 'MCP 配置',
        missingObject: 'MCP 配置变更',
      }),
    ).toBe('当前会话不存在或无法解析，已拒绝MCP 配置变更。');
  });

  it('团队会话经 role_layer 识别，不依赖 metadata', () => {
    seedSession({ id: 's-team', roleLayer: 'executor' });
    expect(origin.resolveSessionExtensionOrigin('s-team')?.source).toBe('team');
  });

  it('定时任务会话识别为 cron', () => {
    seedSession({ id: 's-cron', metadata: { source: 'cron' } });
    expect(origin.resolveSessionExtensionOrigin('s-cron')?.source).toBe('cron');
  });

  it('不存在的会话返回 null', () => {
    expect(origin.resolveSessionExtensionOrigin('s-missing')).toBeNull();
  });
});

describe('授权门', () => {
  it('渠道未开启管理时拒绝提案', () => {
    seedSession({ id: 's-ch', metadata: { source: 'channel' } });
    const resolved = origin.resolveSessionExtensionOrigin('s-ch')!;
    const decision = authz.resolveSessionExtensionProposalDecision({
      origin: resolved,
      requestedScope: 'session',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.denialReason).toContain('未开启');
  });

  it('渠道开启后仍拒绝用户级范围', () => {
    seedSession({
      id: 's-ch',
      metadata: { source: 'channel', channelExtensionManagementEnabled: true },
    });
    const resolved = origin.resolveSessionExtensionOrigin('s-ch')!;
    const decision = authz.resolveSessionExtensionProposalDecision({
      origin: resolved,
      requestedScope: 'user',
    });
    expect(decision.allowed).toBe(false);
    expect(decision.effectiveScope).toBe('session');
    expect(decision.denialReason).toContain('只能为当前会话');
  });

  it('派生子会话只读：可以读状态但拒绝提案', () => {
    seedSession({ id: 's-web-parent2' });
    seedSession({
      id: 's-web-child2',
      metadata: { parentSessionId: 's-web-parent2', createdByTool: 'task' },
    });
    const resolved = origin.resolveSessionExtensionOrigin('s-web-child2')!;
    expect(origin.isDescendantSessionOrigin(resolved)).toBe(true);
    expect(authz.resolveSessionExtensionProposalDecision({ origin: resolved })).toMatchObject({
      allowed: false,
    });
  });

  it('父会话本身不是派生子会话，提案照常放行', () => {
    seedSession({ id: 's-web-parent3' });
    const resolved = origin.resolveSessionExtensionOrigin('s-web-parent3')!;
    expect(origin.isDescendantSessionOrigin(resolved)).toBe(false);
    expect(authz.resolveSessionExtensionProposalDecision({ origin: resolved }).allowed).toBe(true);
  });

  it('渠道开启且请求会话级时放行提案（仍需管理员确认）', () => {
    seedSession({
      id: 's-ch',
      metadata: { source: 'channel', channelExtensionManagementEnabled: true },
    });
    const resolved = origin.resolveSessionExtensionOrigin('s-ch')!;
    const decision = authz.resolveSessionExtensionProposalDecision({
      origin: resolved,
      requestedScope: 'session',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.effectiveScope).toBe('session');
    expect(decision.denialReason).toBeNull();
  });

  it('团队 / 定时任务来源一律拒绝', () => {
    seedSession({ id: 's-team', roleLayer: 'reviewer' });
    seedSession({ id: 's-cron', metadata: { source: 'cron' } });
    for (const id of ['s-team', 's-cron']) {
      const resolved = origin.resolveSessionExtensionOrigin(id)!;
      expect(authz.resolveSessionExtensionProposalDecision({ origin: resolved }).allowed).toBe(
        false,
      );
    }
  });

  it('个人会话默认用户级，请求会话级也可放行', () => {
    seedSession({ id: 's-web' });
    const resolved = origin.resolveSessionExtensionOrigin('s-web')!;
    expect(authz.resolveSessionExtensionProposalDecision({ origin: resolved }).effectiveScope).toBe(
      'user',
    );
    expect(
      authz.resolveSessionExtensionProposalDecision({ origin: resolved, requestedScope: 'session' })
        .effectiveScope,
    ).toBe('session');
  });

  it('审批资格：owner 隐式成立，其他用户需在清单内（走生产函数）', () => {
    // 此前这条测的是 `authz.canApproveSessionExtensionOperation`——一个只被测试引用的
    // 重复实现（生产走 `store.isSessionExtensionApprover`）。测重复实现等于没测生产，
    // 这里改为直接断言生产函数与真实的清单表。
    expect(store.isSessionExtensionApprover(OWNER, OWNER)).toBe(true);
    expect(store.isSessionExtensionApprover(OWNER, OTHER)).toBe(false);

    store.addSessionExtensionAdmin(OWNER, OTHER);
    expect(store.isSessionExtensionApprover(OWNER, OTHER)).toBe(true);
  });

  it('审批内容变化后不再视为当前（审批 A 不能执行 B）', () => {
    expect(
      authz.isApprovedContentStillCurrent({
        approvedDigest: 'd1',
        currentDigest: 'd1',
        approvedRevision: 3,
        currentRevision: 3,
      }),
    ).toBe(true);
    expect(
      authz.isApprovedContentStillCurrent({
        approvedDigest: 'd1',
        currentDigest: 'd2',
        approvedRevision: 3,
        currentRevision: 3,
      }),
    ).toBe(false);
    expect(
      authz.isApprovedContentStillCurrent({
        approvedDigest: 'd1',
        currentDigest: 'd1',
        approvedRevision: 3,
        currentRevision: 4,
      }),
    ).toBe(false);
  });
});
