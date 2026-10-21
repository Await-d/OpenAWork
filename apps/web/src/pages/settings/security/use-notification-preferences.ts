import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createNotificationsClient,
  type NotificationPreferenceEventType,
  type NotificationPreferenceRecord,
} from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import { requestNotificationPreferenceRefresh } from '../../../utils/chat/notification-preference-events.js';

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

/**
 * 通知偏好加载 / 保存的统一包装：置 busy / 清 error → try → catch 归一文案 → finally 清 busy。
 *
 * 必须留在模块级：React Compiler 1.0.0 不支持 `try/catch` 的 finally 子句，本 hook 2 处
 * 这类 try 会让整个 hook 脱靶（实测）。语义逐字照搬。
 */
async function runNotificationPreferenceActionOnce(ctx: {
  setBusy: (busy: boolean) => void;
  setError: (message: string | null) => void;
  /** catch 的兜底文案（`error.message` 优先）。 */
  failureMessage: string;
  run: () => Promise<void>;
}): Promise<void> {
  ctx.setBusy(true);
  ctx.setError(null);
  try {
    await ctx.run();
  } catch (error) {
    ctx.setError(error instanceof Error ? error.message : ctx.failureMessage);
  } finally {
    ctx.setBusy(false);
  }
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

    // 置 loading / 清 error 与 try/catch/finally 一起下沉到模块级
    // `runNotificationPreferenceActionOnce`（见其注释）。
    await runNotificationPreferenceActionOnce({
      setBusy: setLoading,
      setError: setLoadError,
      failureMessage: '加载通知偏好失败',
      run: async () => {
        const records = await createNotificationsClient(gatewayUrl).listPreferences(accessToken, {
          channel: 'web',
        });
        const nextDraft = toDraft(records);
        setSavedDraft(nextDraft);
        setDraft(nextDraft);
      },
    });
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

    // 同加载：置 saving / 清 error 与 try/catch/finally 一起下沉到
    // `runNotificationPreferenceActionOnce`（见其注释）。
    await runNotificationPreferenceActionOnce({
      setBusy: setSaving,
      setError: setSaveError,
      failureMessage: '保存通知偏好失败',
      run: async () => {
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
      },
    });
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
