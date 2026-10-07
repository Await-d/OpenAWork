import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

/**
 * 通知生命周期状态。`acted`（已处理）/ `archived`（用户忽略）/ `expired`（系统收口）
 * 三者语义不同，见 gateway 的 notification-store。
 */
export type NotificationStatus = 'unread' | 'read' | 'acted' | 'archived' | 'expired';

/** `actionable` 才会点亮铃铛红点；`informational` 只是结果播报。 */
export type NotificationKind = 'actionable' | 'informational';

export type NotificationView = 'pending' | 'all' | 'archived' | 'expired';

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

export type NotificationPreferenceChannel = 'web';
export type NotificationPreferenceEventType = 'permission_asked' | 'question_asked' | 'task_update';

export interface NotificationPreferenceRecord {
  channel: NotificationPreferenceChannel;
  enabled: boolean;
  eventType: NotificationPreferenceEventType;
  updatedAt: string | null;
}

export interface NotificationsListResult {
  /**
   * 未读结果播报的完整记录（任务完成/失败）——仅 `view=pending` 时有值。
   * 它们不在铃铛列表里占位，客户端只用它在页面隐藏时弹系统通知：
   * 「不进铃铛」不等于「不告知」。
   */
  browserBroadcasts: NotificationRecord[];
  notifications: NotificationRecord[];
  /** 未处理的 actionable 待办数——铃铛红点应显示这个，而不是列表长度。 */
  pendingActionableCount: number;
}

export interface NotificationsClient {
  list(
    token: string,
    options?: {
      limit?: number;
      signal?: AbortSignal;
      status?: NotificationStatus;
      view?: NotificationView;
    },
  ): Promise<NotificationsListResult>;
  listPreferences(
    token: string,
    options?: { channel?: NotificationPreferenceChannel; signal?: AbortSignal },
  ): Promise<NotificationPreferenceRecord[]>;
  markAllRead(token: string): Promise<void>;
  markRead(token: string, notificationId: string): Promise<void>;
  /** 忽略单条（不删除，保留可回溯）。 */
  archive(token: string, notificationId: string): Promise<void>;
  /** 批量忽略（例如整个会话）。 */
  archiveMany(token: string, input: { eventTypes?: string[]; sessionId?: string }): Promise<void>;
  updatePreferences(
    token: string,
    input: {
      channel?: NotificationPreferenceChannel;
      preferences: Array<{ enabled: boolean; eventType: NotificationPreferenceEventType }>;
    },
  ): Promise<NotificationPreferenceRecord[]>;
}

function authHeader(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}` };
}

function buildNotificationsActionErrorMessage(
  actionLabel: string,
  status: number,
  data: JsonErrorData | undefined,
): string {
  const extracted = extractJsonErrorMessage(data);
  if (extracted) {
    return extracted;
  }
  if (status === 401 || status === 403) {
    return `认证失效或当前账号无权${actionLabel}。`;
  }
  if (status === 404) {
    return `目标通知资源不存在，无法${actionLabel}。`;
  }
  if (status === 409) {
    return `当前状态不允许${actionLabel}。`;
  }
  return `${actionLabel}失败（HTTP ${status}）。`;
}

function isGenericNotificationsNetworkErrorMessage(message: string): boolean {
  return isGenericFetchErrorMessage(message);
}

function normalizeNotificationsError(actionLabel: string, error: unknown): Error {
  if (error instanceof HttpError) {
    const extracted = extractJsonErrorMessage(
      (error.data ?? undefined) as JsonErrorData | undefined,
    );
    if (extracted) {
      return new HttpError(extracted, error.status, error.data);
    }
    return error;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message.length > 0 && !isGenericNotificationsNetworkErrorMessage(message)) {
      return error;
    }
  }
  return new Error(`网络异常，${actionLabel}失败。`);
}

async function performNotificationsRequest<T>(input: {
  actionLabel: string;
  parseJson?: boolean;
  request: () => Promise<Response>;
}): Promise<T> {
  try {
    const response = await input.request();
    if (!response.ok) {
      const data = await readJsonErrorData<JsonErrorData>(response);
      throw new HttpError(
        buildNotificationsActionErrorMessage(input.actionLabel, response.status, data),
        response.status,
        data,
      );
    }
    if (input.parseJson === false || response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    throw normalizeNotificationsError(input.actionLabel, error);
  }
}

export function createNotificationsClient(baseUrl: string): NotificationsClient {
  return {
    async list(token, options) {
      const params = new URLSearchParams();
      if (options?.view) {
        params.set('view', options.view);
      }
      if (options?.status) {
        params.set('status', options.status);
      }
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      const suffix = params.toString();
      const data = await performNotificationsRequest<{
        browserBroadcasts?: NotificationRecord[];
        notifications?: NotificationRecord[];
        pendingActionableCount?: number;
      }>({
        actionLabel: '读取通知列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications${suffix ? `?${suffix}` : ''}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      const notifications = data.notifications ?? [];
      // 老网关没有 pendingActionableCount 字段时退化为按 kind 推导，保证向后兼容。
      const pendingActionableCount =
        typeof data.pendingActionableCount === 'number'
          ? data.pendingActionableCount
          : notifications.filter((item) => item.kind === 'actionable').length;
      return {
        browserBroadcasts: data.browserBroadcasts ?? [],
        notifications,
        pendingActionableCount,
      };
    },

    async markAllRead(token) {
      await performNotificationsRequest({
        actionLabel: '标记全部通知为已读',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/read-all`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async markRead(token, notificationId) {
      await performNotificationsRequest({
        actionLabel: '标记通知为已读',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/${notificationId}/read`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async archive(token, notificationId) {
      await performNotificationsRequest({
        actionLabel: '忽略通知',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/${notificationId}/archive`, {
            method: 'POST',
            headers: authHeader(token),
          }),
      });
    },

    async archiveMany(token, input) {
      await performNotificationsRequest({
        actionLabel: '批量忽略通知',
        parseJson: false,
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/archive`, {
            method: 'POST',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...(input.sessionId ? { sessionId: input.sessionId } : {}),
              ...(input.eventTypes ? { eventTypes: input.eventTypes } : {}),
            }),
          }),
      });
    },

    async listPreferences(token, options) {
      const params = new URLSearchParams();
      if (options?.channel) {
        params.set('channel', options.channel);
      }
      const suffix = params.toString();
      const data = await performNotificationsRequest<{
        preferences?: NotificationPreferenceRecord[];
      }>({
        actionLabel: '读取通知偏好',
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/preferences${suffix ? `?${suffix}` : ''}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.preferences ?? [];
    },

    async updatePreferences(token, input) {
      const data = await performNotificationsRequest<{
        preferences?: NotificationPreferenceRecord[];
      }>({
        actionLabel: '保存通知偏好',
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications/preferences`, {
            method: 'PUT',
            headers: { ...authHeader(token), 'Content-Type': 'application/json' },
            body: JSON.stringify(input),
          }),
      });
      return data.preferences ?? [];
    },
  };
}
