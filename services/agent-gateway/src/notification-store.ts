import type { RunEvent } from '@openAwork/shared';
import { sqliteAll, sqliteRun } from './db.js';

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
    return {
      title: `等待权限 · ${event.toolName}`,
      body: event.previewAction ?? event.reason,
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
