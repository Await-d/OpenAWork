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
      const response = await fetch(`${baseUrl}/notifications${suffix ? `?${suffix}` : ''}`, {
        headers: authHeader(token),
        signal: options?.signal,
      });
      if (!response.ok) {
        throw new Error(`Failed to list notifications: ${response.status}`);
      }
      const data = (await response.json()) as { notifications?: NotificationRecord[] };
      return data.notifications ?? [];
    },

    async markRead(token, notificationId) {
      const response = await fetch(`${baseUrl}/notifications/${notificationId}/read`, {
        method: 'POST',
        headers: authHeader(token),
      });
      if (!response.ok && response.status !== 204) {
        throw new Error(`Failed to mark notification as read: ${response.status}`);
      }
    },

    async listPreferences(token, options) {
      const params = new URLSearchParams();
      if (options?.channel) {
        params.set('channel', options.channel);
      }
      const suffix = params.toString();
      const response = await fetch(
        `${baseUrl}/notifications/preferences${suffix ? `?${suffix}` : ''}`,
        {
          headers: authHeader(token),
          signal: options?.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Failed to list notification preferences: ${response.status}`);
      }
      const data = (await response.json()) as { preferences?: NotificationPreferenceRecord[] };
      return data.preferences ?? [];
    },

    async updatePreferences(token, input) {
      const response = await fetch(`${baseUrl}/notifications/preferences`, {
        method: 'PUT',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error(`Failed to update notification preferences: ${response.status}`);
      }
      const data = (await response.json()) as { preferences?: NotificationPreferenceRecord[] };
      return data.preferences ?? [];
    },
  };
}
