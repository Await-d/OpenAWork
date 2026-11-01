/**
 * 记忆治理渠道通知投递回归（内存 SQLite + migrate）。
 *
 * 覆盖：未配置 PUBLIC_WEB_URL 不入队、有私聊来源才入队、按天幂等、渠道不可用
 * 记失败（attempts+1）而非成功。
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as DispatcherModule from '../../memory/maintenance/memory-delivery-dispatcher.js';
import { channelManager } from '../../channels/manager.js';
import type { MessagingChannelService } from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let dispatcher: typeof DispatcherModule;

const USER_ID = 'u-maint-delivery';
const CHANNEL_ID = 'delivery-channel-1';
const CHAT_ID = 'delivery-chat-1';
const SESSION_ID = 'session-delivery-1';
const BASE_TIME = new Date('2026-11-01T03:00:00.000Z');

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dispatcher = await import('../../memory/maintenance/memory-delivery-dispatcher.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM memory_deliveries', []);
  dbModule.sqliteRun('DELETE FROM memory_proposals', []);
  dbModule.sqliteRun('DELETE FROM memory_maintenance_reports', []);
  dbModule.sqliteRun('DELETE FROM memory_message_provenance', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    "INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json) VALUES (?, ?, 't', '[]', 'idle', '{}')",
    [SESSION_ID, USER_ID],
  );
  delete process.env['OPENAWORK_PUBLIC_WEB_URL'];
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await dbModule.closeDb();
});

function seedPendingProposal(): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_proposals (
       id, user_id, action, scope_type, scope_id, payload_json, payload_digest, origin,
       status, multi_item, created_at, expires_at, revision, notified_at
     ) VALUES (?, ?, 'create', 'user', ?, '{}', 'd', 'auto_extract', 'pending', 0, ?, ?, 1, NULL)`,
    [
      `prop-${Math.random()}`,
      USER_ID,
      USER_ID,
      BASE_TIME.toISOString(),
      '2030-01-01T00:00:00.000Z',
    ],
  );
}

function seedProvenance(chatType: 'private' | 'group'): void {
  dbModule.sqliteRun(
    `INSERT INTO memory_message_provenance (
       id, session_id, channel_message_id, platform, channel_instance_id, chat_id, chat_type,
       sender_id, sender_name, created_at
     ) VALUES (?, ?, ?, 'telegram', ?, ?, ?, 'sender-1', '张三', ?)`,
    [
      `prov-${Math.random()}`,
      SESSION_ID,
      `msg-${Math.random()}`,
      CHANNEL_ID,
      CHAT_ID,
      chatType,
      BASE_TIME.toISOString(),
    ],
  );
}

function countDeliveries(): number {
  return (
    dbModule.sqliteGet<{ n: number }>('SELECT COUNT(*) AS n FROM memory_deliveries', [])?.n ?? 0
  );
}

describe('enqueuePendingMemoryNotifications', () => {
  it('未配置 OPENAWORK_PUBLIC_WEB_URL → 不入队', async () => {
    seedPendingProposal();
    seedProvenance('private');
    const enqueued = await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });
    expect(enqueued).toBe(0);
    expect(countDeliveries()).toBe(0);
  });

  it('配置后且存在私聊来源 → 入队一行；同一天重复调用仍只有一行', async () => {
    process.env['OPENAWORK_PUBLIC_WEB_URL'] = 'https://example.test';
    seedPendingProposal();
    seedProvenance('private');

    const first = await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });
    expect(first).toBe(1);
    expect(countDeliveries()).toBe(1);

    const second = await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });
    expect(second).toBe(0);
    expect(countDeliveries()).toBe(1);

    // 通知正文脱敏：不含记忆正文，仅数量 + 链接。
    const row = dbModule.sqliteGet<{ body_json: string }>(
      'SELECT body_json FROM memory_deliveries LIMIT 1',
      [],
    );
    const body = JSON.parse(row?.body_json ?? '{}') as { lines: string[]; href?: string | null };
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('/settings?tab=memory');
  });

  it('只有群来源 → 不入队（群里不通知）', async () => {
    process.env['OPENAWORK_PUBLIC_WEB_URL'] = 'https://example.test';
    seedPendingProposal();
    seedProvenance('group');
    const enqueued = await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });
    expect(enqueued).toBe(0);
    expect(countDeliveries()).toBe(0);
  });
});

describe('dispatchMemoryDeliveries', () => {
  it('渠道不可用时把该行标为失败（attempts+1）而不是成功', async () => {
    process.env['OPENAWORK_PUBLIC_WEB_URL'] = 'https://example.test';
    seedPendingProposal();
    seedProvenance('private');
    await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });

    // 渠道服务不存在 → getService 返回 undefined。
    vi.spyOn(channelManager, 'getService').mockReturnValue(undefined);

    const result = await dispatcher.dispatchMemoryDeliveries({ now: BASE_TIME, owner: 'o1' });
    expect(result.claimed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);

    const row = dbModule.sqliteGet<{ status: string; attempts: number; last_error: string | null }>(
      'SELECT status, attempts, last_error FROM memory_deliveries LIMIT 1',
      [],
    );
    expect(row?.status).toBe('pending');
    expect(row?.attempts).toBe(1);
    expect(row?.last_error).toBe('channel_unavailable');
  });

  it('渠道可用时发送成功并标记 sent', async () => {
    process.env['OPENAWORK_PUBLIC_WEB_URL'] = 'https://example.test';
    seedPendingProposal();
    seedProvenance('private');
    await dispatcher.enqueuePendingMemoryNotifications({ now: BASE_TIME });

    const sendMessage = vi.fn().mockResolvedValue({ messageId: 'm1' });
    const fakeService = {
      pluginId: CHANNEL_ID,
      pluginType: 'telegram',
      isRunning: () => true,
      sendMessage,
    } as unknown as MessagingChannelService;
    vi.spyOn(channelManager, 'getService').mockReturnValue(fakeService);

    const result = await dispatcher.dispatchMemoryDeliveries({ now: BASE_TIME, owner: 'o1' });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const row = dbModule.sqliteGet<{ status: string }>(
      'SELECT status FROM memory_deliveries LIMIT 1',
      [],
    );
    expect(row?.status).toBe('sent');
  });
});
