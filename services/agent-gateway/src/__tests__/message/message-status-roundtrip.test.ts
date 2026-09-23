import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'message-status-roundtrip-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;

const USER_ID = 'u-message-status';
const SESSION_ID = 'sess-message-status';

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'message-status@example.test',
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

function appendAssistant(input: { clientRequestId: string; status?: string }): void {
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: input.clientRequestId,
    content: [{ type: 'text', text: 'assistant 输出' }],
    ...(input.status ? { status: input.status } : {}),
  });
}

describe('消息 status 往返（写入 → 读路径回传 → 请求判定）', () => {
  it('读路径回传 error 状态（listSessionMessagesV2）', () => {
    appendAssistant({ clientRequestId: 'req-error', status: 'error' });

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.status).toBe('error');
  });

  it('getSessionMessageByRequestId 对 error 消息返回 error（修复前恒为 final）', () => {
    appendAssistant({ clientRequestId: 'req-error-2', status: 'error' });

    const stored = adapter.getSessionMessageByRequestId({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-error-2',
      role: 'assistant',
    });
    expect(stored?.status).toBe('error');
  });

  it('未标记 status 的消息按 final 处理', () => {
    appendAssistant({ clientRequestId: 'req-final' });

    const messages = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    expect(messages[0]?.status).toBeUndefined();

    const stored = adapter.getSessionMessageByRequestId({
      sessionId: SESSION_ID,
      userId: USER_ID,
      clientRequestId: 'req-final',
      role: 'assistant',
    });
    expect(stored?.status).toBe('final');
  });

  it('statuses 过滤与读路径状态一致', () => {
    appendAssistant({ clientRequestId: 'req-a', status: 'error' });
    appendAssistant({ clientRequestId: 'req-b' });

    const errorOnly = adapter.listSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      statuses: ['error'],
    });
    expect(errorOnly).toHaveLength(1);
    expect(errorOnly[0]?.clientRequestId).toBe('req-a');
    expect(errorOnly[0]?.status).toBe('error');
  });
});
