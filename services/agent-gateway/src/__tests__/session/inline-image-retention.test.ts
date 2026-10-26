/**
 * 会话级内联图片淘汰：超过阈值时从最旧开始删图片 part，直到降到目标值。
 *
 * 淘汰走 `MessageEvents.PartRemoved` 事件，所以既删 `part_v2` 行，也清掉
 * `event_log` 里该 part 的快照（含 base64）。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as MessageAdapterModule from '../../message/message-v2-adapter.js';
import type * as RetentionModule from '../../session/inline-image-retention.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
process.env['AI_API_BASE_URL'] = '';
process.env['AI_API_KEY'] = '';
process.env['AI_DEFAULT_MODEL'] = '';

const USER_ID = 'u-inline-image-retention';
const SESSION_ID = 's-inline-image-retention';

/** 400 个 base64 字符 ≈ 300 字节 payload（`inlineImagePayloadBytes`）。 */
const IMAGE_BYTES = 300;
const IMAGE_URL = `data:image/png;base64,${'A'.repeat(400)}`;

let dbModule: typeof DbModule;
let adapter: typeof MessageAdapterModule;
let retention: typeof RetentionModule;

function seedImageMessage(index: number, options: { withText?: boolean } = {}): string {
  const content = [
    ...(options.withText === false ? [] : [{ type: 'text' as const, text: `第 ${index} 张图` }]),
    { type: 'input_image' as const, imageUrl: IMAGE_URL, mimeType: 'image/png' },
  ];
  const message = adapter.appendSessionMessageV2({
    sessionId: SESSION_ID,
    userId: USER_ID,
    role: 'user',
    clientRequestId: `req-image-${index}`,
    content,
  });
  return message.id;
}

function listImageParts(): Array<{ id: string; message_id: string }> {
  return dbModule.sqliteAll<{ id: string; message_id: string }>(
    `SELECT id, message_id FROM part_v2
      WHERE session_id = ? AND data LIKE '%"inputType":"input_image"%'
      ORDER BY time_created ASC, id ASC`,
    [SESSION_ID],
  );
}

/**
 * part 的 `time_created` 取写入时刻（毫秒），同一毫秒内无法区分先后。
 * 测试按**写入顺序**显式拉开，固定「最旧优先」的预期。
 */
function setPartTimesInWriteOrder(messageIds: readonly string[]): void {
  messageIds.forEach((messageId, index) => {
    dbModule.sqliteRun('UPDATE part_v2 SET time_created = ? WHERE message_id = ?', [
      1_000 + index * 1_000,
      messageId,
    ]);
  });
}

function countPartSnapshotEvents(partId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    `SELECT COUNT(*) AS count FROM event_log
      WHERE aggregate_id = ?
        AND type IN ('message.part.created', 'message.part.updated')
        AND json_extract(data, '$.part.id') = ?`,
    [SESSION_ID, partId],
  );
  return row?.count ?? 0;
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.connectDb();
  await dbModule.migrate();
  adapter = await import('../../message/message-v2-adapter.js');
  retention = await import('../../session/inline-image-retention.js');
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

describe('pruneSessionInlineImages', () => {
  it('超过触发阈值时从最旧开始删，直到降到目标值以下', () => {
    const messageIds = [seedImageMessage(1), seedImageMessage(2), seedImageMessage(3)];
    setPartTimesInWriteOrder(messageIds);
    const parts = listImageParts();
    expect(parts).toHaveLength(3);
    const oldestPartId = parts[0]!.id;
    const newestPartId = parts[2]!.id;
    expect(countPartSnapshotEvents(oldestPartId)).toBeGreaterThan(0);

    // 3 × 300 = 900 字节：超过 500 后删两张 → 剩 300 ≤ 300。
    const result = retention.pruneSessionInlineImages({
      sessionId: SESSION_ID,
      budget: { triggerBytes: 500, targetBytes: IMAGE_BYTES },
    });

    expect(result.removedCount).toBe(2);
    expect(result.removedBytes).toBe(IMAGE_BYTES * 2);
    const remaining = listImageParts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(newestPartId);
    // 被淘汰图片的 part 快照必须同步从 event_log 消失，否则 base64 仍占配额。
    expect(countPartSnapshotEvents(oldestPartId)).toBe(0);
    expect(countPartSnapshotEvents(newestPartId)).toBeGreaterThan(0);
    // 文本 part 不受影响（每条消息只删图片）。
    expect(
      dbModule.sqliteGet<{ count: number }>(
        'SELECT COUNT(*) AS count FROM part_v2 WHERE session_id = ? AND data LIKE \'%"type":"text"%\'',
        [SESSION_ID],
      )?.count,
    ).toBe(3);
  });

  it('未超过触发阈值时不做任何删除', () => {
    setPartTimesInWriteOrder([seedImageMessage(1), seedImageMessage(2)]);

    const result = retention.pruneSessionInlineImages({
      sessionId: SESSION_ID,
      budget: { triggerBytes: 10_000, targetBytes: 5_000 },
    });

    expect(result).toEqual({ removedCount: 0, removedBytes: 0 });
    expect(listImageParts()).toHaveLength(2);
  });

  // 单轮图片就可能超过 target（一次粘贴多张大图）。若连本轮刚发的图也淘汰，
  // 用户会看到「刚发的图下一轮就不见了」，比超一点预算糟糕得多。
  it('excludeMessageId 指定的本轮消息永不被淘汰', () => {
    const messageIds = [
      seedImageMessage(1),
      seedImageMessage(2),
      seedImageMessage(3),
      seedImageMessage(4),
    ];
    setPartTimesInWriteOrder(messageIds);
    const newestMessageId = messageIds[3]!;

    const result = retention.pruneSessionInlineImages({
      sessionId: SESSION_ID,
      budget: { triggerBytes: 500, targetBytes: 1 },
      excludeMessageId: newestMessageId,
    });

    expect(result.removedCount).toBe(3);
    const remaining = listImageParts();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.message_id).toBe(newestMessageId);
  });

  it('图片是该消息唯一 part 时保留，避免把消息清成空壳', () => {
    setPartTimesInWriteOrder([
      seedImageMessage(1, { withText: false }),
      seedImageMessage(2, { withText: false }),
    ]);

    const result = retention.pruneSessionInlineImages({
      sessionId: SESSION_ID,
      budget: { triggerBytes: 100, targetBytes: 1 },
    });

    expect(result.removedCount).toBe(0);
    expect(listImageParts()).toHaveLength(2);
  });

  it('预算禁用（trigger <= 0）时零查询短路', () => {
    seedImageMessage(1);

    expect(
      retention.pruneSessionInlineImages({
        sessionId: SESSION_ID,
        budget: { triggerBytes: 0, targetBytes: 0 },
      }),
    ).toEqual({ removedCount: 0, removedBytes: 0 });
    expect(listImageParts()).toHaveLength(1);
  });
});

describe('maybePruneSessionInlineImages', () => {
  it('纯文本轮次直接跳过（不触发扫描）', () => {
    setPartTimesInWriteOrder([seedImageMessage(1), seedImageMessage(2)]);

    const result = retention.maybePruneSessionInlineImages({
      sessionId: SESSION_ID,
      hasInlineImage: false,
    });

    expect(result).toEqual({ removedCount: 0, removedBytes: 0 });
    expect(listImageParts()).toHaveLength(2);
  });
});
