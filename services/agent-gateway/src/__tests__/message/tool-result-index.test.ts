import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
process.env['OPENAWORK_DATABASE_PATH'] = ':memory:';

describe('工具结果索引化回读', () => {
  beforeAll(async () => {
    const db = await import('../../infra/db.js');
    await db.migrate();
    db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      'index-user',
      'index@example.com',
      'hash',
    ]);
    db.sqliteRun('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)', [
      'index-session',
      'index-user',
      'index',
    ]);
    db.sqliteRun(
      'INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
      ['index-message', 'index-session', 'index-user', 1, '{}'],
    );
    db.sqliteRun(
      'INSERT INTO part_v2 (id, message_id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'index-part',
        'index-message',
        'index-session',
        'index-user',
        2,
        JSON.stringify({
          id: 'index-part',
          messageID: 'index-message',
          sessionID: 'index-session',
          type: 'tool',
          callID: 'legacy-call',
          tool: 'custom',
          state: {
            status: 'completed',
            input: {},
            output: 'indexed-output',
            title: 'custom',
            time: { start: 1, end: 2 },
          },
        }),
      ],
    );
    db.backfillToolResultIndex();
  });

  afterAll(async () => {
    const db = await import('../../infra/db.js');
    await db.closeDb();
    if (previousDatabasePath === undefined) delete process.env['OPENAWORK_DATABASE_PATH'];
    else process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
  });

  it('旧 part_v2 数据回填后可通过复合索引直接定位', async () => {
    const db = await import('../../infra/db.js');
    const adapter = await import('../../message/message-v2-adapter.js');
    expect(
      adapter.getSessionToolResultByCallId({
        sessionId: 'index-session',
        toolCallId: 'legacy-call',
        userId: 'index-user',
      })?.output,
    ).toBe('indexed-output');
    const plan = db.sqliteAll<{ detail: string }>(
      'EXPLAIN QUERY PLAN SELECT * FROM part_v2 WHERE session_id = ? AND user_id = ? AND tool_call_id = ?',
      ['index-session', 'index-user', 'legacy-call'],
    );
    expect(plan.some((row) => row.detail.includes('idx_part_v2_tool_call'))).toBe(true);
  });
});
