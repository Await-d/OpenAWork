/**
 * 渠道错误留痕的落库行为测试。
 *
 * 覆盖 `channel-error-store.ts` 的三条不变式：
 *   1. **补齐**：内核在用户消息落库之前 early-return 时（409 会话占用、模型绑定
 *      不可用），user + error 消息必须被补写，否则入站消息彻底消失。
 *   2. **幂等**：内核已落过 assistant 消息时不得补写第二条，也不得把成功回合
 *      反写成失败。
 *   3. **可观测**：失败会话被标记且不再被复用；频道级故障跨重启可读。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import { appendSessionMessageV2, listSessionMessagesV2 } from '../../message/message-v2-adapter.js';
import {
  CHANNEL_INBOUND_PERSIST_THROTTLE_MS,
  clearChannelHealthIssue,
  getChannelHealthRecord,
  listChannelHealthRecords,
  markChannelSessionHealthy,
  persistChannelInboundDiagnostic,
  recordChannelHealthIssue,
  recordChannelRunFailure,
} from '../../channels/channel-error-store.js';
import {
  buildChannelSessionKey,
  upsertChannelSession,
} from '../../channels/channel-session-store.js';
import type { ChannelInstance } from '../../channels/types.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

const USER_ID = 'u-channel-error-store';
const CHANNEL_ID = 'channel-error-store-telegram';
const CHAT_ID = 'chat-err-1';
const SESSION_KEY = buildChannelSessionKey(CHANNEL_ID, CHAT_ID);

let dbModule: typeof DbModule;

function makeChannel(): ChannelInstance {
  return {
    id: CHANNEL_ID,
    type: 'telegram',
    name: 'Telegram Error Store Channel',
    enabled: true,
    config: { token: 'redacted' },
    features: { autoReply: true, streamingReply: false, autoStart: false },
    ownerUserId: USER_ID,
    createdAt: 1_788_000_000_000,
    updatedAt: 1_788_000_000_000,
  };
}

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
}

/** 建一个已存在的渠道会话，返回 sessionId。 */
function seedSession(): string {
  return upsertChannelSession({
    channel: makeChannel(),
    chatId: CHAT_ID,
    sessionKey: SESSION_KEY,
    userId: USER_ID,
  });
}

function readSessionRow(sessionId: string): {
  last_error: string | null;
  last_error_at: string | null;
} {
  const row = dbModule.sqliteGet<{
    last_error: string | null;
    last_error_at: string | null;
  }>('SELECT last_error, last_error_at FROM sessions WHERE id = ?', [sessionId]);
  if (!row) {
    throw new Error(`session ${sessionId} not found`);
  }
  return row;
}

function readAuditRows(sessionId: string): Array<{ tool_name: string; is_error: number }> {
  return dbModule.sqliteAll<{ tool_name: string; is_error: number }>(
    'SELECT tool_name, is_error FROM audit_logs WHERE session_id = ? ORDER BY id ASC',
    [sessionId],
  );
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM user_settings', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM audit_logs', []);
  dbModule.sqliteRun('DELETE FROM channel_health', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  seedUser();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('recordChannelRunFailure', () => {
  it('Given a request rejected before the user message was persisted Then it backfills both the user message and the error message', () => {
    const sessionId = seedSession();
    // 内核 early-return（409 / 模型绑定不可用）的形态：请求作用域内什么都没有。
    const outcome = recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-early-return',
      code: 'SESSION_ALREADY_RUNNING',
      message: '会话已有其他请求运行中（SESSION_ALREADY_RUNNING）',
      sessionId,
      userId: USER_ID,
      userMessageText: '这条消息不能消失',
    });

    expect(outcome).toBe('persisted');
    const messages = listSessionMessagesV2({ sessionId, userId: USER_ID });
    expect(messages.map((entry) => entry.role)).toEqual(['user', 'assistant']);

    const errorMessage = messages.at(-1);
    expect(errorMessage?.status).toBe('error');
    const errorText = errorMessage?.content
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('');
    // `[错误: CODE]` 前缀必须与内核同构，否则刷新后会退化成普通正文气泡。
    expect(errorText).toContain('[错误: SESSION_ALREADY_RUNNING]');
    expect(errorText).toContain('会话已有其他请求运行中');
  });

  it('Given the kernel already persisted an assistant message Then it does not write a second one', () => {
    const sessionId = seedSession();
    appendSessionMessageV2({
      sessionId,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: '[错误: STREAM_ERROR] 上游 500' }],
      clientRequestId: 'req-kernel-error',
      status: 'error',
    });

    const outcome = recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-kernel-error',
      code: 'CHANNEL_RUN_FAILED',
      message: '渠道侧重复上报',
      sessionId,
      userId: USER_ID,
      userMessageText: '原始消息',
    });

    expect(outcome).toBe('deduplicated');
    const assistants = listSessionMessagesV2({ sessionId, userId: USER_ID }).filter(
      (entry) => entry.role === 'assistant',
    );
    expect(assistants).toHaveLength(1);
    expect(assistants[0]?.content[0]).toMatchObject({ text: '[错误: STREAM_ERROR] 上游 500' });
  });

  it('Given a successful turn was persisted Then a late failure report must not rewrite it as failed', () => {
    const sessionId = seedSession();
    appendSessionMessageV2({
      sessionId,
      userId: USER_ID,
      role: 'assistant',
      content: [{ type: 'text', text: '正常回复' }],
      clientRequestId: 'req-success',
    });

    const outcome = recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-success',
      code: 'CHANNEL_RUN_FAILED',
      message: '迟到的失败上报',
      sessionId,
      userId: USER_ID,
    });

    expect(outcome).toBe('deduplicated');
    const assistant = listSessionMessagesV2({ sessionId, userId: USER_ID })
      .filter((entry) => entry.role === 'assistant')
      .at(-1);
    expect(assistant?.status).toBeUndefined();
  });

  it('Given a failed run Then it marks the session and writes a channel audit row', () => {
    const sessionId = seedSession();
    recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-audit',
      code: 'CHANNEL_RUN_FAILED',
      message: '上游连接被重置',
      sessionId,
      userId: USER_ID,
    });

    const row = readSessionRow(sessionId);
    expect(row.last_error).toContain('上游连接被重置');
    expect(row.last_error_at).not.toBeNull();

    const auditRows = readAuditRows(sessionId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.tool_name).toBe('channel:CHANNEL_RUN_FAILED');
    expect(auditRows[0]?.is_error).toBe(1);
  });
});

