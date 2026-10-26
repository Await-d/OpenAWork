/**
 * 删除消息时释放 `event_log` 里的 part 快照。
 *
 * 背景：`message.part.created` / `message.part.updated` 事件携带**完整 part**，
 * 而 `file` 类型 part 的 `url` 可能是 data URL 形式的 base64 图片（单张上限
 * 4 MiB）。`event_log` 的 retention 是「全局保留最近 50k 行」，按行数而非字节，
 * 因此不清理会让已删消息的图片永久占着配额。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageAdapterModule from '../../message/message-v2-adapter.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-removed-part-events';
const SESSION_ID = 's-removed-part-events';
const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ';

let dbModule: typeof DbModule;
let adapter: typeof MessageAdapterModule;

function countPartEvents(messageId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    `SELECT COUNT(*) AS count FROM event_log
      WHERE aggregate_id = ?
        AND type IN ('message.part.created', 'message.part.updated')
        AND json_extract(data, '$.part.messageID') = ?`,
    [SESSION_ID, messageId],
  );
  return row?.count ?? 0;
}

function countEventSequences(): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    'SELECT COUNT(*) AS count FROM event_sequences WHERE aggregate_id = ?',
    [SESSION_ID],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  adapter = await import('../../message/message-v2-adapter.js');
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM event_log', []);
  dbModule.sqliteRun('DELETE FROM event_sequences', []);
  dbModule.sqliteRun('DELETE FROM part_v2', []);
  dbModule.sqliteRun('DELETE FROM message_v2', []);
  dbModule.sqliteRun('DELETE FROM session_messages_fts', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);

  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER_ID,
    `${USER_ID}@example.com`,
  ]);
  dbModule.sqliteRun(
    "INSERT INTO sessions (id, user_id, title, metadata_json, state_status) VALUES (?, ?, 's', '{}', 'idle')",
    [SESSION_ID, USER_ID],
  );
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('删除消息释放 part 快照事件', () => {
  it('(aggregate_id, type) 索引存在：清理只扫 part 事件，不解析全量 delta', () => {
    const indexes = dbModule.sqliteAll<{ name: string }>('PRAGMA index_list(event_log)');
    expect(indexes.map((index) => index.name)).toContain('idx_event_log_aggregate_type');
  });

  it('图片消息删除后其 part 事件被清掉，其它消息的事件保留', () => {
    const imageMessage = adapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      clientRequestId: 'req-image',
      content: [
        { type: 'text', text: '看这张图' },
        { type: 'input_image', imageUrl: PNG_DATA_URL, mimeType: 'image/png' },
      ],
    });
    const textMessage = adapter.appendSessionMessageV2({
      sessionId: SESSION_ID,
      userId: USER_ID,
      role: 'user',
      clientRequestId: 'req-text',
      content: [{ type: 'text', text: '另一条消息' }],
    });
    const imageMessageId = imageMessage.id;
    const textMessageId = textMessage.id;

    // 前提：part 事件确实带上了 base64 图片快照。
    const imageEvent = dbModule.sqliteGet<{ data: string }>(
      `SELECT data FROM event_log
        WHERE aggregate_id = ?
          AND json_extract(data, '$.part.messageID') = ?
          AND json_extract(data, '$.part.type') = 'file'`,
      [SESSION_ID, imageMessageId],
    );
    expect(imageEvent?.data).toContain('data:image/png;base64,');
    expect(countPartEvents(imageMessageId)).toBe(2);
    expect(countPartEvents(textMessageId)).toBe(1);
    const sequencesBefore = countEventSequences();

    adapter.deleteSessionMessagesByRequestScope({
      clientRequestId: 'req-image',
      sessionId: SESSION_ID,
      userId: USER_ID,
    });

    expect(countPartEvents(imageMessageId)).toBe(0);
    // 未删除的消息不受影响（事件与 part 行都还在）。
    expect(countPartEvents(textMessageId)).toBe(1);
    expect(
      dbModule.sqliteGet<{ count: number }>(
        'SELECT COUNT(*) AS count FROM part_v2 WHERE message_id = ?',
        [textMessageId],
      )?.count,
    ).toBe(1);
    // 序号游标不回退（event_sequences 不随消息删除清理）。
    expect(countEventSequences()).toBe(sequencesBefore);
  });
});
