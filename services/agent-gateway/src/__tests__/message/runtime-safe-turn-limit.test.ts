/**
 * Regression test for `listRuntimeSafeSessionMessagesV2` turn-window bounding.
 *
 * Background: `/recovery?messageLimit=N` merges two reads over the *same*
 * `message_v2` table — a turn-limited legacy read plus a "runtime safe" read
 * (tool calls / tool results / modified-file summaries / assistant events).
 * The runtime read used to run unbounded, so every historical tool message was
 * merged into the windowed legacy result. Because active sessions poll this
 * endpoint continuously, the payload grew with the whole session history and
 * crashed the browser over time.
 *
 * The runtime read now honours the same `turnLimit` as the legacy read, so only
 * runtime-safe messages inside the last N conversation turns are returned.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'runtime-safe-turn-limit-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;

const USER_ID = 'u-runtime-safe-turn';
const SESSION_ID = 'sess-runtime-safe-turn';

beforeAll(async () => {
  vi.resetModules();
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'runtime-safe@example.test',
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

const BASE_TIME = 1_700_000_000_000;

/** 每轮:user → assistant(tool_call,runtime-safe)→ assistant(text,仅普通消息)。 */
function seedTurn(index: number): void {
  const turnBase = BASE_TIME + index * 10_000;
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: `turn-${index}-user`,
    createdAt: turnBase,
    content: [{ type: 'text', text: `第 ${index} 轮提问` }],
  });
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `turn-${index}-tool`,
    createdAt: turnBase + 1,
    content: [
      {
        type: 'tool_call',
        toolCallId: `call-${index}`,
        toolName: 'bash',
        input: { command: `echo ${index}` },
      },
    ],
  });
  adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'assistant',
    clientRequestId: `turn-${index}-text`,
    createdAt: turnBase + 2,
    content: [{ type: 'text', text: `第 ${index} 轮回答` }],
  });
}

function toolCallIds(messages: readonly { content: { type: string; toolCallId?: string }[] }[]) {
  return messages.map((message) => {
    const part = message.content[0];
    return part?.type === 'tool_call' ? part.toolCallId : undefined;
  });
}

describe('listRuntimeSafeSessionMessagesV2 — turnLimit 窗口', () => {
  it('不传 turnLimit 时返回全部 runtime 安全消息(既有语义不变)', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    const messages = adapter.listRuntimeSafeSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    // 仅 tool_call 消息属于 runtime-safe;user / 纯文本 assistant 被过滤掉。
    expect(messages).toHaveLength(3);
    expect(toolCallIds(messages)).toEqual(['call-0', 'call-1', 'call-2']);
  });

  it('turnLimit=1 只返回最后一个回合内的 runtime 安全消息', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    const messages = adapter.listRuntimeSafeSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnLimit: 1,
    });

    // 只剩第 3 轮(index=2)的 tool_call —— 证明历史工具消息不再无界并入。
    expect(messages).toHaveLength(1);
    expect(toolCallIds(messages)).toEqual(['call-2']);
  });

  it('turnLimit=2 返回最近两个回合的 runtime 安全消息', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    const messages = adapter.listRuntimeSafeSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnLimit: 2,
    });

    expect(toolCallIds(messages)).toEqual(['call-1', 'call-2']);
  });

  it('turnLimit 大于实际回合数时等同返回全部(边界回退)', () => {
    seedTurn(0);
    seedTurn(1);

    const messages = adapter.listRuntimeSafeSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnLimit: 5,
    });

    expect(messages).toHaveLength(2);
  });
});