describe('failed session reuse', () => {
  it('Given only failed sessions exist Then it reuses the latest instead of creating a new one', () => {
    const failedSessionId = seedSession();
    recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-fail-1',
      code: 'CHANNEL_RUN_FAILED',
      message: '这一轮炸了',
      sessionId: failedSessionId,
      userId: USER_ID,
    });

    const nextSessionId = upsertChannelSession({
      channel: makeChannel(),
      chatId: CHAT_ID,
      sessionKey: SESSION_KEY,
      userId: USER_ID,
    });

    // 持续故障时若每条消息都新建会话，用户历史会被孤儿会话冲垮 ——
    // 兜底复用比「绝不复用失败会话」更重要。
    expect(nextSessionId).toBe(failedSessionId);
    // 但失败痕迹必须保留：排障时要能看出「这一轮又炸了」。
    expect(readSessionRow(failedSessionId).last_error).toContain('这一轮炸了');
  });

  it('Given a failed session and a healthy one Then the healthy one wins', () => {
    // 先制造一条失败会话（较旧），再制造一条健康会话（较新）。
    const failedSessionId = seedSession();
    recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-fail-old',
      code: 'CHANNEL_RUN_FAILED',
      message: '旧的失败',
      sessionId: failedSessionId,
      userId: USER_ID,
    });
    dbModule.sqliteRun("UPDATE sessions SET updated_at = '2020-01-01 00:00:00' WHERE id = ?", [
      failedSessionId,
    ]);

    const healthySessionId = dbModule.sqliteGet<{ id: string }>(
      'SELECT id FROM sessions WHERE id = ?',
      [failedSessionId],
    )?.id;
    expect(healthySessionId).toBeDefined();
    markChannelSessionHealthy({ sessionId: failedSessionId, userId: USER_ID });
    // 制造第二条会话并让它更新（成为「最近」）。
    dbModule.sqliteRun(
      `INSERT INTO sessions (id, user_id, title, messages_json, state_status, metadata_json, updated_at)
       VALUES (?, ?, ?, '[]', 'idle', '{}', '2030-01-01 00:00:00')`,
      ['sess-healthy-newer', USER_ID, SESSION_KEY],
    );

    const picked = upsertChannelSession({
      channel: makeChannel(),
      chatId: CHAT_ID,
      sessionKey: SESSION_KEY,
      userId: USER_ID,
    });

    expect(picked).toBe('sess-healthy-newer');
  });

  it('Given a session that recovers Then the failure marker is cleared', () => {
    const sessionId = seedSession();
    recordChannelRunFailure({
      channelId: CHANNEL_ID,
      clientRequestId: 'req-recover',
      code: 'CHANNEL_RUN_FAILED',
      message: '临时故障',
      sessionId,
      userId: USER_ID,
    });
    expect(readSessionRow(sessionId).last_error).not.toBeNull();

    markChannelSessionHealthy({ sessionId, userId: USER_ID });

    expect(readSessionRow(sessionId).last_error).toBeNull();
    // 清掉标记后会话重新成为合法复用首选。
    expect(
      upsertChannelSession({
        channel: makeChannel(),
        chatId: CHAT_ID,
        sessionKey: SESSION_KEY,
        userId: USER_ID,
      }),
    ).toBe(sessionId);
  });
});

