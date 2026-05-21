import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import {
  createNotificationsClient,
  createPermissionsClient,
  createSessionsClient,
} from '@openAwork/web-client';
import type {
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import { subscribeNotificationPreferenceRefresh } from '../../../utils/chat/notification-preference-events.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { toast } from '../../common/feedback/ToastNotification.js';

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
    color: 'var(--warning)',
    label: '权限请求',
  },
  question_asked: {
    bg: 'rgba(59, 130, 246, 0.12)',
    color: 'var(--aux)',
    label: '提问',
  },
  task_update: {
    bg: 'rgba(16, 185, 129, 0.12)',
    color: 'var(--success)',
    label: '任务',
  },
};

const NOTIFICATION_TYPE_FALLBACK: NotificationTypeMeta = {
  bg: 'rgba(148, 163, 184, 0.16)',
  color: 'var(--fg-default)',
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

interface ParsedPermissionBody {
  reason: string;
  previewAction: string;
  scope: string;
  riskLevel: string;
}

/**
 * Parse the structured notification body for permission_asked events.
 * Format: "reason\npreviewAction\nscope\nriskLevel"
 * Falls back gracefully for legacy notifications that only have a single line.
 */
function parsePermissionNotificationBody(body: string): ParsedPermissionBody | null {
  const lines = body.split('\n');
  if (lines.length < 2) {
    return null;
  }
  return {
    reason: lines[0] ?? '',
    previewAction: lines[1] ?? '',
    scope: lines[2] ?? '',
    riskLevel: lines[3] ?? '',
  };
}

interface ScopeLevel {
  id: string;
  label: string;
  pattern: string;
  description: string;
}

/**
 * Compute three scope levels from a permission request's scope and always patterns.
 * For a bash command like "npm install express":
 *   - exact: "npm install express" (only this exact command)
 *   - sub:   "npm install *" (sub-command wildcard)
 *   - prefix: "npm *" (prefix wildcard, from always patterns)
 */
function computeScopeLevels(scope: string, always?: string[]): ScopeLevel[] {
  const levels: ScopeLevel[] = [];
  const trimmed = scope.trim();

  // Level 1: exact scope
  levels.push({
    id: 'exact',
    label: trimmed.length > 30 ? `${trimmed.slice(0, 30)}…` : trimmed,
    pattern: trimmed,
    description: '仅此操作',
  });

  // Level 2: sub-command wildcard (drop last token, add *)
  const tokens = trimmed.split(/\s+/);
  const firstToken = tokens[0] ?? '';
  const computedPrefix =
    always && always.length > 0 ? (always[0] ?? `${firstToken} *`) : `${firstToken} *`;
  if (tokens.length > 2) {
    const subPattern = tokens.slice(0, -1).join(' ') + ' *';
    // Only add if different from exact and from prefix
    if (subPattern !== trimmed && subPattern !== computedPrefix) {
      levels.push({
        id: 'sub',
        label: subPattern.length > 30 ? `${subPattern.slice(0, 30)}…` : subPattern,
        pattern: subPattern,
        description: '同子命令',
      });
    }
  }

  // Level 3: prefix wildcard (from always patterns or first token + *)
  if (computedPrefix !== trimmed) {
    levels.push({
      id: 'prefix',
      label: computedPrefix.length > 30 ? `${computedPrefix.slice(0, 30)}…` : computedPrefix,
      pattern: computedPrefix,
      description: '同类操作',
    });
  }

  return levels;
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
  /**
   * Whether the nav rail is in expanded state. Used to align padding and
   * justifyContent with sibling items.
   */
  expanded?: boolean;
}

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

  // --- Session title cache for showing source info ---
  const [sessionTitles, setSessionTitles] = useState<Record<string, string>>({});
  const sessionTitleFetchedRef = useRef<Set<string>>(new Set());

  // --- Permission details cache for three-level display ---
  const [permissionDetails, setPermissionDetails] = useState<
    Record<string, PendingPermissionRequest>
  >({});
  const permissionDetailsFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const sessionIds = notifications
      .filter((n) => n.sessionId && !sessionTitleFetchedRef.current.has(n.sessionId))
      .map((n) => n.sessionId as string);
    const unique = [...new Set(sessionIds)];
    if (unique.length === 0) {
      return;
    }
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

  // Fetch pending permission details for permission_asked notifications
  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const permNotifications = notifications.filter(
      (n) =>
        n.eventType === 'permission_asked' &&
        n.sessionId &&
        !permissionDetailsFetchedRef.current.has(n.id),
    );
    if (permNotifications.length === 0) {
      return;
    }
    permNotifications.forEach((n) => permissionDetailsFetchedRef.current.add(n.id));
    const permClient = createPermissionsClient(gatewayUrl);
    // Group by sessionId to avoid duplicate fetches
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
          const firstPending = pending.find((p) => p.status === 'pending');
          if (firstPending) {
            // Map the first pending permission to all permission notifications for this session
            const updates: Record<string, PendingPermissionRequest> = {};
            notifs.forEach((n) => {
              updates[n.id] = firstPending;
            });
            setPermissionDetails((prev) => ({ ...prev, ...updates }));
          }
        })
        .catch(() => undefined);
    });
  }, [accessToken, gatewayUrl, notifications]);

  // --- Quick permission reply ---
  const [replyingIds, setReplyingIds] = useState<Set<string>>(new Set());
  // Track selected scope level per notification: 'exact' | 'sub' | 'prefix'
  const [selectedScopes, setSelectedScopes] = useState<Record<string, string>>({});

  const handleQuickPermissionReply = useCallback(
    async (notification: NotificationRecord, decision: PermissionDecision) => {
      if (!accessToken || !notification.sessionId) {
        return;
      }
      setReplyingIds((prev) => new Set(prev).add(notification.id));
      try {
        const permClient = createPermissionsClient(gatewayUrl);
        // Use cached permission details if available, otherwise fetch
        const details = permissionDetails[notification.id];
        let requestId = details?.requestId;
        if (!requestId) {
          const pending = await permClient.listPending(accessToken, notification.sessionId);
          const firstPending = pending.find((p) => p.status === 'pending');
          if (!firstPending) {
            toast('该权限请求已被处理或已过期', 'info');
            void handleDismissNotification(notification);
            return;
          }
          requestId = firstPending.requestId;
        }
        // Compute alwaysOverride based on selected scope level
        let alwaysOverride: string[] | undefined;
        if (decision !== 'once' && decision !== 'reject' && details) {
          const scopeLevel = selectedScopes[notification.id] ?? 'prefix';
          const levels = computeScopeLevels(details.scope, details.always);
          const selectedLevel = levels.find((l) => l.id === scopeLevel);
          if (selectedLevel) {
            alwaysOverride = [selectedLevel.pattern];
          }
        }
        await permClient.reply(accessToken, notification.sessionId, {
          requestId,
          decision,
          ...(alwaysOverride ? { alwaysOverride } : {}),
        });
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
          padding: expanded ? '0 12px' : '0',
          borderRadius: 9,
          color: 'var(--fg-muted)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          overflow: 'visible',
          fontWeight: 500,
          justifyContent: expanded ? 'flex-start' : 'center',
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
                color: 'var(--fg-on-accent)',
                fontSize: 9,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
                lineHeight: 1,
                boxShadow: '0 0 0 2px var(--bg-raised)',
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
            border: '1px solid var(--border-default)',
            background: 'var(--bg-overlay)',
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
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--fg-strong)' }}>
                通知中心
              </span>
              <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
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
                  background: 'var(--bg-overlay)',
                  color: 'var(--fg-muted)',
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
                  background:
                    notifications.length === 0 ? 'var(--bg-overlay)' : 'var(--bg-overlay)',
                  color: notifications.length === 0 ? 'var(--fg-muted)' : 'var(--fg-default)',
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
                  color: 'var(--fg-muted)',
                  padding: '24px 8px',
                  textAlign: 'center',
                }}
              >
                暂无未读通知
              </div>
            ) : (
              notifications.map((notification) => {
                const typeMeta = getNotificationTypeMeta(notification.eventType);
                const permDetail = permissionDetails[notification.id];
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
                      background: 'var(--bg-overlay)',
                      cursor: 'pointer',
                    }}
                    className="ui-hover-list-row"
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
                            color: 'var(--fg-strong)',
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
                          color: 'var(--fg-default)',
                          lineHeight: 1.5,
                          display:
                            notification.eventType === 'permission_asked' &&
                            (permDetail || parsePermissionNotificationBody(notification.body))
                              ? 'none'
                              : '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                      >
                        {notification.body}
                      </span>
                      {/* Three-level permission detail display */}
                      {notification.eventType === 'permission_asked' &&
                        (() => {
                          const parsed = permDetail
                            ? {
                                toolName: permDetail.toolName,
                                reason: permDetail.reason,
                                previewAction: permDetail.previewAction ?? '',
                                riskLevel: permDetail.riskLevel,
                              }
                            : (() => {
                                const p = parsePermissionNotificationBody(notification.body);
                                if (!p) return null;
                                // Extract toolName from title "等待权限 · bash"
                                const titleMatch = notification.title.match(/·\s*(.+)$/);
                                return {
                                  toolName: titleMatch?.[1]?.trim() ?? '',
                                  reason: p.reason,
                                  previewAction: p.previewAction,
                                  riskLevel: p.riskLevel,
                                };
                              })();
                          if (!parsed) return null;
                          return (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                marginTop: 2,
                                fontSize: 10,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span
                                  style={{
                                    width: 5,
                                    height: 5,
                                    borderRadius: '50%',
                                    background: 'var(--warning)',
                                    flexShrink: 0,
                                  }}
                                />
                                <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
                                  {parsed.toolName}
                                </span>
                                {parsed.riskLevel && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      padding: '0 4px',
                                      borderRadius: 3,
                                      background:
                                        parsed.riskLevel === 'high'
                                          ? 'color-mix(in srgb, var(--danger) 14%, transparent)'
                                          : parsed.riskLevel === 'medium'
                                            ? 'color-mix(in srgb, var(--warning) 14%, transparent)'
                                            : 'color-mix(in srgb, var(--success) 14%, transparent)',
                                      color:
                                        parsed.riskLevel === 'high'
                                          ? 'var(--danger)'
                                          : parsed.riskLevel === 'medium'
                                            ? 'var(--warning)'
                                            : 'var(--success)',
                                      fontWeight: 600,
                                    }}
                                  >
                                    {parsed.riskLevel}
                                  </span>
                                )}
                              </div>
                              {parsed.reason && (
                                <div
                                  style={{
                                    marginLeft: 10,
                                    color: 'var(--fg-default)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={parsed.reason}
                                >
                                  {parsed.reason}
                                </div>
                              )}
                              {parsed.previewAction && (
                                <div
                                  style={{
                                    marginLeft: 10,
                                    color: 'var(--fg-muted)',
                                    fontFamily: 'var(--font-mono, monospace)',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title={parsed.previewAction}
                                >
                                  {parsed.previewAction}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      <span style={{ fontSize: 11, color: 'var(--fg-muted)' }}>
                        {new Date(notification.createdAt).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {notification.sessionId && sessionTitles[notification.sessionId] && (
                          <>
                            {' · '}
                            <span title={`来自会话: ${sessionTitles[notification.sessionId]}`}>
                              {sessionTitles[notification.sessionId]}
                            </span>
                          </>
                        )}
                      </span>
                      {notification.eventType === 'permission_asked' && notification.sessionId && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 5,
                            marginTop: 2,
                          }}
                        >
                          {/* Scope level selector (only when details are loaded and has multiple levels) */}
                          {permDetail &&
                            computeScopeLevels(permDetail.scope, permDetail.always).length > 1 && (
                              <div
                                style={{
                                  display: 'flex',
                                  gap: 4,
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span
                                  style={{ fontSize: 9, color: 'var(--fg-muted)', flexShrink: 0 }}
                                >
                                  范围:
                                </span>
                                {computeScopeLevels(permDetail.scope, permDetail.always).map(
                                  (level) => {
                                    const isSelected =
                                      (selectedScopes[notification.id] ?? 'prefix') === level.id;
                                    return (
                                      <button
                                        key={level.id}
                                        type="button"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setSelectedScopes((prev) => ({
                                            ...prev,
                                            [notification.id]: level.id,
                                          }));
                                        }}
                                        title={`${level.description}: ${level.pattern}`}
                                        style={{
                                          fontSize: 9,
                                          fontWeight: isSelected ? 700 : 500,
                                          padding: '2px 6px',
                                          borderRadius: 4,
                                          border: isSelected
                                            ? '1px solid var(--accent)'
                                            : '1px solid var(--border-subtle)',
                                          background: isSelected
                                            ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
                                            : 'transparent',
                                          color: isSelected ? 'var(--accent)' : 'var(--fg-muted)',
                                          cursor: 'pointer',
                                          fontFamily: 'var(--font-mono, monospace)',
                                          maxWidth: 120,
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        }}
                                      >
                                        {level.label}
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            )}
                          {/* Decision buttons */}
                          <div
                            style={{
                              display: 'flex',
                              gap: 6,
                              alignItems: 'center',
                              flexWrap: 'wrap',
                            }}
                          >
                            <button
                              type="button"
                              disabled={replyingIds.has(notification.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleQuickPermissionReply(notification, 'session');
                              }}
                              title="仅在当前会话内记住这次授权选择"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 999,
                                border: 'none',
                                background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
                                color: 'var(--accent)',
                                cursor: replyingIds.has(notification.id) ? 'wait' : 'pointer',
                                opacity: replyingIds.has(notification.id) ? 0.55 : 1,
                              }}
                            >
                              本会话允许
                            </button>
                            <button
                              type="button"
                              disabled={replyingIds.has(notification.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleQuickPermissionReply(notification, 'once');
                              }}
                              title="只批准当前这一次工具调用"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 999,
                                border: 'none',
                                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                                color: 'var(--accent)',
                                cursor: replyingIds.has(notification.id) ? 'wait' : 'pointer',
                                opacity: replyingIds.has(notification.id) ? 0.55 : 1,
                              }}
                            >
                              允许一次
                            </button>
                            <button
                              type="button"
                              disabled={replyingIds.has(notification.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleQuickPermissionReply(notification, 'permanent');
                              }}
                              title="会记住后续同类请求，请谨慎选择"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 999,
                                border: 'none',
                                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                                color: 'var(--accent)',
                                cursor: replyingIds.has(notification.id) ? 'wait' : 'pointer',
                                opacity: replyingIds.has(notification.id) ? 0.55 : 1,
                              }}
                            >
                              永久允许
                            </button>
                            <button
                              type="button"
                              disabled={replyingIds.has(notification.id)}
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleQuickPermissionReply(notification, 'reject');
                              }}
                              title="阻止本次调用，工具不会继续执行"
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '3px 8px',
                                borderRadius: 999,
                                border: 'none',
                                background: 'color-mix(in srgb, var(--danger) 14%, transparent)',
                                color: 'var(--danger)',
                                cursor: replyingIds.has(notification.id) ? 'wait' : 'pointer',
                                opacity: replyingIds.has(notification.id) ? 0.55 : 1,
                              }}
                            >
                              拒绝
                            </button>
                          </div>
                        </div>
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
                        color: 'var(--fg-muted)',
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
