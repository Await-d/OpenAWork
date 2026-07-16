import type { RunEvent } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from '../infra/db.js';

export const NOTIFICATION_PREFERENCE_CHANNELS = ['web'] as const;
export const NOTIFICATION_PREFERENCE_EVENT_TYPES = [
  'permission_asked',
  'question_asked',
  'task_update',
] as const;

export type NotificationPreferenceChannel = (typeof NOTIFICATION_PREFERENCE_CHANNELS)[number];
export type NotificationPreferenceEventType = (typeof NOTIFICATION_PREFERENCE_EVENT_TYPES)[number];

export interface NotificationRecord {
  body: string;
  createdAt: string;
  eventType: string;
  id: string;
  readAt: string | null;
  sessionId: string | null;
  status: 'read' | 'unread';
  title: string;
}

export interface NotificationPreferenceRecord {
  channel: NotificationPreferenceChannel;
  enabled: boolean;
  eventType: NotificationPreferenceEventType;
  updatedAt: string | null;
}

interface NotificationPreferenceRow {
  channel: NotificationPreferenceChannel;
  enabled: number;
  event_type: NotificationPreferenceEventType;
  updated_at: string;
}

const DEFAULT_NOTIFICATION_PREFERENCES: ReadonlyArray<
  Omit<NotificationPreferenceRecord, 'updatedAt'>
> = NOTIFICATION_PREFERENCE_EVENT_TYPES.map((eventType) => ({
  channel: 'web',
  enabled: true,
  eventType,
}));

/**
 * notifications 是用户级只增表：每条 permission_asked / question_asked / task_update
 * 运行事件都会落一行，已读项也从不删除，只有 session / user 被删时才随 CASCADE 清理。
 * 长期运行的网关会让活跃用户的通知行无界膨胀，拖慢 /notifications 列表查询并吃满磁盘。
 * 这里按「每用户保留最近 N 条」做有界裁剪，与 team_audit_logs / request_workflow_logs 同源。
 *
 * 裁剪摊销执行：不是每次 INSERT 都跑一次 DELETE（写放大翻倍），而是每累计
 * NOTIFICATION_PRUNE_CHECK_INTERVAL 次插入才触发一次。因此实际行数最多比上限多出一个
 * 检查间隔，属于可接受的过冲。裁剪失败只告警，绝不影响通知写入本身。
 */
const DEFAULT_NOTIFICATION_MAX_ROWS_PER_USER = 1000;
export const NOTIFICATION_PRUNE_CHECK_INTERVAL = 50;

let notificationRetentionOverride: number | null = null;
const notificationInsertsSincePruneByUser = new Map<string, number>();

