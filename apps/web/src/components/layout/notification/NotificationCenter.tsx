import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import {
  createNotificationsClient,
  createPermissionsClient,
  createSessionsClient,
} from '@openAwork/web-client';
import { resolveAlwaysScopeSelection } from '@openAwork/shared-ui';
import type { AlwaysScopeLevel } from '@openAwork/shared-ui';
import type {
  NotificationPreferenceEventType,
  NotificationPreferenceRecord,
  NotificationRecord,
  NotificationView,
  NotificationsListResult,
  PendingPermissionRequest,
  PermissionDecision,
} from '@openAwork/web-client';
import {
  connectNotificationEvents,
  disconnectNotificationEvents,
  subscribeNotificationEvents,
} from '../../../stores/notification-events.js';
import { subscribeNotificationPreferenceRefresh } from '../../../utils/chat/notification-preference-events.js';
import { preloadRouteModuleByPath } from '../../../routes/preloadable-route-modules.js';
import { requestSessionStreamResumeAttach } from '../../../utils/session/session-stream-resume-events.js';
import { subscribeSessionListRefresh } from '../../../utils/session/session-list-events.js';
import { isPermissionReplyAlreadyHandled } from '../../../utils/permission/permission-reply.js';
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
  /**
   * 铃铛红点只由「未处理的 actionable 待办」点亮。任务完成之类的结果播报
   * （informational）不该红着脸催人——这是「用户不处理 ⇒ 通知永远赖着」
   * 的体验根因：列表被无待办的信息塞满，红点失去指示意义。
   */
  const [pendingActionableCount, setPendingActionableCount] = useState(0);
  const [browserBroadcasts, setBrowserBroadcasts] = useState<NotificationRecord[]>([]);
  const [view, setView] = useState<NotificationView>('pending');
  const [loading, setLoading] = useState(false);
  const [preferences, setPreferences] = useState<NotificationPreferenceMap>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );

  const seenIdsRef = useMemo(() => new Set<string>(), []);
  const preferencesRef = useRef<NotificationPreferenceMap>(DEFAULT_NOTIFICATION_PREFERENCES);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const permissionDetailsFetchedRef = useRef<Set<string>>(new Set());
  /**
   * 本地已判定为 stale 并正在 / 已 markRead 的 permission 通知 id。
   * 用于挡住「乐观移除 → markRead 未落库 → loadNotifications 又把未读项拉回」
   * 的竞态；markRead 失败时会从集合中剔除，允许后续重试。
   */
  const dismissedPermissionNotificationIdsRef = useRef<Set<string>>(new Set());
  const [panelPos, setPanelPos] = useState<{ bottom: number; left: number } | null>(null);
  /** 实时事件需要知道当前视图，否则用户在看归档时被 pending 数据覆盖。 */
  const viewRef = useRef<NotificationView>('pending');

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

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

  /**
   * 把一份「铃铛数据」落到 state —— HTTP 拉取与 WS 握手快照共用。
   *
   * 两者结构天然一致（服务端 `buildPendingNotificationSnapshot` 就是 HTTP 响应体形状），
   * 共用一段落地逻辑意味着「快照」不会绕过本地已读/已忽略的过滤与系统通知去重。
   */
  const applyNotificationsResult = useCallback(
    (result: NotificationsListResult, effectivePreferences: NotificationPreferenceMap) => {
      // 过滤掉本地已判定 stale / 刚处理完但仍可能短暂未读的 permission 通知，
      // 避免 markRead 与 list 之间的竞态把它们重新弹回列表。
      const visible = result.notifications.filter(
        (item) => !dismissedPermissionNotificationIdsRef.current.has(item.id),
      );
      setNotifications(visible);
      setPendingActionableCount(result.pendingActionableCount);
      setBrowserBroadcasts(result.browserBroadcasts ?? []);

      // Browser notification when page hidden. Iterates actionable 待办 + 结果播报：
      // 播报不在铃铛里占位，但用户离开页面时仍必须被告知任务已完成。
      if (
        typeof window !== 'undefined' &&
        document.visibilityState === 'hidden' &&
        'Notification' in window &&
        Notification.permission === 'granted'
      ) {
        [...visible, ...(result.browserBroadcasts ?? [])].forEach((item) => {
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
        [...visible, ...(result.browserBroadcasts ?? [])].forEach((item) =>
          seenIdsRef.add(item.id),
        );
      }
    },
    [seenIdsRef],
  );

  const loadNotifications = useCallback(
    async (options?: { preferences?: NotificationPreferenceMap; view?: NotificationView }) => {
      if (!accessToken) {
        setNotifications([]);
        setPendingActionableCount(0);
        setBrowserBroadcasts([]);
        return;
      }
      if (abortRef.current) return;

      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      const effectivePreferences = options?.preferences ?? preferencesRef.current;
      const effectiveView = options?.view ?? 'pending';
      try {
        const result = await createNotificationsClient(gatewayUrl).list(accessToken, {
          limit: 30,
          signal: controller.signal,
          view: effectiveView,
        });
        if (controller.signal.aborted) return;
        applyNotificationsResult(result, effectivePreferences);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setLoading(false);
      }
    },
    [accessToken, gatewayUrl, seenIdsRef, applyNotificationsResult],
  );

  /** 切换视图前必须掐断在途请求，否则它回来后会把旧视图数据写回当前视图。 */
  const abortPendingLoad = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const handleViewChange = useCallback(
    (next: NotificationView) => {
      if (next === viewRef.current) return;
      abortPendingLoad();
      setView(next);
      void loadNotifications({ view: next }).catch(() => undefined);
    },
    [abortPendingLoad, loadNotifications],
  );

  /**
   * 本地移除通知并同步递减红点。
   *
   * 红点计数来自服务端且独立于列表，若只移除列表项，红点会一直显示旧数字直到下一轮
   * 事件到达——用户已经处理完了，铃铛还亮着，这正是「通知处理不掉」的观感来源。
   * 注意不在 setState updater 内改另一个 state（严格模式下 updater 会被重复调用）。
   */
  const dropNotificationsLocally = useCallback(
    (ids: readonly string[]) => {
      if (ids.length === 0) return;
      const targetIds = new Set(ids);
      const actionableCount = notifications.filter(
        (item) => targetIds.has(item.id) && item.kind === 'actionable',
      ).length;
      setNotifications((prev) => prev.filter((item) => !targetIds.has(item.id)));
      if (actionableCount > 0) {
        setPendingActionableCount((count) => Math.max(0, count - actionableCount));
      }
    },
    [notifications],
  );

  // ── Actions ─────────────────────────────────────────────

  const handleOpenNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) return;
      if (notification.eventType === 'permission_asked') {
        dismissedPermissionNotificationIdsRef.current.add(notification.id);
      }
      dropNotificationsLocally([notification.id]);
      setOpen(false);
      try {
        await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      } catch {
        if (notification.eventType === 'permission_asked') {
          dismissedPermissionNotificationIdsRef.current.delete(notification.id);
          permissionDetailsFetchedRef.current.delete(notification.id);
        }
        void loadNotifications({ view: viewRef.current }).catch(() => undefined);
      }
      if (notification.sessionId) {
        preloadRoute('/chat');
        void navigate(`/chat/${notification.sessionId}`);
      }
    },
    [accessToken, gatewayUrl, dropNotificationsLocally, loadNotifications, navigate, preloadRoute],
  );

  const handleDismissNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) return;
      if (notification.eventType === 'permission_asked') {
        dismissedPermissionNotificationIdsRef.current.add(notification.id);
      }
      dropNotificationsLocally([notification.id]);
      try {
        await createNotificationsClient(gatewayUrl).markRead(accessToken, notification.id);
      } catch {
        if (notification.eventType === 'permission_asked') {
          dismissedPermissionNotificationIdsRef.current.delete(notification.id);
          permissionDetailsFetchedRef.current.delete(notification.id);
        }
        void loadNotifications({ view: viewRef.current }).catch(() => undefined);
      }
    },
    [accessToken, gatewayUrl, dropNotificationsLocally, loadNotifications],
  );

  /**
   * 忽略（归档）而非「标记已读」。标记已读会让条目凭空消失，用户不敢点；
   * 归档则把它移出待办但留在归档视图里可回溯——这是「处理不掉」的人工出口。
   */
  const handleArchiveNotification = useCallback(
    async (notification: NotificationRecord) => {
      if (!accessToken) return;
      const previous = notifications;
      const previousCount = pendingActionableCount;
      dropNotificationsLocally([notification.id]);
      try {
        await createNotificationsClient(gatewayUrl).archive(accessToken, notification.id);
        toast('已忽略，可在「已归档」中找回', 'info');
      } catch {
        setNotifications(previous);
        setPendingActionableCount(previousCount);
        toast('忽略失败，请稍后重试', 'error');
      }
    },
    [accessToken, gatewayUrl, dropNotificationsLocally, notifications, pendingActionableCount],
  );

  /** 忽略整个会话的通知：会话里的审批/提问常一次性攒好几条，逐条点太累。 */
  const handleArchiveSession = useCallback(
    async (sessionId: string) => {
      if (!accessToken) return;
      try {
        await createNotificationsClient(gatewayUrl).archiveMany(accessToken, { sessionId });
        void loadNotifications({ view: viewRef.current }).catch(() => undefined);
        toast('已忽略该会话的通知，可在「已归档」中找回', 'success');
      } catch {
        toast('忽略失败，请稍后重试', 'error');
      }
    },
    [accessToken, gatewayUrl, loadNotifications],
  );

  const handleMarkAllRead = useCallback(async () => {
    if (!accessToken) return;
    const previous = notifications;
    const previousCount = pendingActionableCount;
    setNotifications([]);
    setPendingActionableCount(0);
    try {
      await createNotificationsClient(gatewayUrl).markAllRead(accessToken);
    } catch {
      setNotifications(previous);
      setPendingActionableCount(previousCount);
      toast('标记全部已读失败，请稍后重试', 'error');
    }
  }, [accessToken, gatewayUrl, notifications, pendingActionableCount]);

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

  useEffect(() => {
    if (!accessToken) return;
    const permNotifications = notifications.filter(
      (n) =>
        n.eventType === 'permission_asked' &&
        n.sessionId &&
        !permissionDetailsFetchedRef.current.has(n.id) &&
        !dismissedPermissionNotificationIdsRef.current.has(n.id),
    );
    if (permNotifications.length === 0) return;
    permNotifications.forEach((n) => permissionDetailsFetchedRef.current.add(n.id));
    const permClient = createPermissionsClient(gatewayUrl);
    const notificationsClient = createNotificationsClient(gatewayUrl);
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
          const pendingOnly = pending.filter((request) => request.status === 'pending');
          const updates: Record<string, PendingPermissionRequest> = {};
          const staleIds: string[] = [];
          notifs.forEach((notification) => {
            const matched = matchPendingPermissionForNotification(notification, pendingOnly);
            if (matched) {
              updates[notification.id] = matched;
              return;
            }

            // 只在「确定已不存在」时自动 markRead：
            // - 该会话已无任何 pending；或
            // - 通知正文带 requestId，且该 id 不在 pending 列表中。
            // 模糊匹配失败但会话仍有其它 pending 时，保留通知（不展示审批按钮），
            // 避免误把仍有效的权限请求清掉。
            const parsed = parsePermissionNotificationBody(notification.body);
            const requestId = parsed?.requestId?.trim();
            const isDefinitelyGone =
              pendingOnly.length === 0 ||
              (typeof requestId === 'string' &&
                requestId.length > 0 &&
                !pendingOnly.some((request) => request.requestId === requestId));
            if (isDefinitelyGone) {
              staleIds.push(notification.id);
            }
          });
          if (Object.keys(updates).length > 0) {
            setPermissionDetails((prev) => ({ ...prev, ...updates }));
          }
          if (staleIds.length > 0) {
            staleIds.forEach((id) => dismissedPermissionNotificationIdsRef.current.add(id));
            dropNotificationsLocally(staleIds);
            staleIds.forEach((id) => {
              void notificationsClient.markRead(accessToken, id).catch(() => {
                // markRead 失败：允许后续轮询 / refresh 重新评估。
                dismissedPermissionNotificationIdsRef.current.delete(id);
                permissionDetailsFetchedRef.current.delete(id);
              });
            });
          }
        })
        .catch(() => {
          // 拉取 pending 失败时回滚 fetched 标记，避免永久跳过。
          notifs.forEach((notification) => {
            permissionDetailsFetchedRef.current.delete(notification.id);
          });
        });
    });
  }, [accessToken, dropNotificationsLocally, gatewayUrl, notifications]);

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
          const { selectedLevel } = resolveAlwaysScopeSelection(
            details.previewAction,
            details.scope,
            details.always,
            selectedScopes[notification.id] ?? 'base',
          );
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
      } catch (error) {
        if (isPermissionReplyAlreadyHandled(error)) {
          toast('该权限请求已被处理或已过期', 'info');
          void handleDismissNotification(notification);
        } else {
          toast('审批操作失败，请稍后重试', 'error');
        }
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

  /**
   * 待处理视图只展示 actionable 待办——服务端 `view=pending` 已按 kind 收窄，
   * 这里不重复过滤。任务完成 / 失败是结果播报，让它们占着铃铛只会稀释真正需要动手
   * 的条目；它们完整保留在「全部 / 已归档」里可回溯，且页面隐藏时照常弹浏览器系统
   * 通知（见 loadNotifications）——「不进铃铛」不等于「不告知」。
   */
  const visibleNotifications = notifications;

  /** 被折叠的结果播报数——空态时告诉用户它们去了哪，否则空态看起来像消息丢了。 */
  const hiddenInformationalCount = view === 'pending' ? browserBroadcasts.length : 0;

  // ── Realtime (WS) ─────────────────────────────────────────
  //
  // 首屏数据由握手的 `sync` 全量快照交付，之后每次落库事件触发一次列表拉取——
  // 空闲时零 HTTP 请求。事件只带「脏标记 + 权威红点数」，所以红点先即时生效，
  // 列表内容随后由这次一次性拉取校正（WS 不复刻通知结构，避免与 REST 字段漂移）。

  useEffect(() => {
    if (!accessToken) {
      setNotifications([]);
      setPendingActionableCount(0);
      setBrowserBroadcasts([]);
      setPreferences(DEFAULT_NOTIFICATION_PREFERENCES);
      dismissedPermissionNotificationIdsRef.current.clear();
      permissionDetailsFetchedRef.current.clear();
      return undefined;
    }

    // 偏好先落地再建连：快照会用它过滤浏览器系统通知，顺序反了会先用默认值放行一轮。
    const preferencesReady = loadPreferences();
    connectNotificationEvents(gatewayUrl, accessToken);

    const unsubscribe = subscribeNotificationEvents({
      onChange: (event) => {
        // 红点先跟手：事件里带的是服务端权威计数，不等这一次拉取回来。
        setPendingActionableCount(event.pendingActionableCount);
        void loadNotifications({ view: viewRef.current }).catch(() => undefined);
      },
      onSnapshot: (snapshot) => {
        // 快照只在 pending 视图有效；用户正在看归档/全部时别把它塞进当前视图。
        if (viewRef.current !== 'pending') return;
        void preferencesReady
          .then((preferences) => {
            applyNotificationsResult(snapshot, preferences);
          })
          .catch(() => undefined);
      },
    });

    return () => {
      unsubscribe();
      disconnectNotificationEvents();
    };
  }, [accessToken, gatewayUrl, applyNotificationsResult, loadNotifications, loadPreferences]);

  useEffect(() => {
    return subscribeNotificationPreferenceRefresh(() => {
      void loadPreferences().catch(() => undefined);
    });
  }, [loadPreferences]);

  useEffect(() => {
    return subscribeSessionListRefresh(() => {
      // Floating / inline replies mark notifications read server-side and
      // broadcast a session-list refresh. Clear the per-item fetch cache so we
      // re-list pending permissions and drop any already-resolved entries.
      permissionDetailsFetchedRef.current.clear();
      void loadNotifications({ view: viewRef.current }).catch(() => undefined);
    });
  }, [loadNotifications]);

  if (!accessToken) return null;

  // 红点 = 未处理的 actionable 待办数（不含结果播报），上限显示 9+。
  const unreadCount = pendingActionableCount;

  return (
    <div style={{ position: 'relative', width: '100%' }} ref={containerRef}>
      {/* ── Trigger button ─────────────────────────────── */}
      <button
        type="button"
        ref={triggerRef}
        onClick={() => {
          setOpen((previous) => !previous);
          void loadNotifications({ view: viewRef.current }).catch(() => undefined);
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
            notifications={visibleNotifications}
            hiddenInformationalCount={hiddenInformationalCount}
            permissionDetails={permissionDetails}
            sessionTitles={sessionTitles}
            replyingIds={replyingIds}
            selectedScopes={selectedScopes}
            loading={loading}
            position={panelPos}
            view={view}
            pendingActionableCount={pendingActionableCount}
            onViewChange={handleViewChange}
            onOpen={handleOpenNotification}
            onDismiss={handleDismissNotification}
            onArchive={handleArchiveNotification}
            onArchiveSession={handleArchiveSession}
            onMarkAllRead={() => void handleMarkAllRead()}
            onRefresh={() =>
              void loadNotifications({ view: viewRef.current }).catch(() => undefined)
            }
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