describe('channel health persistence', () => {
  it('Given a channel-level fault with no usable session Then it persists across process restarts', () => {
    recordChannelHealthIssue({
      channelId: CHANNEL_ID,
      channelType: 'telegram',
      message: '频道服务启动失败：invalid token',
      ownerUserId: USER_ID,
      source: 'channel_start',
      status: 'error',
    });

    const record = getChannelHealthRecord(CHANNEL_ID);
    expect(record?.lastError).toContain('invalid token');
    expect(record?.lastErrorSource).toBe('channel_start');
    expect(record?.lastErrorChannelType).toBe('telegram');
    expect(record?.ownerUserId).toBe(USER_ID);
    expect(record?.lastErrorAt).toBeGreaterThan(0);

    // 无 sessionId 的频道级故障同样要能被按归属检索到。
    expect(listChannelHealthRecords({ ownerUserId: USER_ID })).toHaveLength(1);
  });

  it('Given a successful start Then the persisted error snapshot is cleared', () => {
    recordChannelHealthIssue({
      channelId: CHANNEL_ID,
      message: '先坏一次',
      ownerUserId: USER_ID,
      source: 'channel_start',
    });
    expect(getChannelHealthRecord(CHANNEL_ID)?.lastError).toContain('先坏一次');

    clearChannelHealthIssue(CHANNEL_ID);

    const record = getChannelHealthRecord(CHANNEL_ID);
    expect(record?.lastError).toBeNull();
    expect(record?.lastErrorAt).toBeNull();
  });

  it('Given an oversized error Then the persisted summary is truncated', () => {
    recordChannelHealthIssue({
      channelId: CHANNEL_ID,
      message: 'x'.repeat(9_000),
      ownerUserId: USER_ID,
      source: 'channel_dispatch',
    });

    const stored = getChannelHealthRecord(CHANNEL_ID)?.lastError ?? '';
    expect(stored.length).toBeLessThan(9_000);
    expect(stored).toContain('已截断');
  });

  it('Given inbound diagnostics Then accepted traffic is persisted too', () => {
    persistChannelInboundDiagnostic({
      channelId: CHANNEL_ID,
      accepted: true,
      chatId: CHAT_ID,
      eventType: 'message',
      ownerUserId: USER_ID,
    });

    const record = getChannelHealthRecord(CHANNEL_ID);
    expect(record?.lastInboundAccepted).toBe(true);
    expect(record?.lastInboundType).toBe('message');
    expect(record?.lastMessageChatId).toBe(CHAT_ID);
    // 成功入站不应被误记为故障。
    expect(record?.lastError).toBeNull();
  });

  it('Given a burst of successful inbound traffic Then writes are throttled but failures are not', () => {
    // 节流窗口是**模块级**状态（按 channelId 记忆），所以这里必须用独立频道 ——
    // 复用 CHANNEL_ID 会受同文件其他用例写入的时间戳影响。
    const throttledChannelId = 'channel-throttle-check';
    const base = Date.parse('2026-10-13T08:00:00.000Z');
    // 首条成功必写（建立「消息确实进来了」的基线）。
    persistChannelInboundDiagnostic({
      channelId: throttledChannelId,
      accepted: true,
      chatId: CHAT_ID,
      occurredAt: base,
      ownerUserId: USER_ID,
    });
    expect(getChannelHealthRecord(throttledChannelId)?.lastMessageAt).toBe(base);

    // 窗口内的重复成功被合并：高频频道下这条路径不该每次都 commit。
    persistChannelInboundDiagnostic({
      channelId: throttledChannelId,
      accepted: true,
      chatId: 'chat-ignored',
      occurredAt: base + 1_000,
      ownerUserId: USER_ID,
    });
    expect(getChannelHealthRecord(throttledChannelId)?.lastMessageChatId).toBe(CHAT_ID);

    // 窗口外的成功恢复写入。
    persistChannelInboundDiagnostic({
      channelId: throttledChannelId,
      accepted: true,
      chatId: 'chat-later',
      occurredAt: base + CHANNEL_INBOUND_PERSIST_THROTTLE_MS + 1,
      ownerUserId: USER_ID,
    });
    expect(getChannelHealthRecord(throttledChannelId)?.lastMessageChatId).toBe('chat-later');

    // 失败永远写，即使落在节流窗口内 —— 这正是要排查的东西。
    persistChannelInboundDiagnostic({
      channelId: throttledChannelId,
      accepted: false,
      error: 'Invalid channel inbound secret',
      occurredAt: base + CHANNEL_INBOUND_PERSIST_THROTTLE_MS + 2,
      ownerUserId: USER_ID,
    });
    const record = getChannelHealthRecord(throttledChannelId);
    expect(record?.lastInboundAccepted).toBe(false);
    expect(record?.lastInboundError).toContain('Invalid channel inbound secret');
  });

  it('Given repeated faults Then the latest snapshot wins without duplicating rows', () => {
    recordChannelHealthIssue({
      channelId: CHANNEL_ID,
      message: '第一次',
      ownerUserId: USER_ID,
      source: 'channel_start',
    });
    recordChannelHealthIssue({
      channelId: CHANNEL_ID,
      message: '第二次',
      ownerUserId: USER_ID,
      source: 'channel_restart',
    });

    const records = listChannelHealthRecords({ ownerUserId: USER_ID });
    expect(records).toHaveLength(1);
    expect(records[0]?.lastError).toContain('第二次');
    expect(records[0]?.lastErrorSource).toBe('channel_restart');
  });
});
