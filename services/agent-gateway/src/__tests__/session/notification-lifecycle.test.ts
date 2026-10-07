/**
 * 通知生命周期（通知中心「不处理就会永远赖着」问题的回归防线）。
 *
 * 覆盖三条终结路径：
 * - 用户处理：审批提交 → acted、忽略 → archived
 * - 系统收口：会话终止 → expired、超过 TTL → 惰性过期
 * - 去重聚合：同一 dedupe_key 的重复事件不得堆叠成多条未读
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as DbModule from '../../infra/db.js';
import type * as NotificationStoreModule from '../../session/notification-store.js';

process.env['DATABASE_URL'] = ':memory:';
process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
delete process.env['OPENAWORK_NOTIFICATION_TTL_HOURS'];
delete process.env['OPENAWORK_NOTIFICATION_INFORMATIONAL_TTL_HOURS'];

let dbModule: typeof DbModule;
let notificationStore: typeof NotificationStoreModule;

const USER = 'u-notif-lifecycle';
const SESSION = 'sess-notif-lifecycle';

function seedUser(): void {
  dbModule.sqliteRun("INSERT OR IGNORE INTO users (id, email, password_hash) VALUES (?, ?, 'x')", [
    USER,
    'notif-lifecycle@example.com',
  ]);
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'lifecycle', '{}', 'idle')`,
    [SESSION, USER],
  );
}

function statusOf(id: string): string | undefined {
  return dbModule.sqliteGet<{ status: string }>('SELECT status FROM notifications WHERE id = ?', [
    id,
  ])?.status;
}

function kindOf(id: string): string | undefined {
  return dbModule.sqliteGet<{ kind: string }>('SELECT kind FROM notifications WHERE id = ?', [id])
    ?.kind;
}

function seedSession(id: string): void {
  dbModule.sqliteRun(
    `INSERT OR IGNORE INTO sessions (id, user_id, title, metadata_json, state_status)
     VALUES (?, ?, 'sibling', '{}', 'idle')`,
    [id, USER],
  );
}

function insert(input: {
  eventType?: string;
  id: string;
  sessionId?: string | null;
  status?: string;
}): void {
  const eventType = input.eventType ?? 'permission_asked';
  const kind =
    eventType === 'permission_asked' || eventType === 'question_asked'
      ? 'actionable'
      : 'informational';
  dbModule.sqliteRun(
    `INSERT INTO notifications
       (id, user_id, session_id, event_type, kind, title, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'title', 'body', ?, datetime('now'))`,
    [input.id, USER, input.sessionId ?? SESSION, eventType, kind, input.status ?? 'unread'],
  );
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
  seedUser();
});

afterEach(() => {
  notificationStore.__setNotificationRetentionForTesting(null);
  notificationStore.__resetNotificationPruneStateForTesting();
  delete process.env['OPENAWORK_NOTIFICATION_TTL_HOURS'];
  delete process.env['OPENAWORK_NOTIFICATION_INFORMATIONAL_TTL_HOURS'];
});

afterAll(async () => {
  await dbModule.closeDb();
});

describe('通知语义分类', () => {
  it('待响应类事件归为 actionable，其余归为 informational', () => {
    expect(notificationStore.resolveNotificationKind('permission_asked')).toBe('actionable');
    expect(notificationStore.resolveNotificationKind('question_asked')).toBe('actionable');
    expect(notificationStore.resolveNotificationKind('task_update')).toBe('informational');
  });

  it('创建时按 event_type 自动推导 kind', () => {
    notificationStore.createNotification({
      body: 'requestId=req-1\n需要执行 bash',
      eventType: 'permission_asked',
      id: 'n-1',
      sessionId: SESSION,
      title: '等待权限 · bash',
      userId: USER,
    });
    notificationStore.createNotification({
      body: '任务已完成',
      eventType: 'task_update',
      id: 'n-2',
      sessionId: SESSION,
      title: '任务已完成 · build',
      userId: USER,
    });

    expect(kindOf('n-1')).toBe('actionable');
    expect(kindOf('n-2')).toBe('informational');
  });

  it('铃铛红点只统计 actionable，结果播报不占用注意力', () => {
    insert({ id: 'p-1', eventType: 'permission_asked' });
    insert({ id: 'q-1', eventType: 'question_asked' });
    insert({ id: 't-1', eventType: 'task_update' });
    insert({ id: 't-2', eventType: 'task_update' });

    expect(notificationStore.countPendingActionableNotifications(USER)).toBe(2);
  });
});

describe('系统收口：用户不处理也不会永久滞留', () => {
  it('会话终止后 actionable 待办转 expired（覆盖提问，不止审批）', () => {
    insert({ id: 'p-1', eventType: 'permission_asked' });
    insert({ id: 'q-1', eventType: 'question_asked' });
    insert({ id: 't-1', eventType: 'task_update' });

    notificationStore.expireActionableNotificationsForSession({
      sessionId: SESSION,
      userId: USER,
    });

    expect(statusOf('p-1')).toBe('expired');
    // 此前 question_asked 完全没有收口通路，是永久滞留的主要泄漏点。
    expect(statusOf('q-1')).toBe('expired');
    // 结果播报不该被会话终止牵连。
    expect(statusOf('t-1')).toBe('unread');
  });

  it('会话收口不跨用户', () => {
    insert({ id: 'p-1', eventType: 'permission_asked' });
    dbModule.sqliteRun(
      "INSERT OR IGNORE INTO users (id, email, password_hash) VALUES ('u-x', 'x@e.com', 'x')",
    );
    dbModule.sqliteRun(
      `INSERT INTO notifications (id, user_id, session_id, event_type, kind, title, body, status, created_at)
       VALUES ('p-2', 'u-x', ?, 'permission_asked', 'actionable', 't', 'b', 'unread', datetime('now'))`,
      [SESSION],
    );

    notificationStore.expireActionableNotificationsForSession({
      sessionId: SESSION,
      userId: USER,
    });

    expect(statusOf('p-1')).toBe('expired');
    expect(statusOf('p-2')).toBe('unread');
  });

  it('超过 TTL 的未读通知在读取时被惰性过期，且不再出现在待处理列表', () => {
    insert({ id: 'old-1', eventType: 'permission_asked' });
    insert({ id: 'old-2', eventType: 'task_update' });
    dbModule.sqliteRun(
      `UPDATE notifications
          SET expires_at = datetime('now', '-1 hour')
        WHERE id IN ('old-1', 'old-2')`,
      [],
    );

    const pending = notificationStore.listNotifications({
      limit: 20,
      userId: USER,
      view: 'pending',
    });

    expect(pending).toHaveLength(0);
    expect(statusOf('old-1')).toBe('expired');
    expect(statusOf('old-2')).toBe('expired');
  });

  it('默认给每条通知写入 expires_at（待办 24h、结果播报更长）', () => {
    notificationStore.createNotification({
      body: 'requestId=req-ttl\n需要执行',
      eventType: 'permission_asked',
      id: 'ttl-1',
      sessionId: SESSION,
      title: '等待权限 · bash',
      userId: USER,
    });
    notificationStore.createNotification({
      body: 'done',
      eventType: 'task_update',
      id: 'ttl-2',
      sessionId: SESSION,
      title: '任务已完成',
      userId: USER,
    });

    const actionable = dbModule.sqliteGet<{ expires_at: string | null }>(
      'SELECT expires_at FROM notifications WHERE id = ?',
      ['ttl-1'],
    );
    const informational = dbModule.sqliteGet<{ expires_at: string | null }>(
      'SELECT expires_at FROM notifications WHERE id = ?',
      ['ttl-2'],
    );

    expect(actionable?.expires_at).not.toBeNull();
    expect(informational?.expires_at).not.toBeNull();
    // 结果播报的存活期必须严格长于待办，否则用户来不及回看结果就被收掉。
    // expires_at 是 'YYYY-MM-DD HH:MM:SS' 定宽格式，字典序即时序。
    expect(String(informational?.expires_at) > String(actionable?.expires_at)).toBe(true);
  });

  it('TTL 关闭（env 传非正数）时通知永不过期', () => {
    process.env['OPENAWORK_NOTIFICATION_TTL_HOURS'] = '0';
    notificationStore.createNotification({
      body: 'requestId=req-x\n需要执行',
      eventType: 'permission_asked',
      id: 'never-1',
      sessionId: SESSION,
      title: '等待权限 · bash',
      userId: USER,
    });
    const row = dbModule.sqliteGet<{ expires_at: string | null }>(
      'SELECT expires_at FROM notifications WHERE id = ?',
      ['never-1'],
    );
    expect(row?.expires_at).toBeNull();

    expect(
      notificationStore.listNotifications({ limit: 20, userId: USER, view: 'pending' }),
    ).toHaveLength(1);
    expect(statusOf('never-1')).toBe('unread');
  });
});

describe('用户处理：acted / archived 语义', () => {
  it('审批提交后对应通知转 acted（而非仅 read）', () => {
    insert({
      id: 'n-act-1',
      eventType: 'permission_asked',
      sessionId: SESSION,
    });
    dbModule.sqliteRun(
      `UPDATE notifications SET body = 'requestId=req-77\n原因' WHERE id = 'n-act-1'`,
      [],
    );

    notificationStore.markPermissionNotificationsActedByRequestIds({
      requestIds: ['req-77'],
      sessionId: SESSION,
      userId: USER,
    });

    expect(statusOf('n-act-1')).toBe('acted');
  });

  it('act 请求不匹配其它会话或未知 requestId', () => {
    insert({ id: 'n-act-2', eventType: 'permission_asked' });
    dbModule.sqliteRun(
      `UPDATE notifications SET body = 'requestId=req-99\n原因' WHERE id = 'n-act-2'`,
      [],
    );

    notificationStore.markPermissionNotificationsActedByRequestIds({
      requestIds: ['req-unknown'],
      sessionId: SESSION,
      userId: USER,
    });

    expect(statusOf('n-act-2')).toBe('unread');
  });

  it('归档单条后从待处理消失，并可在归档视图回溯', () => {
    insert({ id: 'n-arc-1', eventType: 'permission_asked' });

    notificationStore.archiveNotification({ id: 'n-arc-1', userId: USER });

    expect(statusOf('n-arc-1')).toBe('archived');
    expect(
      notificationStore.listNotifications({ limit: 20, userId: USER, view: 'pending' }),
    ).toHaveLength(0);
    expect(
      notificationStore
        .listNotifications({ limit: 20, userId: USER, view: 'archived' })
        .map((item) => item.id),
    ).toEqual(['n-arc-1']);
  });

  it('按会话批量归档，且不误伤其它会话', () => {
    seedSession('other-session');
    insert({ id: 'n-sess-1', eventType: 'permission_asked', sessionId: SESSION });
    insert({ id: 'n-sess-2', eventType: 'question_asked', sessionId: SESSION });
    dbModule.sqliteRun(
      `INSERT INTO notifications
         (id, user_id, session_id, event_type, kind, title, body, status, created_at)
       VALUES ('n-sess-3', ?, 'other-session', 'permission_asked', 'actionable', 't', 'b', 'unread', datetime('now'))`,
      [USER],
    );

    notificationStore.archiveNotifications({ sessionId: SESSION, userId: USER });

    expect(statusOf('n-sess-1')).toBe('archived');
    expect(statusOf('n-sess-2')).toBe('archived');
    expect(statusOf('n-sess-3')).toBe('unread');
  });

  it('归档是幂等的，不会重复改写归档时间', () => {
    insert({ id: 'n-arc-2', eventType: 'permission_asked' });
    notificationStore.archiveNotification({ id: 'n-arc-2', userId: USER });
    const first = dbModule.sqliteGet<{ archived_at: string | null }>(
      'SELECT archived_at FROM notifications WHERE id = ?',
      ['n-arc-2'],
    );

    notificationStore.archiveNotification({ id: 'n-arc-2', userId: USER });
    const second = dbModule.sqliteGet<{ archived_at: string | null }>(
      'SELECT archived_at FROM notifications WHERE id = ?',
      ['n-arc-2'],
    );

    expect(second?.archived_at).toBe(first?.archived_at);
  });
});

describe('去重聚合：重复事件不得堆叠成多条未读', () => {
  it('同一 dedupe_key 的重复通知刷新内容而非新增行', () => {
    notificationStore.createNotification({
      body: 'requestId=req-1\n第一次',
      dedupeKey: 'permission_asked:req-1',
      eventType: 'permission_asked',
      id: 'd-1',
      sessionId: SESSION,
      title: '等待权限 · bash',
      userId: USER,
    });
    notificationStore.createNotification({
      body: 'requestId=req-1\n第二次',
      dedupeKey: 'permission_asked:req-1',
      eventType: 'permission_asked',
      id: 'd-2',
      sessionId: SESSION,
      title: '等待权限 · bash',
      userId: USER,
    });

    const rows = dbModule.sqliteGet<{ count: number }>(
      `SELECT COUNT(1) AS count FROM notifications WHERE user_id = ? AND status = 'unread'`,
      [USER],
    );
    expect(rows?.count).toBe(1);

    const pending = notificationStore.listNotifications({
      limit: 20,
      userId: USER,
      view: 'pending',
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.body).toContain('第二次');
  });

  it('已归档的 dedupe_key 允许同键通知再次入列（不会被永久封死）', () => {
    notificationStore.createNotification({
      body: 'a',
      dedupeKey: 'permission_asked:req-2',
      eventType: 'permission_asked',
      id: 'd-3',
      sessionId: SESSION,
      title: 't',
      userId: USER,
    });
    notificationStore.archiveNotification({ id: 'd-3', userId: USER });

    notificationStore.createNotification({
      body: 'b',
      dedupeKey: 'permission_asked:req-2',
      eventType: 'permission_asked',
      id: 'd-4',
      sessionId: SESSION,
      title: 't',
      userId: USER,
    });

    expect(statusOf('d-4')).toBe('unread');
  });
});

describe('视图筛选', () => {
  beforeEach(() => {
    insert({ id: 'v-unread', eventType: 'permission_asked' });
    insert({ id: 'v-acted', eventType: 'permission_asked', status: 'acted' });
    insert({ id: 'v-archived', eventType: 'permission_asked', status: 'archived' });
    insert({ id: 'v-expired', eventType: 'permission_asked', status: 'expired' });
  });

  it('pending 只含未读，all 含未读+已处理但不含归档/失效', () => {
    const pending = notificationStore.listNotifications({
      kind: 'actionable',
      limit: 20,
      userId: USER,
      view: 'pending',
    });
    const all = notificationStore.listNotifications({ limit: 20, userId: USER, view: 'all' });

    expect(pending.map((item) => item.id)).toEqual(['v-unread']);
    expect(all.map((item) => item.id).sort()).toEqual(['v-acted', 'v-unread']);
  });

  it('kind 过滤把结果播报与待办彻底分开', () => {
    // 本块的 beforeEach 还会注入 v-* 样本，因此断言里带上它们。
    insert({ id: 'mix-1', eventType: 'permission_asked' });
    insert({ id: 'mix-2', eventType: 'task_update' });

    const actionable = notificationStore.listNotifications({
      kind: 'actionable',
      limit: 20,
      status: 'unread',
      userId: USER,
    });
    const broadcasts = notificationStore.listUnreadBroadcastNotifications({
      limit: 20,
      userId: USER,
    });

    expect(actionable.map((item) => item.id).sort()).toEqual(['mix-1', 'v-unread']);
    expect(broadcasts.map((item) => item.id)).toEqual(['mix-2']);
  });

  it('archived / expired 视图各自独立', () => {
    expect(
      notificationStore
        .listNotifications({ limit: 20, userId: USER, view: 'archived' })
        .map((item) => item.id),
    ).toEqual(['v-archived']);
    expect(
      notificationStore
        .listNotifications({ limit: 20, userId: USER, view: 'expired' })
        .map((item) => item.id),
    ).toEqual(['v-expired']);
  });

  it('不传 view 时返回全部状态（兼容旧调用）', () => {
    expect(notificationStore.listNotifications({ limit: 20, userId: USER })).toHaveLength(4);
  });
});
