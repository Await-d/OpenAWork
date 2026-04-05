import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createNotificationsClient,
  type NotificationPreferenceEventType,
  type NotificationPreferenceRecord,
} from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth.js';
import { requestNotificationPreferenceRefresh } from '../../utils/notification-preference-events.js';

export interface NotificationPreferenceItemDescriptor {
  description: string;
  eventType: NotificationPreferenceEventType;
  label: string;
}

export type BrowserNotificationPermissionState = NotificationPermission | 'unsupported';

export const NOTIFICATION_PREFERENCE_ITEMS: NotificationPreferenceItemDescriptor[] = [
  {
    eventType: 'permission_asked',
    label: '权限审批',
    description: '当会话等待你批准工具执行时，在页面隐藏状态下提醒你回来处理。',
  },
  {
    eventType: 'question_asked',
    label: '补充问题',
    description: '当 Agent 卡在待回答问题时，给你一个轻量但及时的浏览器提醒。',
  },
  {
    eventType: 'task_update',
    label: '任务状态',
    description: '当子任务完成或失败时提醒你查看结果，避免后台执行悄悄结束。',
  },
];

export type NotificationPreferenceDraft = Record<NotificationPreferenceEventType, boolean>;

const DEFAULT_DRAFT = NOTIFICATION_PREFERENCE_ITEMS.reduce<NotificationPreferenceDraft>(
  (accumulator, item) => {
    accumulator[item.eventType] = true;
    return accumulator;
  },
  {
    permission_asked: true,
    question_asked: true,
    task_update: true,
  },
);

function toDraft(records: NotificationPreferenceRecord[]): NotificationPreferenceDraft {
  const nextDraft: NotificationPreferenceDraft = { ...DEFAULT_DRAFT };
  records.forEach((record) => {
    nextDraft[record.eventType] = record.enabled;
  });
  return nextDraft;
}

function readBrowserNotificationPermission(): BrowserNotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }

  return Notification.permission;
}

export function useNotificationPreferences() {
  const accessToken = useAuthStore((state) => state.accessToken);
  const gatewayUrl = useAuthStore((state) => state.gatewayUrl);
  const [savedDraft, setSavedDraft] = useState<NotificationPreferenceDraft>(DEFAULT_DRAFT);
  const [draft, setDraft] = useState<NotificationPreferenceDraft>(DEFAULT_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [browserPermission, setBrowserPermission] = useState<BrowserNotificationPermissionState>(
    () => readBrowserNotificationPermission(),
  );

  const loadPreferences = useCallback(async () => {
    if (!accessToken) {
      setSavedDraft(DEFAULT_DRAFT);
      setDraft(DEFAULT_DRAFT);
      setLoadError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    try {
      const records = await createNotificationsClient(gatewayUrl).listPreferences(accessToken, {
        channel: 'web',
      });
      const nextDraft = toDraft(records);
      setSavedDraft(nextDraft);
      setDraft(nextDraft);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '加载通知偏好失败');
    } finally {
      setLoading(false);
    }
  }, [accessToken, gatewayUrl]);

  useEffect(() => {
    void loadPreferences();
  }, [loadPreferences]);

  useEffect(() => {
    setBrowserPermission(readBrowserNotificationPermission());
  }, []);

  const isDirty = useMemo(
    () =>
      NOTIFICATION_PREFERENCE_ITEMS.some(
        (item) => draft[item.eventType] !== savedDraft[item.eventType],
      ),
    [draft, savedDraft],
  );

  const togglePreference = useCallback((eventType: NotificationPreferenceEventType) => {
    setDraft((current) => ({
      ...current,
      [eventType]: !current[eventType],
    }));
    setSaveError(null);
  }, []);

  const resetPreferences = useCallback(() => {
    setDraft(savedDraft);
    setSaveError(null);
  }, [savedDraft]);

  const savePreferences = useCallback(async () => {
    if (!accessToken) {
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const records = await createNotificationsClient(gatewayUrl).updatePreferences(accessToken, {
        channel: 'web',
        preferences: NOTIFICATION_PREFERENCE_ITEMS.map((item) => ({
          eventType: item.eventType,
          enabled: draft[item.eventType],
        })),
      });
      const nextDraft = toDraft(records);
      setSavedDraft(nextDraft);
      setDraft(nextDraft);
      requestNotificationPreferenceRefresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存通知偏好失败');
    } finally {
      setSaving(false);
    }
  }, [accessToken, draft, gatewayUrl]);

  const requestBrowserPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setBrowserPermission('unsupported');
      return;
    }

    try {
      const nextPermission = await Notification.requestPermission();
      setBrowserPermission(nextPermission);
    } catch {
      setBrowserPermission(readBrowserNotificationPermission());
    }
  }, []);

  return {
    browserPermission,
    draft,
    isDirty,
    items: NOTIFICATION_PREFERENCE_ITEMS,
    loadError,
    loading,
    resetPreferences,
    requestBrowserPermission,
    saveError,
    savePreferences,
    saving,
    togglePreference,
  };
}
