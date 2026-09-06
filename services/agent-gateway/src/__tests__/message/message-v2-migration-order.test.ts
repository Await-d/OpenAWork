import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const previousDatabasePath = process.env['OPENAWORK_DATABASE_PATH'];
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'openawork-message-order-'));
const databasePath = join(temporaryDirectory, 'gateway.sqlite');
process.env['OPENAWORK_DATABASE_PATH'] = databasePath;

describe('V1 到 V2 消息迁移顺序', () => {
  beforeAll(async () => {
    const db = await import('../../infra/db.js');
    await db.closeDb();
    await db.connectDb();
    await db.migrate();

    db.sqliteRun('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)', [
      'migration-order-user',
      'migration-order@example.com',
      'hash',
    ]);
    db.sqliteRun('INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)', [
      'migration-order-session',
      'migration-order-user',
      'migration order',
    ]);
    db.sqliteRun(
      `INSERT INTO session_messages
        (id, session_id, user_id, seq, role, content_json, status, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'migration-order-message',
        'migration-order-session',
        'migration-order-user',
        1,
        'assistant',
        JSON.stringify([
          { type: 'text', text: '工具之前' },
          {
            type: 'tool_call',
            toolCallId: 'migration-tool',
            toolName: 'read_file',
            input: {},
          },
          {
            type: 'tool_result',
            toolCallId: 'migration-tool',
            toolName: 'read_file',
            output: 'ok',
            isError: false,
          },
          { type: 'text', text: '工具之后' },
        ]),
        'final',
        1_750_000_000_000,
      ],
    );

    // The first migration created the schema with no V1 rows. The second one
    // performs the legacy projection we need to verify.
    await db.migrate();

    db.sqliteRun(
      `INSERT INTO session_messages
        (id, session_id, user_id, seq, role, content_json, status, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'legacy-random-message',
        'migration-order-session',
        'migration-order-user',
        2,
        'assistant',
        JSON.stringify([
          { type: 'text', text: '旧前文' },
          { type: 'tool_call', toolCallId: 'legacy-tool', toolName: 'bash', input: {} },
          { type: 'text', text: '旧后文' },
        ]),
        'final',
        1_750_000_000_100,
      ],
    );
    db.sqliteRun(
      'INSERT INTO message_v2 (id, session_id, user_id, time_created, data) VALUES (?, ?, ?, ?, ?)',
      [
        'legacy-random-message',
        'migration-order-session',
        'migration-order-user',
        1_750_000_000_100,
        JSON.stringify({ role: 'assistant', time: { created: 1_750_000_000_100 } }),
      ],
    );
    const legacyParts = [
      ['ffffffff-ffff-4fff-8fff-ffffffffffff', { type: 'text', text: '旧前文' }],
      [
        '00000000-0000-4000-8000-000000000000',
        { type: 'tool', callID: 'legacy-tool', tool: 'bash', state: { status: 'completed' } },
      ],
      ['88888888-8888-4888-8888-888888888888', { type: 'text', text: '旧后文' }],
    ] as const;
    for (const [id, data] of legacyParts) {
      db.sqliteRun(
        `INSERT INTO part_v2
          (id, message_id, session_id, user_id, time_created, data)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          id,
          'legacy-random-message',
          'migration-order-session',
          'migration-order-user',
          1_750_000_000_100,
          JSON.stringify(data),
        ],
      );
    }
    await db.migrate();
  });

  afterAll(async () => {
    const db = await import('../../infra/db.js');
    await db.closeDb();
    if (previousDatabasePath === undefined) {
      delete process.env['OPENAWORK_DATABASE_PATH'];
    } else {
      process.env['OPENAWORK_DATABASE_PATH'] = previousDatabasePath;
    }
    await db.connectDb();
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  it('按原 content 顺序生成可排序 part ID 并稳定回读', async () => {
    const db = await import('../../infra/db.js');
    const rows = db.sqliteAll<{ data: string; id: string }>(
      'SELECT id, data FROM part_v2 WHERE message_id = ? ORDER BY id ASC',
      ['migration-order-message'],
    );

    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.id.startsWith('prt_'))).toBe(true);
    expect(
      rows.map((row) => {
        const part = JSON.parse(row.data) as { text?: string; tool?: string; type?: string };
        return part.type === 'text' ? part.text : part.tool;
      }),
    ).toEqual(['工具之前', 'read_file', '工具之后']);
  });

  it('仅对可完整匹配的旧 UUID part 按 V1 mirror 安全恢复顺序', async () => {
    const db = await import('../../infra/db.js');
    const rows = db.sqliteAll<{ data: string; id: string }>(
      'SELECT id, data FROM part_v2 WHERE message_id = ? ORDER BY id ASC',
      ['legacy-random-message'],
    );

    expect(rows.every((row) => row.id.startsWith('prt_'))).toBe(true);
    expect(
      rows.map((row) => {
        const part = JSON.parse(row.data) as { text?: string; tool?: string; type?: string };
        return part.type === 'text' ? part.text : part.tool;
      }),
    ).toEqual(['旧前文', 'bash', '旧后文']);
    expect(
      db.sqliteAll<{ count: number }>(
        'SELECT COUNT(*) AS count FROM part_v2_order_repair_backup WHERE message_id = ?',
        ['legacy-random-message'],
      )[0]?.count,
    ).toBe(3);
  });
});
