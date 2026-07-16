import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import {
  createNotificationsClient,
  createPermissionsClient,
  createSessionsClient,
} from '@openAwork/web-client';
import { categorizeAlwaysPatterns } from '@openAwork/shared-ui';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import type {
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { subscribeNotificationPreferenceRefresh } from '../../../utils/chat/notification-preference-events.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { requestSessionStreamResumeAttach } from '../../../utils/session/session-stream-resume-events.js';
import { subscribeSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { toast } from '../../common/feedback/ToastNotification.js';
import { BellIcon } from './notification-icons.js';
import { NotificationPanel } from './NotificationPanel.js';
import {
  matchPendingPermissionForNotification,
  parsePermissionNotificationBody,
} from './NotificationItem.js';

// ── Types ──────────────────────────────────────────────────────

type NotificationPreferenceMap = Record<NotificationPreferenceEventType, boolean>;

const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferenceMap = {
  permission_asked: false,
  question_asked: false,
  task_update: false,
};

function toNotificationPreferenceMap(
  records: NotificationPreferenceRecord[],
): NotificationPreferenceMap {
  const next: NotificationPreferenceMap = { ...DEFAULT_NOTIFICATION_PREFERENCES };
  records.forEach((record) => {
    next[record.eventType] = record.enabled;
  });
  return next;
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

// ── Props ──────────────────────────────────────────────────────

interface NotificationCenterProps {
  accessToken: string | null;
  gatewayUrl: string;
  pendingPermissionIndicator?: boolean;
  labelStyleOverride?: React.CSSProperties;
  expanded?: boolean;
}

// ── Component ──────────────────────────────────────────────────

export default function NotificationCenter({
  accessToken,
  gatewayUrl,
  pendingPermissionIndicator = false,
  labelStyleOverride,
  expanded = true,
}: NotificationCenterProps) {
  const navigate = useNavigate();
  const preloadRoute = useCallback((path: string) => {
    void preloadRouteModuleByPath(path);
  }, []);

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferenceMap>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  const seenIdsRef = useMemo(() => new Set<string>(), []);
  const preferencesRef = useRef<NotificationPreferenceMap>(DEFAULT_NOTIFICATION_PREFERENCES);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      const container = containerRef.current;
      const panel = document.getElementById('nc-panel-portal');
      if (
        container &&
        event.target instanceof Node &&
        !container.contains(event.target) &&
        !(panel && panel.contains(event.target))
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  // Compute panel position from trigger button rect.
  // Panel opens to the right of the button, bottom-aligned to the button's bottom edge.
  // Using CSS `bottom` so the panel's actual bottom edge sits exactly at the button's
  // bottom edge regardless of the panel's content height.
  const computePanelPos = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const PANEL_MAX_HEIGHT = 520;
    const PANEL_WIDTH = 380;
    const MARGIN = 8;

    // Horizontal: place to the right of the button; if not enough space, place to the left.
    let left = rect.right + MARGIN;
    if (left + PANEL_WIDTH > window.innerWidth - MARGIN) {
      left = rect.left - PANEL_WIDTH - MARGIN;
    }

    // Vertical: bottom-align panel to the button's bottom edge.
    // `bottom` in fixed positioning = distance from viewport bottom.
    // So bottom = window.innerHeight - rect.bottom.
    const bottom = window.innerHeight - rect.bottom;

    // If the panel's max height would overflow above the viewport top,
    // clamp bottom so top stays at least MARGIN from the viewport top.
    // bottom_max = window.innerHeight - MARGIN - PANEL_MAX_HEIGHT
    const maxBottom = window.innerHeight - MARGIN - PANEL_MAX_HEIGHT;
    const clampedBottom = Math.min(bottom, maxBottom < MARGIN ? MARGIN : maxBottom);

    setPanelPos({ bottom: clampedBottom, left });
  }, []);

  useEffect(() => {
    if (!open) {
      setPanelPos(null);
      return;
    }
    computePanelPos();
    const handleResize = () => computePanelPos();
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleResize, true);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleResize, true);
    };
  }, [open, computePanelPos]);

  // ── Data loading ────────────────────────────────────────

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
      if (abortRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const effectivePreferences = options?.preferences ?? preferencesRef.current;
      try {
        const next = await createNotificationsClient(gatewayUrl).list(accessToken, {
          limit: 30,
          signal: controller.signal,
          status: 'unread',
        });
        if (controller.signal.aborted) return;
        setNotifications(next);

        // Browser notification when page hidden
        if (
          typeof window !== 'undefined' &&
          document.visibilityState === 'hidden' &&
          'Notification' in window &&
          Notification.permission === 'granted'
        ) {
          next.forEach((item) => {
            if (seenIdsRef.has(item.id)) return;
            seenIdsRef.add(item.id);
            if (!isBrowserNotificationEnabled(item.eventType, effectivePreferences)) return;
            new Notification(item.title, {
              body: (() => {
                if (item.eventType !== 'permission_asked') return item.body;
                const parsed = parsePermissionNotificationBody(item.body);
                if (!parsed) return item.body;
                return parsed.previewAction
                  ? `${parsed.reason}\n${parsed.previewAction}`
                  : parsed.reason;
              })(),
              tag: item.id,
            });
          });
        } else {
          next.forEach((item) => seenIdsRef.add(item.id));
        }
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [accessToken, gatewayUrl, seenIdsRef],
  );

  // ── Actions ─────────────────────────────────────────────

  const handleOpenNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) return;
      await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
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
      if (!accessToken) return;
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
      try {
        await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      } catch {
        void loadNotifications().catch(() => undefined);
      }
    },
    [accessToken, gatewayUrl, loadNotifications],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!accessToken) return;
    const previous = notifications;
    setNotifications([]);
    try {
      await createNotificationsClient(gatewayUrl).markAllRead(accessToken);
    } catch {
      setNotifications(previous);
      toast('标记全部已读失败，请稍后重试', 'error');
    }
  }, [accessToken, gatewayUrl, notifications]);

  // ── Session title cache ────────────────────────────────

  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const sessionTitleFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) return;
    const sessionIds = notifications
      .filter((n) => n.sessionId && !sessionTitleFetchedRef.current.has(n.sessionId))
      .map((n) => n.sessionId as string);
    const unique = [...new Set(sessionIds)];
    if (unique.length === 0) return;
    unique.forEach((id) => sessionTitleFetchedRef.current.add(id));
    const client = createSessionsClient(gatewayUrl);
    unique.forEach((sessionId) => {
      void client
        .get(accessToken, sessionId)
        .then((session) => {
          if (session?.title) {
            setSessionTitles((prev) => ({ ...prev, [sessionId]: session.title as string }));
          }
        })
        .catch(() => undefined);
    });
  }, [accessToken, gatewayUrl, notifications]);

  // ── Permission details cache ───────────────────────────

  const [permissionDetails, setPermissionDetails] = useState<
    Record<string, PendingPermissionRequest>
  >({});
  const permissionDetailsFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) return;
    const permNotifications = notifications.filter(
      (n) =>
        n.eventType === 'permission_asked' &&
        n.sessionId &&
        !permissionDetailsFetchedRef.current.has(n.id),
    );
    if (permNotifications.length === 0) return;
    permNotifications.forEach((n) => permissionDetailsFetchedRef.current.add(n.id));
    const permClient = createPermissionsClient(gatewayUrl);
    const bySession = new Map<string, NotificationRecord[]>();
    permNotifications.forEach((n) => {
      const list = bySession.get(n.sessionId as string) ?? [];
      list.push(n);
      bySession.set(n.sessionId as string, list);
    });
    bySession.forEach((notifs, sessionId) => {
      void permClient
        .listPending(accessToken, sessionId)
        .then((pending) => {
          const updates: Record<string, PendingPermissionRequest> = {};
          notifs.forEach((notification) => {
            const matched = matchPendingPermissionForNotification(notification, pending);
            if (matched) {
              updates[notification.id] = matched;
            }
          });
          if (Object.keys(updates).length > 0) {
            setPermissionDetails((prev) => ({ ...prev, ...updates }));
          }
        })
        .catch(() => undefined);
    });
  }, [accessToken, gatewayUrl, notifications]);

  // ── Quick permission reply ─────────────────────────────

  const [replyingIds, setReplyingIds] = useState<Set<string>>(new Set());
  const [selectedScopes, setSelectedScopes] = useState<
    Record<string, AlwaysScopeLevel['category']>
  >({});

  const handleQuickPermissionReply = useCallback(
    async (notification: NotificationRecord, decision: PermissionDecision) => {
      if (!accessToken || !notification.sessionId) return;
      setReplyingIds((prev) => new Set(prev).add(notification.id));
      try {
        const permClient = createPermissionsClient(gatewayUrl);
        const cachedDetails = permissionDetails[notification.id];
        let details = cachedDetails;
        let requestId = cachedDetails?.requestId;
        if (!requestId) {
          const pending = await permClient.listPending(accessToken, notification.sessionId);
          const matched = matchPendingPermissionForNotification(notification, pending);
          if (!matched) {
            toast('该权限请求已被处理或已过期', 'info');
            void handleDismissNotification(notification);
            return;
          }
          details = matched;
          requestId = matched.requestId;
          setPermissionDetails((prev) => ({ ...prev, [notification.id]: matched }));
        }
        let alwaysOverride: string[] | undefined;
        if (decision !== 'once' && decision !== 'reject' && details) {
          const levels = categorizeAlwaysPatterns(
            details.previewAction,
            details.scope,
            details.always,
          );
          const scopeCategory = selectedScopes[notification.id] ?? 'base';
          const selectedLevel =
            levels.find((level) => level.category === scopeCategory) ?? levels[levels.length - 1];
          if (selectedLevel) {
            alwaysOverride = [selectedLevel.pattern];
          }
        }
        await permClient.reply(accessToken, notification.sessionId, {
          requestId,
          decision,
          ...(alwaysOverride ? { alwaysOverride } : {}),
        });
        if (decision !== 'reject') {
          requestSessionStreamResumeAttach(notification.sessionId);
        }
        const labels: Record<PermissionDecision, string> = {
          once: '允许一次',
          session: '本会话允许',
          permanent: '永久允许',
          reject: '已拒绝',
        };
        toast(`已提交：${labels[decision]}`, 'success');
        void handleDismissNotification(notification);
      } catch {
        toast('审批操作失败，请稍后重试', 'error');
      } finally {
        setReplyingIds((prev) => {
          const next = new Set(prev);
          next.delete(notification.id);
          return next;
        });
      }
    },
    [accessToken, gatewayUrl, handleDismissNotification, permissionDetails, selectedScopes],
  );

  const handleScopeChange = useCallback((id: string, category: AlwaysScopeLevel['category']) => {
    setSelectedScopes((prev) => ({ ...prev, [id]: category }));
  }, []);

  // ── Initial fetch + polling ────────────────────────────

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
      if (cancelled) return;
      await loadNotifications({ preferences: next });
      if (cancelled) return;
      intervalId = window.setInterval(() => {
        void loadNotifications().catch(() => undefined);
      }, 15_000);
    })().catch(() => undefined);

    return () => {
      cancelled = true;
      if (intervalId !== null) window.clearInterval(intervalId);
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

  useEffect(() => {
    return subscribeSessionListRefresh(() => {
      void loadNotifications().catch(() => undefined);
    });
  }, [loadNotifications]);

  if (!accessToken) return null;

  const unreadCount = notifications.length;

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={containerRef}>
      {/* ── Trigger button ─────────────────────────────── */}
      <button
        type="button"
        ref={triggerRef}
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
          padding: expanded ? '0 12px' : '0',
          borderRadius: 9,
          color: open ? 'var(--accent)' : 'var(--fg-muted)',
          background: open ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          overflow: 'visible',
          fontWeight: 500,
          justifyContent: expanded ? 'flex-start' : 'center',
          transition: 'color 100ms cubic-bezier(0.4,0,0.2,1), background 100ms',
        }}
      >
        <span className="nav-rail-icon" style={{ position: 'relative', display: 'inline-flex' }}>
          <BellIcon size={17} />
          {unreadCount > 0 ? (
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
                color: 'var(--fg-on-accent)',
                fontSize: 9,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                lineHeight: 1,
                boxShadow: '0 0 0 2px var(--bg-raised)',
                animation: 'nc-badge-pop 300ms cubic-bezier(0.34,1.56,0.64,1)',
              }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          ) : null}
          {pendingPermissionIndicator && unreadCount === 0 && (
            <span
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: 999,
                background: 'var(--warning)',
                boxShadow: '0 0 0 2px var(--bg-raised)',
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
      </button>

      {/* ── Panel (portal to body, escapes sidebar overflow:hidden) ── */}
      {open &&
        panelPos &&
        typeof document !== 'undefined' &&
        createPortal(
          <NotificationPanel
            notifications={notifications}
            permissionDetails={permissionDetails}
            sessionTitles={sessionTitles}
            replyingIds={replyingIds}
            selectedScopes={selectedScopes}
            loading={loading}
            position={panelPos}
            onOpen={handleOpenNotification}
            onDismiss={handleDismissNotification}
            onMarkAllRead={() => void handleMarkAllRead()}
            onRefresh={() => void loadNotifications().catch(() => undefined)}
            onReply={handleQuickPermissionReply}
            onScopeChange={handleScopeChange}
          />,
          document.body,
        )}

      <style>{`
        @keyframes nc-badge-pop {
          0% { transform: scale(0); }
          60% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
