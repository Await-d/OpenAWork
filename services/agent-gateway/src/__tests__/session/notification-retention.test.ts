import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as NotificationStoreModule from '../../session/notification-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';

let dbModule: typeof DbModule;
let notificationStore: typeof NotificationStoreModule;

const USER_A = 'u-notif-a';
const USER_B = 'u-notif-b';

function seedUser(id: string, email: string): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    id,
    email,
  ]);
}

function countNotificationRows(userId: string): number {
  const row = dbModule.sqliteGet<{ count: number }>(
    `SELECT COUNT(1) AS count FROM notifications WHERE user_id = ?`,
    [userId],
  );
  return row?.count ?? 0;
}

function createOne(userId: string, index: number): void {
  notificationStore.createNotification({
    body: `body ${index}`,
    eventType: 'task_update',
    id: `notif:${userId}:${index}`,
    title: `title ${index}`,
    userId,
  });
}

beforeAll(async () => {
  dbModule = await import('../../infra/db.js');
  await dbModule.migrate();
  notificationStore = await import('../../session/notification-store.js');
});

beforeEach(() => {
  notificationStore.__resetNotificationPruneStateForTesting();
  notificationStore.__setNotificationRetentionForTesting(null);
  dbModule.sqliteRun('DELETE FROM notifications', []);
  seedUser(USER_A, 'notif-a@example.com');
  seedUser(USER_B, 'notif-b@example.com');
});

afterEach(() => {
  notificationStore.__setNotificationRetentionForTesting(null);
  notificationStore.__resetNotificationPruneStateForTesting();
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('notification-store 保留裁剪', () => {
  it('每用户行数被裁剪到保留上限附近（不会无界增长）', () => {
    const limit = 5;
    notificationStore.__setNotificationRetentionForTesting(limit);

    const total = notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL * 3 + 7;
    for (let i = 0; i < total; i += 1) {
      createOne(USER_A, i);
    }

    const count = countNotificationRows(USER_A);
    // 摊销裁剪：行数最多比上限多出一个检查间隔的过冲，但绝不会随插入次数线性增长。
    expect(count).toBeLessThanOrEqual(limit + notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL);
    expect(count).toBeLessThan(total);

    // 保留的是最新的若干条：最后一条 id 必须仍在。
    const newest = dbModule.sqliteGet<{ id: string }>(
      `SELECT id FROM notifications WHERE user_id = ? ORDER BY rowid DESC LIMIT 1`,
      [USER_A],
    );
    expect(newest?.id).toBe(`notif:${USER_A}:${total - 1}`);
  });

  it('连续触发多轮后稳定收敛到保留上限附近', () => {
    const limit = 10;
    notificationStore.__setNotificationRetentionForTesting(limit);

    for (let i = 0; i < notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL * 5; i += 1) {
      createOne(USER_A, i);
    }

    expect(countNotificationRows(USER_A)).toBeLessThanOrEqual(
      limit + notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL,
    );
  });

  it('裁剪按 user 隔离，不影响其它用户的通知行', () => {
    notificationStore.__setNotificationRetentionForTesting(3);

    for (let i = 0; i < notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL + 5; i += 1) {
      createOne(USER_A, i);
    }
    // USER_B 只有少量行，远低于检查间隔，不应被触碰。
    createOne(USER_B, 0);
    createOne(USER_B, 1);

    expect(countNotificationRows(USER_B)).toBe(2);
    expect(countNotificationRows(USER_A)).toBeLessThanOrEqual(
      3 + notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL,
    );
  });

  it('保留上限设为非正数时关闭裁剪（行数随插入线性增长）', () => {
    notificationStore.__setNotificationRetentionForTesting(0);

    const total = notificationStore.NOTIFICATION_PRUNE_CHECK_INTERVAL * 2 + 13;
    for (let i = 0; i < total; i += 1) {
      createOne(USER_A, i);
    }

    expect(countNotificationRows(USER_A)).toBe(total);
  });
});
