import {
  extractJsonErrorMessage,
  HttpError,
  isGenericFetchErrorMessage,
  readJsonErrorData,
  type JsonErrorData,
  fetchWithTimeout,
} from '../gateway/http.js';

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

export type NotificationPreferenceChannel = 'web';
export type NotificationPreferenceEventType = 'permission_asked' | 'question_asked' | 'task_update';

export interface NotificationPreferenceRecord {
  channel: NotificationPreferenceChannel;
  enabled: boolean;
  eventType: NotificationPreferenceEventType;
  updatedAt: string | null;
}

export interface NotificationsClient {
  list(
    token: string,
    options?: { limit?: number; signal?: AbortSignal; status?: 'read' | 'unread' },
  ): Promise<NotificationRecord[]>;
  listPreferences(
    token: string,
    options?: { channel?: NotificationPreferenceChannel; signal?: AbortSignal },
  ): Promise<NotificationPreferenceRecord[]>;
  markAllRead(token: string): Promise<void>;
  markRead(token: string, notificationId: string): Promise<void>;
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
      if (options?.status) {
        params.set('status', options.status);
      }
      if (typeof options?.limit === 'number') {
        params.set('limit', String(options.limit));
      }
      const suffix = params.toString();
      const data = await performNotificationsRequest<{ notifications?: NotificationRecord[] }>({
        actionLabel: '读取通知列表',
        request: () =>
          fetchWithTimeout(`${baseUrl}/notifications${suffix ? `?${suffix}` : ''}`, {
            headers: authHeader(token),
            signal: options?.signal,
          }),
      });
      return data.notifications ?? [];
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
