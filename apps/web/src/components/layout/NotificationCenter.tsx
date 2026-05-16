import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { createNotificationsClient } from '@openAwork/web-client';
import type {
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
} from '@openAwork/web-client';
import { subscribeNotificationPreferenceRefresh } from '../../utils/notification-preference-events.js';
import { preloadRouteModuleByPath } from '../../routes/preloadable-route-modules.js';
import { toast } from '../ToastNotification.js';

type NotificationPreferenceMap = Record<NotificationPreferenceEventType, boolean>;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceMap = {
  permission_asked: false,
  question_asked: false,
  task_update: false,
};

function toNotificationPreferenceMap(
  records: NotificationPreferenceRecord[],
): NotificationPreferenceMap {
  const nextPreferences: NotificationPreferenceMap = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  records.forEach((record) => {
    nextPreferences[record.eventType] = record.enabled;
  });
  return nextPreferences;
}

interface NotificationTypeMeta {
  bg: string;
  color: string;
  label: string;
}

const NOTIFICATION_TYPE_META: Record<string, NotificationTypeMeta> = {
  permission_asked: {
    bg: 'rgba(245, 158, 11, 0.12)',
    color: '#d97706',
    label: '权限请求',
  },
  question_asked: {
    bg: 'rgba(59, 130, 246, 0.12)',
    color: '#2563eb',
    label: '提问',
  },
  task_update: {
    bg: 'rgba(16, 185, 129, 0.12)',
    color: '#059669',
    label: '任务',
  },
};

const NOTIFICATION_TYPE_FALLBACK: NotificationTypeMeta = {
  bg: 'rgba(148, 163, 184, 0.16)',
  color: 'var(--text-2)',
  label: '通知',
};

function getNotificationTypeMeta(eventType: string): NotificationTypeMeta {
  return NOTIFICATION_TYPE_META[eventType] ?? NOTIFICATION_TYPE_FALLBACK;
}

function isBrowserNotificationEnabled(
  eventType: string,
  preferences: NotificationPreferenceMap,
): boolean {
  if (
    eventType === 'permission_asked' ||
    eventType === 'question_asked' ||
    eventType === 'task_update'
  ) {
    return preferences[eventType];
  }

  return true;
}

interface NotificationCenterProps {
  accessToken: string | null;
  gatewayUrl: string;
  /**
   * Whether to show a small pulsing dot when there is a pending permission
   * but no unread notifications. Kept compatible with the previous topbar
   * behaviour.
   */
  pendingPermissionIndicator?: boolean;
  /**
   * Optional inline style override applied to the label span. Used by the
   * surrounding NavRail to force the label hidden/visible regardless of the
   * CSS media query. When omitted the label follows the global
   * `.nav-rail-label` rules.
   */
  labelStyleOverride?: React.CSSProperties;
}

