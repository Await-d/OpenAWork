/**
 * `composer-queue-auto-run` 的行为契约。
 *
 * 这层决定「服务端无人值守消费」能不能安全落地，因此队列侧沿用**真实内存 SQLite**
 * （与 `composer-queue-store.test.ts` 同一范式）：出队、claim、幂等回填、FIFO 位置
 * 全都依赖真实 SQL 语义，mock 掉 db 只会验证到自己写的 mock。
 *
 * 两个运行时探针（待审批 / 在飞流）读的是进程内全局状态，无法在测试里构造，改用可
 * 切换的模块级 stub。**必须 mock 被测模块自己用的那个 specifier**——本文件位于
 * `src/__tests__/session/`，故用 `../../session/...` 与 `../../routes/...` 指向
 * 与 `src/session/composer-queue-auto-run.ts` 内部 import 相同的模块。
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import {
  MAX_CONSECUTIVE_QUEUE_AUTO_RUNS,
  readConsecutiveQueueAutoRunCount,
  resetComposerQueueAutoRunBudgetForTests,
  scheduleComposerQueueAutoRun,
  syncComposerQueueBlockedNotification,
  takeComposerQueueAutoRun,
  tryConsumeQueueAutoRunBudget,
} from '../../session/composer-queue-auto-run.js';
import type { ComposerQueueAttachment } from '../../session/composer-queue-store.js';
import {
  claimComposerQueueItem,
  COMPOSER_QUEUE_CLAIM_LEASE_MS,
  countComposerQueueItems,
  enqueueComposerQueueItem,
  listComposerQueueItems,
  removeComposerQueueItem,
} from '../../session/composer-queue-store.js';
import {
  buildPendingNotificationSnapshot,
  createNotification,
  QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE,
  reconcileActionableNotifications,
} from '../../session/notification-store.js';

process.env['DATABASE_URL'] = ':memory:';

/**
 * 两个探针的可切换状态。
 *
 * 刻意用 `vi.hoisted`：`vi.mock` 会被提升到文件顶部，普通 `let` 声明此时仍在 TDZ，
 * factory 一被调用就会抛「Cannot access before initialization」。
 */
const probes = vi.hoisted(() => ({
  inFlight: false,
  pendingInteraction: false,
}));

vi.mock('../../session/session-runtime-state.js', () => ({
  hasPendingSessionInteraction: () => probes.pendingInteraction,
}));

vi.mock('../../routes/stream-cancellation.js', () => ({
  getAnyInFlightStreamRequestForSession: () =>
    probes.inFlight
      ? { sessionId: 'sess-composer-auto-run-1', userId: 'u-auto-run-owner' }
      : undefined,
}));

const OWNER_ID = 'u-auto-run-owner';
const SESSION_ID = 'sess-composer-auto-run-1';
const NOW = 1_700_000_000_000;

let dbModule: typeof DbModule;

function enqueue(input: {
  attachmentItems?: ComposerQueueAttachment[];
  enqueuedAt?: number;
  itemId: string;
  requiresAttachmentRebind?: boolean;
  text?: string;
}): void {
  enqueueComposerQueueItem({
    attachmentItems: input.attachmentItems ?? [],
    enqueuedAt: input.enqueuedAt ?? 1,
    itemId: input.itemId,
    requiresAttachmentRebind: input.requiresAttachmentRebind ?? false,
    sessionId: SESSION_ID,
    text: input.text ?? '排队中的消息',
    userId: OWNER_ID,
  });
}

function take() {
  return takeComposerQueueAutoRun({ now: NOW, sessionId: SESSION_ID, userId: OWNER_ID });
}

function countRows(): number {
  return countComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID });
}

function listTexts(): string[] {
  return listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID }).map(
    (item) => item.text,
  );
}

