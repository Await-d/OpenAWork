/**
 * `readSessionMessagesWithRuntimeSplit` 必须与「分别调用两个读取函数」逐字节一致。
 *
 * 该函数把 `GET /sessions/:id` 的两次全表读取(message_v2 + part_v2 各读一遍)
 * 收敛为一次:runtime 安全集恒为 legacy 集的子集(见 `isRuntimeSafeV2Message`),
 * 因此可在内存里切分。这里锁定等价性,防止后续语义漂移。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageV2AdapterModule from '../../message/message-v2-adapter.js';
import { mergeRuntimeSafeSessionMessages } from '../../session/runtime-safe-message-merge.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['JWT_SECRET'] = 'runtime-split-read-secret-1234567890';

let dbModule: typeof DbModule;
let adapter: typeof MessageV2AdapterModule;

const USER_ID = 'u-runtime-split';
const SESSION_ID = 'sess-runtime-split';

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  adapter = await import('../../message/message-v2-adapter.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  dbModule.sqliteRun('INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
    USER_ID,
    'runtime-split@example.test',
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

/** 一轮:user(文本)→ assistant(tool_call, runtime 安全)→ assistant(纯文本)。 */
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

describe('readSessionMessagesWithRuntimeSplit', () => {
  it('legacy / runtime 两组与分别调用两个读取函数一致', () => {
    seedTurn(0);
    seedTurn(1);

    const split = adapter.readSessionMessagesWithRuntimeSplit({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(split.legacyMessages).toEqual(
      adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID }),
    );
    expect(split.runtimeMessages).toEqual(
      adapter.listRuntimeSafeSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID }),
    );
    // runtime 集必须是 legacy 集的子集(这是单次读取成立的前提)。
    expect(split.runtimeMessages.length).toBeLessThan(split.legacyMessages.length);
    expect(split.runtimeMessages.length).toBeGreaterThan(0);
  });

  it('turnLimit 与两个读取函数同窗', () => {
    seedTurn(0);
    seedTurn(1);
    seedTurn(2);

    const split = adapter.readSessionMessagesWithRuntimeSplit({
      sessionId: SESSION_ID,
      userId: USER_ID,
      turnLimit: 1,
    });

    expect(split.legacyMessages).toEqual(
      adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID, turnLimit: 1 }),
    );
    expect(split.runtimeMessages).toEqual(
      adapter.listRuntimeSafeSessionMessagesV2({
        sessionId: SESSION_ID,
        userId: USER_ID,
        turnLimit: 1,
      }),
    );
  });

  it('runtime 集恒为 legacy 集的子集(loadSessionMessages 可直接以空 runtime 入 merge)', () => {
    seedTurn(0);
    seedTurn(1);

    const legacy = adapter.listSessionMessagesV2({ sessionId: SESSION_ID, userId: USER_ID });
    const runtime = adapter.listRuntimeSafeSessionMessagesV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
    const legacyIds = new Set(legacy.map((message) => message.id));

    expect(runtime.length).toBeGreaterThan(0);
    for (const message of runtime) {
      expect(legacyIds.has(message.id)).toBe(true);
    }
    // merge 以 legacy 优先,故「空 runtime」与「真实 runtime」产出同一结果。
    expect(
      mergeRuntimeSafeSessionMessages({ legacyMessages: legacy, runtimeMessages: [] }),
    ).toEqual(
      mergeRuntimeSafeSessionMessages({ legacyMessages: legacy, runtimeMessages: runtime }),
    );
  });
});