function resolveNotificationRetention(): number {
  if (notificationRetentionOverride !== null) {
    return notificationRetentionOverride;
  }
  const raw = globalThis.process?.env['OPENAWORK_NOTIFICATION_MAX_ROWS_PER_USER'];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return DEFAULT_NOTIFICATION_MAX_ROWS_PER_USER;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 视为「关闭裁剪」，与其它 env 死线开关（传非正数禁用）保持一致语义。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function pruneNotifications(userId: string, limit: number): void {
  // 用隐式 rowid 而非 created_at 排序：created_at 是 datetime('now') 秒级精度，同秒内多条
  // 会并列；id 是确定性字符串主键、非单调。rowid 随插入单调递增，能稳定区分「最近 N 条」。
  sqliteRun(
    `DELETE FROM notifications
      WHERE user_id = ?
        AND rowid NOT IN (
          SELECT rowid FROM notifications
           WHERE user_id = ?
           ORDER BY rowid DESC
           LIMIT ?
        )`,
    [userId, userId, limit],
  );
}

function maybePruneNotifications(userId: string): void {
  const limit = resolveNotificationRetention();
  if (limit <= 0) {
    // 裁剪关闭：不累计计数，避免重新开启后立刻触发一次大裁剪。
    notificationInsertsSincePruneByUser.delete(userId);
    return;
  }
  const pending = (notificationInsertsSincePruneByUser.get(userId) ?? 0) + 1;
  if (pending < NOTIFICATION_PRUNE_CHECK_INTERVAL) {
    notificationInsertsSincePruneByUser.set(userId, pending);
    return;
  }
  notificationInsertsSincePruneByUser.set(userId, 0);
  try {
    pruneNotifications(userId, limit);
  } catch (error) {
    console.warn(
      `[notification-store] 裁剪 notifications 失败（user=${userId}）：${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/** 测试用：覆盖每用户保留上限（传 null 恢复 env / 默认值）。 */
export function __setNotificationRetentionForTesting(limit: number | null): void {
  notificationRetentionOverride = limit;
}

/** 测试用：清空摊销计数状态。 */
export function __resetNotificationPruneStateForTesting(): void {
  notificationInsertsSincePruneByUser.clear();
}

export function createNotification(input: {
  body: string;
  eventType: string;
  id: string;
  sessionId?: string | null;
  title: string;
  userId: string;
}): void {
  sqliteRun(
    `INSERT INTO notifications (id, user_id, session_id, event_type, title, body, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'unread', datetime('now'))`,
    [input.id, input.userId, input.sessionId ?? null, input.eventType, input.title, input.body],
  );
  maybePruneNotifications(input.userId);
}

export function listNotifications(input: {
  limit: number;
  status?: 'read' | 'unread';
  userId: string;
}): NotificationRecord[] {
  const rows = sqliteAll<
    NotificationRecord & {
      created_at: string;
      event_type: string;
      read_at: string | null;
      session_id: string | null;
    }
  >(
    `SELECT id, session_id, event_type, title, body, status, read_at, created_at
     FROM notifications
     WHERE user_id = ? ${input.status ? 'AND status = ?' : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    input.status ? [input.userId, input.status, input.limit] : [input.userId, input.limit],
  );

  return rows.map((row) => ({
    body: row.body,
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    readAt: row.read_at,
    sessionId: row.session_id,
    status: row.status,
    title: row.title,
  }));
}

export function markNotificationRead(input: { id: string; userId: string }): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'read', read_at = COALESCE(read_at, datetime('now'))
     WHERE id = ? AND user_id = ?`,
    [input.id, input.userId],
  );
}

export function markPermissionNotificationsReadByRequestIds(input: {
  requestIds: readonly string[];
  sessionId: string;
  userId: string;
}): void {
  const requestIds = [...new Set(input.requestIds.map((value) => value.trim()).filter(Boolean))];
  for (const requestId of requestIds) {
    const prefix = `requestId=${requestId}\n`;
    sqliteRun(
      `UPDATE notifications
       SET status = 'read', read_at = COALESCE(read_at, datetime('now'))
       WHERE user_id = ?
         AND session_id = ?
         AND event_type = 'permission_asked'
         AND status = 'unread'
         AND substr(body, 1, ?) = ?`,
      [input.userId, input.sessionId, prefix.length, prefix],
    );
  }
}

export function markAllNotificationsRead(input: { userId: string }): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'read', read_at = COALESCE(read_at, datetime('now'))
     WHERE user_id = ? AND status = 'unread'`,
    [input.userId],
  );
}

export function listNotificationPreferences(input: {
  channel?: NotificationPreferenceChannel;
  userId: string;
}): NotificationPreferenceRecord[] {
  const rows = sqliteAll<NotificationPreferenceRow>(
    `SELECT channel, event_type, enabled, updated_at
     FROM notification_preferences
     WHERE user_id = ? ${input.channel ? 'AND channel = ?' : ''}
     ORDER BY channel ASC, event_type ASC`,
    input.channel ? [input.userId, input.channel] : [input.userId],
  );

  const defaults = DEFAULT_NOTIFICATION_PREFERENCES.filter(
    (item) => !input.channel || item.channel === input.channel,
  );

  return defaults.map((item) => {
    const matched = rows.find(
      (row) => row.channel === item.channel && row.event_type === item.eventType,
    );

    return {
      channel: item.channel,
      enabled: matched ? matched.enabled !== 0 : item.enabled,
      eventType: item.eventType,
      updatedAt: matched?.updated_at ?? null,
    };
  });
}

export function upsertNotificationPreferences(input: {
  channel: NotificationPreferenceChannel;
  preferences: Array<{ enabled: boolean; eventType: NotificationPreferenceEventType }>;
  userId: string;
}): NotificationPreferenceRecord[] {
  const normalized = new Map<NotificationPreferenceEventType, boolean>();
  input.preferences.forEach((item) => {
    normalized.set(item.eventType, item.enabled);
  });

  normalized.forEach((enabled, eventType) => {
    sqliteRun(
      `INSERT INTO notification_preferences (user_id, channel, event_type, enabled, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, channel, event_type)
       DO UPDATE SET enabled = excluded.enabled, updated_at = datetime('now')`,
      [input.userId, input.channel, eventType, enabled ? 1 : 0],
    );
  });

  return listNotificationPreferences({ channel: input.channel, userId: input.userId });
}

export function buildNotificationFromRunEvent(input: {
  event: RunEvent;
  id: string;
  sessionId: string;
  userId: string;
}): void {
  const payload = mapRunEventToNotification(input.event);
  if (!payload) {
    return;
  }

  createNotification({
    body: payload.body,
    eventType: input.event.type,
    id: input.id,
    sessionId: input.sessionId,
    title: payload.title,
    userId: input.userId,
  });
}

function mapRunEventToNotification(event: RunEvent): { body: string; title: string } | null {
  if (event.type === 'permission_asked') {
    const parts = [
      `requestId=${event.requestId}`,
      event.reason,
      event.previewAction ?? '',
      event.scope ?? '',
      event.riskLevel ?? '',
    ];
    return {
      title: `等待权限 · ${event.toolName}`,
      body: parts.join('\n'),
    };
  }

  if (event.type === 'question_asked') {
    return {
      title: `等待回答 · ${event.toolName}`,
      body: event.title,
    };
  }

  if (event.type === 'task_update' && event.status === 'done') {
    return {
      title: `任务已完成 · ${event.label}`,
      body: event.result ?? '任务已完成，可返回查看结果。',
    };
  }

  if (event.type === 'task_update' && event.status === 'failed') {
    return {
      title: `任务失败 · ${event.label}`,
      body: event.errorMessage ?? '任务执行失败，需要人工介入。',
    };
  }

  return null;
}