/** 让 fire-and-forget 的续跑 promise 跑完一轮（起轮 → 回填 → 日志）。 */
async function flushScheduledAutoRun(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
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
    'auto-run-owner@example.com',
  ]);
  dbModule.sqliteRun('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [SESSION_ID, OWNER_ID]);
  // 提醒带 user_id / session_id 外键，删用户（上面）与删会话时已级联清掉；这里显式再来一次，
  // 避免用例之间因为写入顺序不同而互相污染。
  dbModule.sqliteRun('DELETE FROM notifications', []);
  dbModule.sqliteRun('DELETE FROM permission_requests', []);
  dbModule.sqliteRun('DELETE FROM question_requests', []);

  probes.pendingInteraction = false;
  probes.inFlight = false;
  resetComposerQueueAutoRunBudgetForTests();
  delete process.env['OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN'];
});

afterAll(async () => {
  delete process.env['OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN'];
  await dbModule.closeDb();
});

describe('takeComposerQueueAutoRun 的可消费性判定', () => {
  it('空队列返回 null', () => {
    expect(take()).toBeNull();
    expect(countRows()).toBe(0);
  });

  it('纯文本队首：以 itemId 作 clientRequestId 出队，且没有图片输入', () => {
    enqueue({ itemId: 'plain-1', text: '帮我看下这个报错' });

    const task = take();

    expect(task).not.toBeNull();
    expect(task?.clientRequestId).toBe('plain-1');
    expect(task?.inputParts).toEqual([]);
    expect(task?.text).toBe('帮我看下这个报错');
    expect(task?.sessionId).toBe(SESSION_ID);
    expect(task?.userId).toBe(OWNER_ID);
    // 出队即从库里消失，后续触发点读不到同一条（互斥靠这一点成立）。
    expect(countRows()).toBe(0);
    expect(listTexts()).toEqual([]);
  });

  it('等待审批 / 等待回答时不出队（ask 档停在 paused 的契约）', () => {
    enqueue({ itemId: 'paused-1', text: '待审批时不要发' });
    probes.pendingInteraction = true;

    expect(take()).toBeNull();
    // 关键：条目必须原样留在队列，用户处理完交互后由下一次回合收尾继续消费。
    expect(countRows()).toBe(1);
    expect(listTexts()).toEqual(['待审批时不要发']);
  });

  it('会话仍有在飞流时不出队', () => {
    enqueue({ itemId: 'in-flight-1', text: '上一轮还在跑' });
    probes.inFlight = true;

    expect(take()).toBeNull();
    expect(countRows()).toBe(1);
  });

  it('requiresAttachmentRebind 的条目不自动发', () => {
    enqueue({
      attachmentItems: [{ id: 'att-1', name: '截图.png', sizeBytes: 2048, type: 'image' }],
      itemId: 'rebind-1',
      requiresAttachmentRebind: true,
      text: '附件尚未回填',
    });

    expect(take()).toBeNull();
    expect(countRows()).toBe(1);
  });

  it('非图片附件（file）的条目不自动发', () => {
    enqueue({
      attachmentItems: [
        {
          artifactId: 'artifact-file-1',
          id: 'att-2',
          name: '报告.pdf',
          sizeBytes: 4096,
          type: 'file',
        },
      ],
      itemId: 'file-1',
      text: '带一个 PDF',
    });

    expect(take()).toBeNull();
    // 宁可不发，也不要发一条静默丢了附件的消息。
    expect(countRows()).toBe(1);
  });

  it('图片附件带 artifactId 时重建为模型输入并带上原始文件名', () => {
    enqueue({
      attachmentItems: [
        {
          artifactId: 'artifact-image-1',
          id: 'att-3',
          name: '界面截图.png',
          sizeBytes: 8192,
          type: 'image',
        },
      ],
      itemId: 'image-1',
      text: '看看这张图',
    });

    const task = take();

    expect(task?.clientRequestId).toBe('image-1');
    expect(task?.inputParts).toEqual([
      { artifactId: 'artifact-image-1', fileName: '界面截图.png', type: 'input_image' },
    ]);
    expect(countRows()).toBe(0);
  });

  it('连续自动轮达到上限后保留队列', () => {
    enqueue({ itemId: 'budget-1', text: '预算耗尽后不该发' });
    for (let index = 0; index < MAX_CONSECUTIVE_QUEUE_AUTO_RUNS; index += 1) {
      expect(tryConsumeQueueAutoRunBudget({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(true);
    }

    expect(take()).toBeNull();
    expect(countRows()).toBe(1);
  });

  it('总开关关闭时完全不出队', () => {
    enqueue({ itemId: 'switch-1', text: '回退到只由客户端驱动' });
    process.env['OPENAWORK_DISABLE_COMPOSER_QUEUE_AUTO_RUN'] = '1';

    expect(take()).toBeNull();
    expect(countRows()).toBe(1);
  });

  it('claim 失败时不消耗预算（另一端持租约时）', () => {
    enqueue({ itemId: 'claimed-elsewhere', text: '另一端正在发' });
    // 先由「另一个标签页」抢到租约：租约到期时间远晚于本端判定用的 NOW，故本端必然抢输。
    expect(
      claimComposerQueueItem({
        clientId: 'other-tab',
        itemId: 'claimed-elsewhere',
        leaseMs: COMPOSER_QUEUE_CLAIM_LEASE_MS,
        now: NOW,
        sessionId: SESSION_ID,
        userId: OWNER_ID,
      }),
    ).toBe(true);
    expect(readConsecutiveQueueAutoRunCount({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(0);

    expect(take()).toBeNull();

    // 本端一个动作都没做（条目没出队），因此绝不能扣预算——否则用户排了几十条、途中被
    // 抢几次，上限被白吃光，人不在场时队列就彻底停住了。
    expect(readConsecutiveQueueAutoRunCount({ sessionId: SESSION_ID, userId: OWNER_ID })).toBe(0);
    expect(countRows()).toBe(1);
    expect(listTexts()).toEqual(['另一端正在发']);
  });
});

describe('restore（起轮失败幂等回填）', () => {
  it('按原 enqueuedAt 回填，FIFO 位置不被打乱', () => {
    enqueue({ enqueuedAt: 100, itemId: 'head', text: '队首' });
    enqueue({ enqueuedAt: 200, itemId: 'tail', text: '队尾' });

    const task = take();
    expect(task?.clientRequestId).toBe('head');
    expect(listTexts()).toEqual(['队尾']);

    task?.restore();

    expect(listTexts()).toEqual(['队首', '队尾']);
    const rows = listComposerQueueItems({ sessionId: SESSION_ID, userId: OWNER_ID });
    expect(rows.map((row) => row.enqueuedAt)).toEqual([100, 200]);
  });

  it('重复 restore 仍然只有一条（同 itemId 幂等）', () => {
    enqueue({ enqueuedAt: 100, itemId: 'idempotent', text: '只该有一条' });

    const task = take();
    task?.restore();
    task?.restore();

    expect(countRows()).toBe(1);
    expect(listTexts()).toEqual(['只该有一条']);
  });
});

describe('scheduleComposerQueueAutoRun（fire-and-forget）', () => {
  it('网关未受理时把条目回填队列', async () => {
    enqueue({ itemId: 'not-accepted', text: '受理失败要回填' });

    scheduleComposerQueueAutoRun(
      { now: NOW, sessionId: SESSION_ID, userId: OWNER_ID },
      { startRun: async () => false },
    );

    await flushScheduledAutoRun();

    expect(countRows()).toBe(1);
    expect(listTexts()).toEqual(['受理失败要回填']);
  });

  it('起轮抛异常时回填且调度函数本身不同步抛错', async () => {
    enqueue({ itemId: 'throwing', text: '起轮异常也要回填' });

    expect(() => {
      scheduleComposerQueueAutoRun(
        { now: NOW, sessionId: SESSION_ID, userId: OWNER_ID },
        {
          startRun: async () => {
            throw new Error('上游 500');
          },
        },
      );
    }).not.toThrow();

    await flushScheduledAutoRun();

    expect(countRows()).toBe(1);
    expect(listTexts()).toEqual(['起轮异常也要回填']);
  });

  it('受理成功时条目保持出队状态', async () => {
    enqueue({ itemId: 'accepted', text: '正常起轮' });

    let receivedRequestId: string | undefined;
    scheduleComposerQueueAutoRun(
      { now: NOW, sessionId: SESSION_ID, userId: OWNER_ID },
      {
        startRun: async (task) => {
          receivedRequestId = task.clientRequestId;
          return true;
        },
      },
    );

    await flushScheduledAutoRun();

    expect(receivedRequestId).toBe('accepted');
    expect(countRows()).toBe(0);
  });

  it('队列不可消费时不调用起轮', async () => {
    enqueue({ itemId: 'blocked', text: '等待审批中' });
    probes.pendingInteraction = true;

    let called = false;
    scheduleComposerQueueAutoRun(
      { now: NOW, sessionId: SESSION_ID, userId: OWNER_ID },
      {
        startRun: async () => {
          called = true;
          return true;
        },
      },
    );

    await flushScheduledAutoRun();

    expect(called).toBe(false);
    expect(countRows()).toBe(1);
  });

  it('回填抛错时调度函数不产生未处理的 rejection', async () => {
    enqueue({ itemId: 'restore-throws', text: '会话删除后回填会撞外键' });

    const onUnhandled = vi.fn();
    process.on('unhandledRejection', onUnhandled);
    try {
      expect(() => {
        scheduleComposerQueueAutoRun(
          { now: NOW, sessionId: SESSION_ID, userId: OWNER_ID },
          {
            startRun: async () => {
              // 起轮期间会话被删除：回填要写 `session_composer_queue`，而 `session_id` 对
              // `sessions` 有外键（迁移里 `PRAGMA foreign_keys=ON`），插入必然失败。
              dbModule.sqliteRun('DELETE FROM sessions WHERE id = ?', [SESSION_ID]);
              return false;
            },
          },
        );
      }).not.toThrow();

      await flushScheduledAutoRun();
      await flushScheduledAutoRun();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }

    // 回填失败被兜住：既不产生 unhandled rejection，也不会有条目回到队列（消息丢了）。
    expect(onUnhandled).not.toHaveBeenCalled();
    expect(countRows()).toBe(0);
  });
});

describe('队首阻塞提醒（composer_queue_blocked）', () => {
  interface QueueBlockedRow {
    body: string;
    event_type: string;
    id: string;
    kind: string;
    status: string;
    title: string;
  }

  function listQueueBlockedRows(): QueueBlockedRow[] {
    return dbModule.sqliteAll<QueueBlockedRow>(
      `SELECT id, event_type, kind, title, body, status
         FROM notifications
        WHERE user_id = ? AND event_type = ?
        ORDER BY rowid ASC`,
      [OWNER_ID, QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE],
    );
  }

  function notificationStatusOf(id: string): string {
    const row = dbModule.sqliteGet<{ status: string }>(
      'SELECT status FROM notifications WHERE id = ?',
      [id],
    );
    return row?.status ?? 'missing';
  }

  function enqueueFileBlocked(itemId: string): void {
    enqueue({
      attachmentItems: [
        {
          artifactId: 'artifact-file-1',
          id: 'att-file-1',
          name: '报告.pdf',
          sizeBytes: 4096,
          type: 'file',
        },
      ],
      itemId,
      text: '带一个 PDF',
    });
  }

  it('队首因非图片附件阻塞时投递一条 actionable 提醒，且重复触发只有一条', () => {
    enqueueFileBlocked('blocked-file-1');

    expect(take()).toBeNull();
    // 每回合收尾都会重跑一次判定：幂等靠固定 dedupeKey，红点不得重复计票。
    expect(take()).toBeNull();

    expect(countRows()).toBe(1);
    const rows = listQueueBlockedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('actionable');
    expect(rows[0]?.status).toBe('unread');
    // 用户不在场，正文必须说清「卡在第几条」，否则他不知道该动哪一条。
    expect(rows[0]?.body).toContain('队列第 1 条');
  });

  it('队首因 requiresAttachmentRebind 阻塞时投递提醒', () => {
    enqueue({
      attachmentItems: [{ id: 'att-image-1', name: '截图.png', sizeBytes: 2048, type: 'image' }],
      itemId: 'blocked-rebind-1',
      requiresAttachmentRebind: true,
      text: '附件尚未回填',
    });

    expect(take()).toBeNull();

    const rows = listQueueBlockedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('重新选择');
    expect(rows[0]?.status).toBe('unread');
  });

  it('图片附件缺 artifactId 时用「副本已失效」文案，而不是「非图片附件」', () => {
    // 类型是 image、只是跨端副本没拿到：与「非图片附件」是两回事，文案不能混用。
    enqueue({
      attachmentItems: [
        { id: 'att-image-no-copy', name: '截图.png', sizeBytes: 2048, type: 'image' },
      ],
      itemId: 'blocked-image-no-copy-1',
      text: '带一张没副本的图',
    });

    expect(take()).toBeNull();
    // 仍然不发：静默丢图片比不发更糟。
    expect(countRows()).toBe(1);

    const rows = listQueueBlockedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('待发消息的图片副本已失效');
    expect(rows[0]?.body).toContain('队列第 1 条');
    // 关键回归点：不能让用户以为附件类型有问题。
    expect(rows[0]?.body).not.toContain('非图片附件');
  });

  it('阻塞解除后提醒被收口', () => {
    enqueueFileBlocked('blocked-file-2');
    expect(take()).toBeNull();
    expect(listQueueBlockedRows()[0]?.status).toBe('unread');

    // 用户在页面上手动移出阻塞条目 → 路由立刻重算一次（此处直接调那个 reconciler）。
    removeComposerQueueItem({
      itemId: 'blocked-file-2',
      sessionId: SESSION_ID,
      userId: OWNER_ID,
    });
    syncComposerQueueBlockedNotification({ sessionId: SESSION_ID, userId: OWNER_ID });

    expect(listQueueBlockedRows()[0]?.status).toBe('expired');
  });

  it('成功出队后收口旧提醒', () => {
    enqueueFileBlocked('blocked-file-3');
    expect(take()).toBeNull();
    expect(listQueueBlockedRows()[0]?.status).toBe('unread');

    removeComposerQueueItem({
      itemId: 'blocked-file-3',
      sessionId: SESSION_ID,
      userId: OWNER_ID,
    });
    enqueue({ itemId: 'plain-after-block', text: '阻塞解除后的纯文本' });

    const task = take();

    expect(task?.clientRequestId).toBe('plain-after-block');
    expect(countRows()).toBe(0);
    expect(listQueueBlockedRows()[0]?.status).toBe('expired');
  });

  it('reconcile 不会误清队列阻塞提醒', () => {
    createNotification({
      body: '队列第 1 条（共 1 条）包含非图片附件，自动续发只支持文本与图片。',
      dedupeKey: `${QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE}:${SESSION_ID}`,
      eventType: QUEUE_BLOCKED_NOTIFICATION_EVENT_TYPE,
      id: 'notif-queue-blocked-reconcile',
      kind: 'actionable',
      sessionId: SESSION_ID,
      title: '待发消息含自动续发不支持的文件',
      userId: OWNER_ID,
    });
    // 对账只扫「已过宽限期」的行：不把 created_at 做旧，本用例会因为宽限期而假通过，
    // 从而测不出「未知 event_type 被无条件收成 expired」这个回归。
    dbModule.sqliteRun("UPDATE notifications SET created_at = datetime('now', '-60 seconds')", []);

    buildPendingNotificationSnapshot(OWNER_ID, 20);

    expect(notificationStatusOf('notif-queue-blocked-reconcile')).toBe('unread');
  });

  it('reconcile 仍会收口已消解的 permission 提醒', () => {
    const requestId = 'req-permission-gone';
    createNotification({
      body: `requestId=${requestId}\n需要审批`,
      dedupeKey: `permission_asked:${requestId}`,
      eventType: 'permission_asked',
      id: 'notif-permission-gone',
      kind: 'actionable',
      sessionId: SESSION_ID,
      title: '等待权限 · bash',
      userId: OWNER_ID,
    });
    dbModule.sqliteRun("UPDATE notifications SET created_at = datetime('now', '-60 seconds')", []);
    // 底层审批行已彻底消解（这里连一行都不存在），对账必须把它收成 expired。
    dbModule.sqliteRun('DELETE FROM permission_requests', []);

    reconcileActionableNotifications(OWNER_ID);

    expect(notificationStatusOf('notif-permission-gone')).toBe('expired');
  });
});
