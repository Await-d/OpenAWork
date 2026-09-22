import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import type * as MessageToModelModule from '../../message/message-to-model-messages.js';
import type * as NativeMessageBridgeModule from '../../v2-runtime/upstream/native-message-bridge.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'synthetic-roundtrip-test-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;
let toModelMessagesModule: typeof MessageToModelModule;
let bridge: typeof NativeMessageBridgeModule;

const USER_ID = 'u-synthetic-roundtrip';
const SESSION_ID = 'sess-synthetic-roundtrip';

const NOTICE_TEXT = '子代理已完成 · 审计会话唤醒原语';
const NOTICE_DESCRIPTION = '审计会话唤醒原语';
const NOTICE_METADATA = {
  source: 'subagent',
  childID: 'child-session-1',
  agent: 'explore',
  state: 'completed',
};

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  toModelMessagesModule = await import('../../message/message-to-model-messages.js');
  bridge = await import('../../v2-runtime/upstream/native-message-bridge.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'synthetic-roundtrip@example.test',
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
  dbModule.sqliteRun('DELETE FROM session_messages WHERE session_id = ?', [SESSION_ID]);
});

function appendSyntheticNotice(): string {
  const message = adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'synthetic',
    content: [{ type: 'text', text: NOTICE_TEXT, synthetic: true }],
    description: NOTICE_DESCRIPTION,
    metadata: NOTICE_METADATA,
  });
  return message.id;
}

describe('synthetic role 往返（写入 → 落库 → 下发上游 → 客户端契约）', () => {
  it('写入时保持 synthetic 角色，不被静默改写为 system', () => {
    const messageId = appendSyntheticNotice();

    const row = dbModule.sqliteGet<{ data: string }>('SELECT data FROM message_v2 WHERE id = ?', [
      messageId,
    ]);
    expect(row).toBeDefined();

    const info = JSON.parse(row!.data) as { role: string; description?: string };
    expect(info.role).toBe('synthetic');
    expect(info.description).toBe(NOTICE_DESCRIPTION);
  });

  it('读路径把 description / metadata 一并带回（不得只剩光秃秃的 role）', () => {
    appendSyntheticNotice();

    const withParts = adapter.findMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      predicate: (message) => message.info.role === 'synthetic',
    });
    expect(withParts).toBeDefined();

    const info = withParts!.info;
    expect(info.role).toBe('synthetic');
    if (info.role !== 'synthetic') {
      throw new Error(`期望 synthetic 角色，实际为 ${info.role}`);
    }
    expect(info.description).toBe(NOTICE_DESCRIPTION);
    expect(info.metadata).toEqual(NOTICE_METADATA);

    // 客户端契约（V1 Message）：role + description + metadata + 正文缺一不可。
    const clientMessage = adapter.v2ToV1Message(withParts!);
    expect(clientMessage.role).toBe('synthetic');
    expect(clientMessage.description).toBe(NOTICE_DESCRIPTION);
    expect(clientMessage.metadata).toEqual(NOTICE_METADATA);
    expect(clientMessage.content).toEqual([{ type: 'text', text: NOTICE_TEXT, synthetic: true }]);
  });

  it('模型上下文可见：synthetic 进入 UnifiedMessage 并被 bridge 降级为上游 user', () => {
    appendSyntheticNotice();

    const withParts = adapter.findMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      predicate: (message) => message.info.role === 'synthetic',
    });
    expect(withParts).toBeDefined();

    const unified = toModelMessagesModule.toModelMessages([withParts!]);
    const synthetic = unified.filter((message) => message.role === 'synthetic');
    expect(synthetic).toHaveLength(1);
    expect(synthetic[0]).toMatchObject({ role: 'synthetic', content: NOTICE_TEXT });

    // 上游协议只认 user/assistant/tool：bridge 必须降级为 user 而不是丢弃。
    const bridged = bridge.unifiedConversationToNativeMessages(unified);
    expect(bridged).toHaveLength(1);
    expect(bridged[0]).toMatchObject({ role: 'user' });
  });

  it('listSessionMessagesV2 保留 synthetic 消息（不因 role 未知被过滤掉）', () => {
    const messageId = appendSyntheticNotice();

    const messages = adapter.listSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    const notice = messages.find((message) => message.id === messageId);

    expect(notice).toBeDefined();
    expect(notice?.role).toBe('synthetic');
    expect(notice?.description).toBe(NOTICE_DESCRIPTION);
  });
});
