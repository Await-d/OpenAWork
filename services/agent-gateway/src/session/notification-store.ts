import type { RunEvent } from '@openAwork/shared';
import { sqliteAll, sqliteGet, sqliteRun } from '../infra/db.js';
import type { SqliteBindableValue } from '../infra/sqlite-bind-params.js';
import { deleteRowsBeyondMostRecent } from '../infra/sqlite-retention.js';
import type { NotificationChangeReason } from './notification-events-bus.js';
import { publishNotificationChangedEvent } from './notification-events-bus.js';
import { logGatewayWarn } from '../infra/gateway-logger.js';

export const NOTIFICATION_PREFERENCE_CHANNELS = ['web'] as const;
export const NOTIFICATION_PREFERENCE_EVENT_TYPES = [
  'permission_asked',
  'question_asked',
  'task_update',
] as const;

export type NotificationPreferenceChannel = (typeof NOTIFICATION_PREFERENCE_CHANNELS)[number];
export type NotificationPreferenceEventType = (typeof NOTIFICATION_PREFERENCE_EVENT_TYPES)[number];

/**
 * 通知生命周期状态。注意 `acted` / `archived` / `expired` 三者的区别：
 * - `acted`：用户真的响应了（提交了审批、收到了任务结果）——属于「已处理」
 * - `archived`：用户主动忽略——属于「选择不看」，但仍可在归档视图里回溯
 * - `expired`：底层待办已作废或超过存活期——系统收口，用户从未处理
 * `read` 只表示「点开看过」，不代表待办已消解。
 */
