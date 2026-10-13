/**
 * `composer-queue-store` 的行为契约。
 *
 * 这层是「刷新 / 换端不丢待发消息」的唯一真相源，因此用**真实内存 SQLite** 而非
 * mock：幂等键、FIFO 排序、跨会话 / 跨用户隔离、脏数据收敛这几条都依赖真实 SQL 语义
 * （UNIQUE / ON CONFLICT / 复合 WHERE / FK CASCADE），mock 掉 db 只会验证到自己写的
 * mock。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import {
  claimComposerQueueItems,
  claimComposerQueueItem,
  clearComposerQueue,
  COMPOSER_QUEUE_CLAIM_LEASE_MS,
  countComposerQueueItems,
  enqueueComposerQueueItem,
  listComposerQueueItems,
  releaseComposerQueueItem,
  removeComposerQueueItem,
} from '../../session/composer-queue-store.js';

process.env['DATABASE_URL'] = ':memory:';

const OWNER_ID = 'u-composer-queue-owner';
const OTHER_USER_ID = 'u-composer-queue-other';
const SESSION_ID = 'sess-composer-queue-1';
const OTHER_SESSION_ID = 'sess-composer-queue-2';

let dbModule: typeof DbModule;

function enqueue(input: {
  enqueuedAt: number;
  itemId: string;
  sessionId?: string;
  text: string;
  userId?: string;
}) {
  return enqueueComposerQueueItem({
    attachmentItems: [],
    enqueuedAt: input.enqueuedAt,
    itemId: input.itemId,
    requiresAttachmentRebind: false,
    sessionId: input.sessionId ?? SESSION_ID,
    text: input.text,
    userId: input.userId ?? OWNER_ID,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
});

beforeEach(() => {
  dbModule.sqliteRun('DELETE FROM session_composer_queue', []);
  dbModule.sqliteRun('DELETE FROM sessions', []);
  dbModule.sqliteRun('DELETE FROM users', []);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    OWNER_ID,
    'owner@example.com',
  ]);
  dbModule.sqliteRun("INSERT INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    OTHER_USER_ID,
    'other@example.com',
  ]);
  dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [SESSION_ID, OWNER_ID]);
  dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [
    OTHER_SESSION_ID,
    OWNER_ID,
  ]);
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('enqueueComposerQueueItem', () => {
  it('按入队时间升序返回（FIFO）', () => {
    enqueue({ enqueuedAt: 30, itemId: 'c', text: '第三条' });
    enqueue({ enqueuedAt: 10, itemId: 'a', text: '第一条' });
    enqueue({ enqueuedAt: 20, itemId: 'b', text: '第二条' });

    expect(
      listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID }).map((i) => i.text),
    ).toEqual(['第一条', '第二条', '第三条']);
  });

  it('同一 itemId 重复入队幂等：不产生第二条，也不重置入队时间', () => {
    enqueue({ enqueuedAt: 10, itemId: 'dup', text: '原始文本' });
    // 模拟「入队响应丢包后客户端重试」：时间戳更晚、内容也不同。
    const retry = enqueue({ enqueuedAt: 99, itemId: 'dup', text: '重试时的文本' });

    expect(retry.created).toBe(false);
    const items = listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID });
    expect(items).toHaveLength(1);
    // 保留库里的权威内容与原始入队时间，否则重试会把条目甩到队尾。
    expect(items[0]?.text).toBe('原始文本');
    expect(items[0]?.enqueuedAt).toBe(10);
  });

  it('enqueuedAt 相同时按写入顺序稳定排序', () => {
    enqueue({ enqueuedAt: 5, itemId: 'first', text: '先写' });
    enqueue({ enqueuedAt: 5, itemId: 'second', text: '后写' });

    expect(
      listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID }).map((i) => i.text),
    ).toEqual(['先写', '后写']);
  });

  it('落库并回读附件元数据', () => {
    const result = enqueueComposerQueueItem({
      attachmentItems: [
        { id: 'att-1', name: '截图.png', sizeBytes: 2048, type: 'image' },
        { id: 'att-2', name: '录音.mp3', sizeBytes: 4096, type: 'audio' },
      ],
      enqueuedAt: 1,
      itemId: 'with-attachments',
      requiresAttachmentRebind: true,
      sessionId: SESSION_ID,
      text: '带附件的消息',
      userId: OWNER_ID,
    });

    expect(result.item.attachmentItems).toEqual([
      { id: 'att-1', name: '截图.png', sizeBytes: 2048, type: 'image' },
      { id: 'att-2', name: '录音.mp3', sizeBytes: 4096, type: 'audio' },
    ]);
    expect(result.item.requiresAttachmentRebind).toBe(true);
  });

  it('附件 JSON 脏数据时收敛解析，不让整条队列读取失败', () => {
    enqueue({ enqueuedAt: 1, itemId: 'good', text: '正常条目' });
    dbModule.sqliteRun(
      `INSERT INTO session_composer_queue
         (id, session_id, user_id, text, attachment_items_json, requires_attachment_rebind, enqueued_at)
       VALUES (?, ?, ?, ?, ?, 0, 2)`,
      ['dirty', SESSION_ID, OWNER_ID, '脏附件条目', '这不是合法 JSON'],
    );

    const items = listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID });
    expect(items.map((item) => item.text)).toEqual(['正常条目', '脏附件条目']);
    // 最坏退化成「无附件」，用户仍能看到并发出文本。
    expect(items[1]?.attachmentItems).toEqual([]);
  });
});

describe('listComposerQueueItems 隔离性', () => {
  it('看不到其他会话的条目', () => {
    enqueue({ enqueuedAt: 1, itemId: 'mine', text: '本会话' });
    enqueue({ enqueuedAt: 2, itemId: 'other-sess', sessionId: OTHER_SESSION_ID, text: '别的会话' });

    expect(
      listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID }).map((item) => item.text),
    ).toEqual(['本会话']);
  });

  it('同一 sessionId 下换用户读不到他人条目（防越权）', () => {
    enqueue({ enqueuedAt: 1, itemId: 'mine', text: '我的条目' });

    expect(listComposerQueueItems({ sessionId: SESSION_ID, userId: OTHER_USER_ID })).toEqual([]);
  });
});

describe('removeComposerQueueItem', () => {
  it('删除命中时返回 true，重复删除返回 false（幂等）', () => {
    enqueue({ enqueuedAt: 1, itemId: 'gone', text: '待删除' });

    expect(
      removeComposerQueueItem({ itemId: 'gone', sessionId: SESSION_ID, userId: OWNER_ID }),
    ).toBe(true);
    expect(
      removeComposerQueueItem({ itemId: 'gone', sessionId: SESSION_ID, userId: OWNER_ID }),
    ).toBe(false);
    expect(countComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(0);
  });

  it('无法删除其他会话 / 其他用户的条目', () => {
    enqueue({ enqueuedAt: 1, itemId: 'mine', text: '本会话' });

    expect(
      removeComposerQueueItem({ itemId: 'mine', sessionId: OTHER_SESSION_ID, userId: OWNER_ID }),
    ).toBe(false);
    expect(
      removeComposerQueueItem({ itemId: 'mine', sessionId: SESSION_ID, userId: OTHER_USER_ID }),
    ).toBe(false);
    expect(countComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(1);
  });
});

describe('clearComposerQueue', () => {
  it('只清空目标会话并返回删除条数', () => {
    enqueue({ enqueuedAt: 1, itemId: 'a', text: 'A1' });
    enqueue({ enqueuedAt: 2, itemId: 'b', text: 'A2' });
    enqueue({ enqueuedAt: 3, itemId: 'c', sessionId: OTHER_SESSION_ID, text: 'B1' });

    expect(clearComposerQueue({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(2);
    expect(countComposerQueueItems({ sessionId: OTHER_SESSION_ID, userId: OWNER_ID })).toBe(1);
  });
});

describe('claimComposerQueueItem（多端互斥）', () => {
  const NOW = 1_700_000_000_000;

  function claim(clientId: string, itemId: string, now = NOW) {
    return claimComposerQueueItem({
      clientId,
      itemId,
      leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
      now,
      sessionId: SESSION_ID,
      userId: OWNER_ID,
    });
  }

  it('先到者拿到发送权，后来者被拒', () => {
    enqueue({ enqueuedAt: 1, itemId: 'contended', text: '同一条' });

    expect(claim('client-a', 'contended')).toBe(true);
    expect(claim('client-b', 'contended')).toBe(false);
  });

  it('同一客户端重复 claim 可续租（网络重试不会把自己锁死）', () => {
    enqueue({ enqueuedAt: 1, itemId: 'retry', text: '重试' });

    expect(claim('client-a', 'retry')).toBe(true);
    expect(claim('client-a', 'retry')).toBe(true);
  });

  it('租约过期后其他端可以抢占', () => {
    enqueue({ enqueuedAt: 1, itemId: 'leased', text: '租约' });

    expect(claim('client-a', 'leased')).toBe(true);
    // 刚好在到期时刻即视为可抢占，避免边界上多等一个周期。
    expect(claim('client-b', 'leased', NOW + COMPOSER_QUEUE_CLAIM_LEASE_MS + 1)).toBe(true);
  });

  it('release 后其他端可以拿到', () => {
    enqueue({ enqueuedAt: 1, itemId: 'handover', text: '交还' });

    expect(claim('client-a', 'handover')).toBe(true);
    expect(
      releaseComposerQueueItem({
        clientId: 'client-a',
        itemId: 'handover',
        sessionId: SESSION_ID,
        userId: OWNER_ID,
      }),
    ).toBe(true);
    expect(claim('client-b', 'handover')).toBe(true);
  });

  it('非持有者无法释放他人的 claim', () => {
    enqueue({ enqueuedAt: 1, itemId: 'guarded', text: '守护' });

    expect(claim('client-a', 'guarded')).toBe(true);
    // 交错的场景：A 失败正要释放，B 已抢到租约——释放不得误删 B 的锁。
    expect(
      releaseComposerQueueItem({
        clientId: 'client-b',
        itemId: 'guarded',
        sessionId: SESSION_ID,
        userId: OWNER_ID,
      }),
    ).toBe(false);
    expect(claim('client-b', 'guarded')).toBe(false);
  });

  it('claim 越权：跨会话 / 跨用户一律失败', () => {
    enqueue({ enqueuedAt: 1, itemId: 'scoped', text: '隔离' });

    expect(
      claimComposerQueueItem({
        clientId: 'client-a',
        itemId: 'scoped',
        leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
        now: NOW,
        sessionId: OTHER_SESSION_ID,
        userId: OWNER_ID,
      }),
    ).toBe(false);
    expect(
      claimComposerQueueItem({
        clientId: 'client-a',
        itemId: 'scoped',
        leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
        now: NOW,
        sessionId: SESSION_ID,
        userId: OTHER_USER_ID,
      }),
    ).toBe(false);
  });

  it('单条条目的 claim 不影响同会话的其他条目', () => {
    enqueue({ enqueuedAt: 1, itemId: 'first', text: '第一条' });
    enqueue({ enqueuedAt: 2, itemId: 'second', text: '第二条' });

    expect(claim('client-a', 'first')).toBe(true);
    expect(claim('client-b', 'second')).toBe(true);
  });

  it('批量 claim 在一次调用中返回逐条结果并保持条目级互斥', () => {
    enqueue({ enqueuedAt: 1, itemId: 'batch-first', text: '第一条' });
    enqueue({ enqueuedAt: 2, itemId: 'batch-held', text: '已占用' });
    expect(claim('client-b', 'batch-held')).toBe(true);

    const result = claimComposerQueueItems({
      clientId: 'client-a',
      itemIds: ['batch-first', 'batch-held', 'batch-missing', 'batch-first'],
      leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
      now: NOW,
      sessionId: SESSION_ID,
      userId: OWNER_ID,
    });

    expect(result).toEqual([
      { claimed: true, itemId: 'batch-first' },
      { claimed: false, itemId: 'batch-held' },
      { claimed: false, itemId: 'batch-missing' },
    ]);
  });
});

describe('会话删除时的级联清理', () => {
  it('会话被删除后其待发条目一并消失', () => {
    enqueue({ enqueuedAt: 1, itemId: 'a', text: '随会话消亡' });

    dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);

    expect(countComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(0);
  });
});