export default function NotificationCenter({
  accessToken,
  gatewayUrl,
  pendingPermissionIndicator = false,
  labelStyleOverride,
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [preferences, setPreferences] = useState<NotificationPreferenceMap>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  const seenIdsRef = useMemo(() => new Set<string>(), []);
  const preferencesRef = useRef<NotificationPreferenceMap>(DEFAULT_NOTIFICATION_PREFERENCES);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      if (container && event.target instanceof Node && !container.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const loadPreferences = useCallback(async (): Promise<NotificationPreferenceMap> => {
    if (!accessToken) {
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return DEFAULT_NOTIFICATION_PREFERENCES;
    }

    try {
      const next = toNotificationPreferenceMap(
        await createNotificationsClient(gatewayUrl).listPreferences(accessToken, {
          channel: 'web',
        }),
      );
      setPreferences(next);
      return next;
    } catch {
      return preferencesRef.current;
    }
  }, [accessToken, gatewayUrl]);

  const loadNotifications = useCallback(
    async (options?: { preferences?: NotificationPreferenceMap }) => {
      if (!accessToken) {
        setNotifications([]);
        return;
      }
      if (abortRef.current) {
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const effectivePreferences = options?.preferences ?? preferencesRef.current;
      try {
        const next = await createNotificationsClient(gatewayUrl).list(accessToken, {
          limit: 30,
          signal: controller.signal,
          status: 'unread',
        });
        if (controller.signal.aborted) {
          return;
        }
        setNotifications(next);

        if (
          typeof window !== 'undefined' &&
          document.visibilityState === 'hidden' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          next.forEach((item) => {
            if (seenIdsRef.has(item.id)) {
              return;
            }
            seenIdsRef.add(item.id);
            if (!isBrowserNotificationEnabled(item.eventType, effectivePreferences)) {
              return;
            }
            new Notification(item.title, { body: item.body, tag: item.id });
          });
        } else {
          next.forEach((item) => {
            seenIdsRef.add(item.id);
          });
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
        }
      }
    },
    [accessToken, gatewayUrl, seenIdsRef],
  );

  const handleOpenNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) {
        return;
      }

      await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      setNotifications((previous) => previous.filter((item) => item.id !== notification.id));
      setOpen(false);
      if (notification.sessionId) {
        preloadRoute('/chat');
        void navigate(`/chat/${notification.sessionId}`);
      }
    },
    [accessToken, gatewayUrl, navigate, preloadRoute],
  );

  const handleDismissNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) {
        return;
      }
      setNotifications((previous) => previous.filter((item) => item.id !== notification.id));
      try {
        await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      } catch {
        void loadNotifications().catch(() => undefined);
      }
    },
    [accessToken, gatewayUrl, loadNotifications],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!accessToken) {
      return;
    }
    const previous = notifications;
    setNotifications([]);
    try {
      await createNotificationsClient(gatewayUrl).markAllRead(accessToken);
    } catch {
      setNotifications(previous);
      toast('标记全部已读失败，请稍后重试', 'error');
    }
  }, [accessToken, gatewayUrl, notifications]);

  // Initial fetch + polling.
  useEffect(() => {
    if (!accessToken) {
      setNotifications([]);
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      return;
    }

    let cancelled = false;
    let intervalId: number | null = null;

    void (async () => {
      const next = await loadPreferences();
      if (cancelled) {
        return;
      }
      await loadNotifications({ preferences: next });
      if (cancelled) {
        return;
      }
      intervalId = window.setInterval(() => {
        void loadNotifications().catch(() => undefined);
      }, 15_000);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
    };
  }, [accessToken, loadPreferences, loadNotifications]);

  useEffect(() => {
    return subscribeNotificationPreferenceRefresh(() => {
      void loadPreferences().catch(() => undefined);
    });
  }, [loadPreferences]);

  if (!accessToken) {
    return null;
  }

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={containerRef}>
      <button
        type="button"
        onClick={() => {
          setOpen((previous) => !previous);
          void loadNotifications().catch(() => undefined);
        }}
        title="通知中心"
        className="nav-rail-btn"
        aria-pressed={open}
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          minHeight: 34,
          alignItems: 'center',
          gap: 10,
          padding: '0 10px',
          borderRadius: 9,
          color: 'var(--text-3)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          overflow: 'visible',
          fontWeight: 500,
        }}
      >
        <span className="nav-rail-icon" style={{ position: 'relative' }}>
          <svg
            aria-hidden="true"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
            <path d="M9 17a3 3 0 0 0 6 0" />
          </svg>
          {notifications.length > 0 ? (
            <span
              style={{
                position: 'absolute',
                top: -4,
                right: -6,
                minWidth: 15,
                height: 15,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--danger)',
                color: 'white',
                fontSize: 9,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                lineHeight: 1,
                boxShadow: '0 0 0 2px var(--nav-rail-bg)',
              }}
            >
              {notifications.length > 9 ? '9+' : notifications.length}
            </span>
          ) : null}
          {pendingPermissionIndicator && notifications.length === 0 && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: 999,
                background: '#f59e0b',
                boxShadow: '0 0 0 2px var(--nav-rail-bg)',
                animation: 'permissionPulse 1.5s ease-in-out infinite',
              }}
            />
          )}
        </span>
        <span
          className="nav-rail-label"
          style={{
            ...labelStyleOverride,
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '-0.005em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          通知
        </span>
      </button>{' '}
      {open ? (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 'calc(100% + 8px)',
            width: 360,
            maxHeight: 480,
            borderRadius: 14,
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            boxShadow: 'var(--shadow-lg)',
            zIndex: 40,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '10px 12px',
              borderBottom: '1px solid var(--border-subtle)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>通知中心</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                {notifications.length === 0 ? '已全部清空' : `${notifications.length} 条未读`}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                title="刷新"
                onClick={() => void loadNotifications().catch(() => undefined)}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: 'var(--surface)',
                  color: 'var(--text-3)',
                  cursor: 'pointer',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
              <button
                type="button"
                disabled={notifications.length === 0}
                onClick={() => void handleMarkAllRead()}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-subtle)',
                  background: notifications.length === 0 ? 'var(--surface)' : 'var(--bg-2)',
                  color: notifications.length === 0 ? 'var(--text-3)' : 'var(--text-2)',
                  cursor: notifications.length === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                全部已读
              </button>
            </div>
          </div>
          <div style={{ overflowY: 'auto', padding: 8, display: 'grid', gap: 6 }}>
            {notifications.length === 0 ? (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-3)',
                  padding: '24px 8px',
                  textAlign: 'center',
                }}
              >
                暂无未读通知
              </div>
            ) : (
              notifications.map((notification) => {
                const typeMeta = getNotificationTypeMeta(notification.eventType);
                return (
                  <div
                    key={notification.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => void handleOpenNotification(notification)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        void handleOpenNotification(notification);
                      }
                    }}
                    style={{
                      position: 'relative',
                      display: 'grid',
                      gridTemplateColumns: '4px 1fr',
                      gap: 10,
                      padding: '10px 32px 10px 10px',
                      borderRadius: 10,
                      border: '1px solid var(--border-subtle)',
                      background: 'var(--bg-2)',
                      cursor: 'pointer',
                      transition: 'background 150ms ease, border-color 150ms ease',
                    }}
                    onMouseEnter={(event) => {
                      event.currentTarget.style.background = 'var(--bg-1)';
                      event.currentTarget.style.borderColor = 'var(--border)';
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.style.background = 'var(--bg-2)';
                      event.currentTarget.style.borderColor = 'var(--border-subtle)';
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ width: 4, borderRadius: 2, background: typeMeta.color }}
                    />
                    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '1px 6px',
                            borderRadius: 999,
                            background: typeMeta.bg,
                            color: typeMeta.color,
                          }}
                        >
                          {typeMeta.label}
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'var(--text)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            minWidth: 0,
                            flex: 1,
                          }}
                          title={notification.title}
                        >
                          {notification.title}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: 12,
                          color: 'var(--text-2)',
                          lineHeight: 1.5,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {notification.body}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        {new Date(notification.createdAt).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {notification.eventType === 'permission_asked' && notification.sessionId && (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleOpenNotification(notification);
                          }}
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: '3px 8px',
                            borderRadius: 5,
                            border: '1px solid rgba(245,158,11,0.35)',
                            background: 'rgba(245,158,11,0.1)',
                            color: '#d97706',
                            cursor: 'pointer',
                            justifySelf: 'start',
                          }}
                        >
                          去审批
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      title="标记已读"
                      aria-label="标记已读"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleDismissNotification(notification);
                      }}
                      style={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        width: 20,
                        height: 20,
                        borderRadius: 6,
                        border: 'none',
                        background: 'transparent',
                        color: 'var(--text-3)',
                        cursor: 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