export const NOTIFICATION_STATUSES = ['unread', 'read', 'acted', 'archived', 'expired'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/**
 * 通知语义分类，决定它是否应该占用用户的注意力：
 * - `actionable`：底层真有东西在等用户响应（权限、提问），进红点
 * - `informational`：结果播报（任务完成 / 失败），只是信息，不进红点
 * 这一层区分是整套生命周期设计的地基——把两者都当「未读待办」是通知中心退化成
 * 事件日志、且永远收不干净的根因。
 */
export const NOTIFICATION_KINDS = ['actionable', 'informational'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** 列表视图：默认只看未收口的，其余供用户回溯或排查。 */
export const NOTIFICATION_VIEWS = ['pending', 'all', 'archived', 'expired'] as const;
export type NotificationView = (typeof NOTIFICATION_VIEWS)[number];

const ACTIONABLE_EVENT_TYPES: ReadonlySet<string> = new Set(['permission_asked', 'question_asked']);

export function resolveNotificationKind(eventType: string): NotificationKind {
  return ACTIONABLE_EVENT_TYPES.has(eventType) ? 'actionable' : 'informational';
}

export interface NotificationRecord {
  actedAt: string | null;
  archivedAt: string | null;
  body: string;
  createdAt: string;
  eventType: string;
  expiresAt: string | null;
  id: string;
  kind: NotificationKind;
  readAt: string | null;
  sessionId: string | null;
  status: NotificationStatus;
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
 * 存活期（TTL）。这是「用户不处理 ⇒ 通知永远赖着」的第一道防线：
 * `actionable` 待办底层总有消解时刻（审批被处理 / 会话被停止），但如果用户既不处理、
 * 系统也没能联动收口，通知仍会滞留；超过 TTL 后由 listNotifications 的惰性过期收口。
 * `informational` 是结果播报，滞留价值更低，TTL 可以给得更长（用户可能隔天才想看）。
 */
const DEFAULT_ACTIONABLE_TTL_HOURS = 24;
const DEFAULT_INFORMATIONAL_TTL_HOURS = 24 * 7;
export const NOTIFICATION_TTL_HOURS_ENV = 'OPENAWORK_NOTIFICATION_TTL_HOURS';
export const NOTIFICATION_INFORMATIONAL_TTL_HOURS_ENV =
  'OPENAWORK_NOTIFICATION_INFORMATIONAL_TTL_HOURS';

function resolveTtlHours(envName: string, fallback: number): number {
  const raw = globalThis.process?.env[envName];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  // 非正数 / NaN 视为「永不过期」，与其它 env 死线开关语义一致。
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function resolveNotificationTtlSeconds(kind: NotificationKind): number {
  const hours =
    kind === 'actionable'
      ? resolveTtlHours(NOTIFICATION_TTL_HOURS_ENV, DEFAULT_ACTIONABLE_TTL_HOURS)
      : resolveTtlHours(NOTIFICATION_INFORMATIONAL_TTL_HOURS_ENV, DEFAULT_INFORMATIONAL_TTL_HOURS);
  return hours * 60 * 60;
}

/**
 * notifications 是用户级只增表：每条 permission_asked / question_asked / task_update
 * 运行事件都会落一行。行的终结有三条路径：用户处理（acted / read / archived）、
 * 系统收口（expired）、以及这里的行数裁剪兜底。
 *
 * 裁剪摊销执行：不是每次 INSERT 都跑一次 DELETE（写放大翻倍），而是每累计
 * NOTIFICATION_PRUNE_CHECK_INTERVAL 次插入才触发一次。因此实际行数最多比上限多出一个
 * 检查间隔，属于可接受的过冲。裁剪失败只告警，绝不影响通知写入本身。
 */
const DEFAULT_NOTIFICATION_MAX_ROWS_PER_USER = 200;
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
  deleteRowsBeyondMostRecent({
    table: 'notifications',
    idColumn: 'rowid',
    limit,
    scope: { column: 'user_id', value: userId },
  });
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
    logGatewayWarn(
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

/**
 * 惰性过期：把超过 TTL 的未读通知转 `expired`。
 *
 * 不挂定时任务——读列表时顺手做掉，收益相同但零后台线程、零重启语义。
 * 代价是「用户从此再没打开面板」的那批通知要等裁剪兜底，两者叠加才是完整解。
 */
function expireDueNotifications(userId: string): void {
  sqliteRun(
    `UPDATE notifications
        SET status = 'expired'
      WHERE user_id = ?
        AND status = 'unread'
        AND expires_at IS NOT NULL
        AND expires_at <= datetime('now')`,
    [userId],
  );
}

function buildExpiresAtModifier(kind: NotificationKind): string | null {
  const seconds = resolveNotificationTtlSeconds(kind);
  return seconds <= 0 ? null : `+${seconds} seconds`;
}

export interface CreateNotificationInput {
  body: string;
  dedupeKey?: string | null;
  eventType: string;
  id: string;
  kind?: NotificationKind;
  sessionId?: string | null;
  title: string;
  userId: string;
}

export function createNotification(input: CreateNotificationInput): void {
  const kind = input.kind ?? resolveNotificationKind(input.eventType);
  const dedupeKey = input.dedupeKey?.trim() || null;

  if (dedupeKey) {
    // 同一 dedupe_key 的未读项只应有一条：重试 / 轮询重复事件不得让红点无限膨胀。
    // 命中既有项时刷新内容并置顶（等价 upsert），避免依赖 SQLite 的 upsert 语法；
    // 并发下双路都查空时由 partial unique index 兜底（见下方 catch）。
    const existing = sqliteGet<{ id: string }>(
      `SELECT id FROM notifications
        WHERE user_id = ? AND dedupe_key = ? AND status = 'unread'
        ORDER BY rowid DESC
        LIMIT 1`,
      [input.userId, dedupeKey],
    );
    if (existing) {
      sqliteRun(
        `UPDATE notifications
            SET title = ?, body = ?, created_at = datetime('now')
          WHERE id = ?`,
        [input.title, input.body, existing.id],
      );
      return;
    }
  }

  const expiresAtModifier = buildExpiresAtModifier(kind);
  try {
    // TTL 关闭（非正数）时 expires_at 写 NULL，表示永不过期——不能写成 now()，
    // 那等于「一落库就已到期」，下一次读取会立刻把它收成 expired。
    sqliteRun(
      `INSERT INTO notifications
         (id, user_id, session_id, event_type, kind, title, body, status,
          dedupe_key, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ${
         expiresAtModifier ? "datetime('now', ?)" : 'NULL'
       }, datetime('now'))`,
      [
        input.id,
        input.userId,
        input.sessionId ?? null,
        input.eventType,
        kind,
        input.title,
        input.body,
        dedupeKey,
        ...(expiresAtModifier ? [expiresAtModifier] : []),
      ],
    );
  } catch (error) {
    // 并发下另一路写入抢占了同一个 dedupe_key：业务语义已由那次写入满足，直接跳过。
    // 那次写入已经发过事件，这里绝不能补发——否则同一条待办会把红点/列表刷新两遍。
    if (isUniqueConstraintViolation(error)) {
      return;
    }
    throw error;
  }
  maybePruneNotifications(input.userId);
  publishNotificationChanged({ reason: 'created', userId: input.userId });
}

function isUniqueConstraintViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

const VIEW_STATUS_FILTERS: Readonly<Record<NotificationView, string>> = {
  pending: `status = 'unread'`,
  all: `status IN ('unread', 'read', 'acted')`,
  archived: `status = 'archived'`,
  expired: `status = 'expired'`,
};

/**
 * 未读结果播报：与「待处理」彻底分离，由路由在 `view=pending` 时额外交付，供页面隐藏
 * 时弹浏览器系统通知。
 *
 * 这样「结果播报不进铃铛」在 API 契约层面就成立——`pending` 视图的 rows 与
 * `pendingActionableCount` 口径完全一致。而不是让 pending 返回全量、再由前端自己
 * 过滤（那样 API 名叫 pending 却塞满播报，后续维护者极易踩坑）。
 */
export function listUnreadBroadcastNotifications(input: {
  limit: number;
  userId: string;
}): NotificationRecord[] {
  return listNotifications({
    kind: 'informational',
    limit: input.limit,
    status: 'unread',
    userId: input.userId,
  });
}

export interface NotificationSnapshot {
  /**
   * 未读结果播报的完整记录（任务完成/失败）——仅 `pending` 视图有值。
   * 它们不在铃铛列表里占位，客户端只用它在页面隐藏时弹系统通知。
   */
  browserBroadcasts: NotificationRecord[];
  notifications: NotificationRecord[];
  /** 未处理 actionable 待办数——铃铛红点应显示这个，而不是列表长度。 */
  pendingActionableCount: number;
}

/**
 * `pending` 视图的权威快照。
 *
 * `GET /notifications?view=pending` 与 `/notification-events` 的 `sync` 握手共用它：
 * 两者一旦各写各的，行口径与红点计数迟早漂移，而漂移表现是「红点说有 3 条、点开只有
 * 1 条」这类极难定位的问题。宁可多一个函数也不要两份口径。
 */
export function buildPendingNotificationSnapshot(
  userId: string,
  limit: number,
  status?: NotificationStatus,
): NotificationSnapshot {
  // `view=pending` 只含 actionable 待办 —— rows 与 pendingActionableCount 口径一致，
  // 结果播报不在铃铛里占位。
  const notifications = listNotifications({
    kind: 'actionable',
    limit,
    status,
    userId,
    view: 'pending',
  });
  // 红点只被「真的需要用户动手」的 actionable 待办点亮；结果播报不该抢注意力。
  const pendingActionableCount = countPendingActionableNotifications(userId);
  // 结果播报仅在待处理视图额外交付：客户端页面隐藏时据此弹系统通知，
  // 让「不进铃铛」不等于「不告知」。
  const browserBroadcasts = listUnreadBroadcastNotifications({ limit, userId });
  return { browserBroadcasts, notifications, pendingActionableCount };
}

export function listNotifications(input: {
  kind?: NotificationKind;
  limit: number;
  status?: NotificationStatus;
  userId: string;
  view?: NotificationView;
}): NotificationRecord[] {
  expireDueNotifications(input.userId);

  const filters: string[] = [];
  const params: SqliteBindableValue[] = [input.userId];

  if (input.view) {
    filters.push(VIEW_STATUS_FILTERS[input.view]);
  }
  if (input.status) {
    filters.push('status = ?');
    params.push(input.status);
  }
  if (input.kind) {
    filters.push('kind = ?');
    params.push(input.kind);
  }

  const where = filters.length > 0 ? ` AND ${filters.join(' AND ')}` : '';
  const rows = sqliteAll<
    NotificationRecord & {
      acted_at: string | null;
      archived_at: string | null;
      created_at: string;
      event_type: string;
      expires_at: string | null;
      kind: NotificationKind;
      read_at: string | null;
      session_id: string | null;
    }
  >(
    `SELECT id, session_id, event_type, kind, title, body, status,
            dedupe_key, expires_at, read_at, acted_at, archived_at, created_at
     FROM notifications
     WHERE user_id = ?${where}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [...params, input.limit],
  );

  return rows.map((row) => ({
    actedAt: row.acted_at,
    archivedAt: row.archived_at,
    body: row.body,
    createdAt: row.created_at,
    eventType: row.event_type,
    expiresAt: row.expires_at,
    id: row.id,
    kind: row.kind,
    readAt: row.read_at,
    sessionId: row.session_id,
    status: row.status,
    title: row.title,
  }));
}

/** 未处理的 actionable 待办数——铃铛红点只应被「真的需要我动手」的事点亮。 */
export function countPendingActionableNotifications(userId: string): number {
  expireDueNotifications(userId);
  return countPendingActionableWithoutExpiring(userId);
}

/**
 * 与 `countPendingActionableNotifications` 同口径，但**跳过惰性过期**（纯读）。
 *
 * 事件推送路径专用：推送只是「这里脏了」的信号，不该为了算一个红点数而制造写事务
 * 去抢 SQLite 写锁；客户端拿到事件后会走一次读路径，那条路径顺手完成过期收口。
 */
export function countPendingActionableWithoutExpiring(userId: string): number {
  const row = sqliteGet<{ count: number }>(
    `SELECT COUNT(1) AS count FROM notifications
      WHERE user_id = ? AND kind = 'actionable' AND status = 'unread'`,
    [userId],
  );
  return row?.count ?? 0;
}

/**
 * 落库即发事件——`/notification-events` WS 通道的唯一数据源。
 *
 * 没有任何 WS 订阅者时这是一次 no-op，因此对通知生命周期的单测完全透明。
 */
function publishNotificationChanged(input: {
  reason: NotificationChangeReason;
  userId: string;
}): void {
  publishNotificationChangedEvent({
    pendingActionableCount: countPendingActionableWithoutExpiring(input.userId),
    reason: input.reason,
    timestamp: Date.now(),
    type: 'notification.changed',
    userId: input.userId,
  });
}

export function markNotificationRead(input: { id: string; userId: string }): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'read', read_at = COALESCE(read_at, datetime('now'))
     WHERE id = ? AND user_id = ?`,
    [input.id, input.userId],
  );
  publishNotificationChanged({ reason: 'read', userId: input.userId });
}

/**
 * 审批被真正提交（或已由别处处理）后收口对应通知——此时语义是「已处理」而非「看过」。
 */
export function markPermissionNotificationsActedByRequestIds(input: {
  requestIds: readonly string[];
  sessionId: string;
  userId: string;
}): void {
  const requestIds = [...new Set(input.requestIds.map((value) => value.trim()).filter(Boolean))];
  for (const requestId of requestIds) {
    const prefix = `requestId=${requestId}\n`;
    sqliteRun(
      `UPDATE notifications
       SET status = 'acted', acted_at = COALESCE(acted_at, datetime('now'))
       WHERE user_id = ?
         AND session_id = ?
         AND event_type = 'permission_asked'
         AND status = 'unread'
         AND substr(body, 1, ?) = ?`,
      [input.userId, input.sessionId, prefix.length, prefix],
    );
  }
  publishNotificationChanged({ reason: 'acted', userId: input.userId });
}

/**
 * 会话级收口：底层待办已作废（停止运行、停止子任务），但通知还挂着未读。
 *
 * 停止整段运行（`/stream/stop`、`/stream/stop-active`）时会连待审批一起作废，
 * 对应的通知必须同步收口，否则通知中心会残留一条指向已作废审批的未读项
 * （浮层本身按 pending 过滤不会再弹出，但红点会骗人）。
 *
 * 这里按 `kind = 'actionable'` 而不是硬编码 `event_type = 'permission_asked'`：
 * `question_asked` 同样是等用户回答的待办，此前完全没有收口通路，是「未处理通知
 * 永久滞留」的主要泄漏点。`informational` 是结果播报，不该被会话终止牵连。
 */
export function expireActionableNotificationsForSession(input: {
  sessionId: string;
  userId: string;
}): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'expired'
     WHERE user_id = ?
       AND session_id = ?
       AND kind = 'actionable'
       AND status = 'unread'`,
    [input.userId, input.sessionId],
  );
  publishNotificationChanged({ reason: 'expired', userId: input.userId });
}

export function markAllNotificationsRead(input: { userId: string }): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'read', read_at = COALESCE(read_at, datetime('now'))
     WHERE user_id = ? AND status = 'unread'`,
    [input.userId],
  );
  publishNotificationChanged({ reason: 'read', userId: input.userId });
}

/** 用户主动忽略单条通知：不删除，留档可回溯。 */
export function archiveNotification(input: { id: string; userId: string }): void {
  sqliteRun(
    `UPDATE notifications
     SET status = 'archived', archived_at = COALESCE(archived_at, datetime('now'))
     WHERE id = ? AND user_id = ? AND status != 'archived'`,
    [input.id, input.userId],
  );
  publishNotificationChanged({ reason: 'archived', userId: input.userId });
}

export interface ArchiveNotificationsInput {
  eventTypes?: readonly string[];
  sessionId?: string | null;
  userId: string;
}

/**
 * 批量忽略：最常用的是「忽略此会话的全部通知」。
 *
 * 不返回受影响行数——`sqliteRun` 不暴露 changes，读一次 COUNT 换来的数字在并发下
 * 也只是近似；文案层面「已忽略」比一个可能不准的条数更诚实。
 */
export function archiveNotifications(input: ArchiveNotificationsInput): void {
  const filters: string[] = [`user_id = ?`, `status != 'archived'`];
  const params: SqliteBindableValue[] = [input.userId];

  if (input.sessionId) {
    filters.push('session_id = ?');
    params.push(input.sessionId);
  }
  const eventTypes = (input.eventTypes ?? []).map((value) => value.trim()).filter(Boolean);
  if (eventTypes.length > 0) {
    filters.push(`event_type IN (${eventTypes.map(() => '?').join(', ')})`);
    params.push(...eventTypes);
  }

  sqliteRun(
    `UPDATE notifications
     SET status = 'archived', archived_at = COALESCE(archived_at, datetime('now'))
     WHERE ${filters.join(' AND ')}`,
    params,
  );
  publishNotificationChanged({ reason: 'archived', userId: input.userId });
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
    dedupeKey: payload.dedupeKey,
    eventType: input.event.type,
    id: input.id,
    kind: payload.kind,
    sessionId: input.sessionId,
    title: payload.title,
    userId: input.userId,
  });
}

interface MappedNotification {
  body: string;
  dedupeKey: string | null;
  kind: NotificationKind;
  title: string;
}

function mapRunEventToNotification(event: RunEvent): MappedNotification | null {
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
      // 同一个 requestId 只保留一条未读：审批重试 / 事件重放不得让红点重复计票。
      dedupeKey: `${event.type}:${event.requestId}`,
      kind: 'actionable',
    };
  }

  if (event.type === 'question_asked') {
    return {
      title: `等待回答 · ${event.toolName}`,
      body: event.title,
      // 提问事件没有稳定的 requestId，按工具名去重会误合并同一会话的不同问题，
      // 因此不参与去重——只靠 TTL 与会话级收口兜底。
      dedupeKey: null,
      kind: 'actionable',
    };
  }

  if (event.type === 'task_update' && event.status === 'done') {
    return {
      title: `任务已完成 · ${event.label}`,
      body: event.result ?? '任务已完成，可返回查看结果。',
      // 长任务会持续推送 update，按 label 折叠成一条并不断刷新到最新，避免刷屏。
      dedupeKey: `${event.type}:done:${event.label}`,
      kind: 'informational',
    };
  }

  if (event.type === 'task_update' && event.status === 'failed') {
    return {
      title: `任务失败 · ${event.label}`,
      body: event.errorMessage ?? '任务执行失败，需要人工介入。',
      dedupeKey: `${event.type}:failed:${event.label}`,
      kind: 'informational',
    };
  }

  return null;
}
