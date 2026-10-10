/**
 * Self-contained floating permission prompt.
 *
 * All permission-related state (pendingPermission, reply status, error) lives
 * inside this component so that state changes here do NOT trigger a re-render
 * of the parent Layout (which contains the entire app route tree). This is the
 * primary fix for the page-wide lag that occurred when the permission popup
 * appeared — previously, `setPendingPermission` in Layout caused the 6000-line
 * ChatPage and all other children to re-render.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { PermissionPrompt } from '@openAwork/shared-ui';
import type { AlwaysScopeLevel, PermissionDecision } from '@openAwork/shared-ui';
import { createPermissionsClient, createSessionsClient } from '@openAwork/web-client';
import type { NotificationRecord } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  connectNotificationEvents,
  disconnectNotificationEvents,
  requestNotificationEventsSnapshot,
  subscribeNotificationEvents,
} from '../../../stores/notification-events.js';
import {
  getSessionPendingInteractionSnapshot,
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeSessionPendingPermission,
} from '../../../utils/session/session-list-events.js';
import type { SessionPendingPermissionState } from '../../../utils/permission/pending-permission-state.js';
import { toSessionPendingPermissionStateFromRequest } from '../../../utils/permission/pending-permission-state.js';
import { matchPendingPermissionForNotification } from '../../../utils/permission/permission-notification.js';
import {
  replyPermissionRequest,
  resolvePermissionReplyError,
} from '../../../utils/permission/permission-reply.js';
import { resolvePermissionAlwaysOverride } from '../../../utils/permission/permission-scope.js';
import { toast } from '../../common/feedback/ToastNotification.js';

/**
 * Callback to notify the parent Layout about pending permission state
 * changes — used only for the NavRail indicator dot, which is a trivial
 * boolean and does not warrant a full re-render of the Layout tree.
 */
export interface FloatingPermissionPromptProps {
  onPendingChange?: (hasPending: boolean) => void;
}

interface FloatingPermissionSessionTarget {
  route: string;
  sessionTitle?: string;
}

function resolveSessionNavigationTarget(input: {
  metadataJson?: string;
  roleLayer?: string | null;
  sessionId: string;
  title?: string;
}): FloatingPermissionSessionTarget {
  if (typeof input.roleLayer === 'string' && input.roleLayer.trim().length > 0) {
    try {
      const parsed = input.metadataJson
        ? (JSON.parse(input.metadataJson) as Record<string, unknown>)
        : null;
      const teamWorkspaceId =
        typeof parsed?.['teamWorkspaceId'] === 'string' ? parsed['teamWorkspaceId'] : null;
      if (teamWorkspaceId && teamWorkspaceId.trim().length > 0) {
        return {
          route: `/team/${teamWorkspaceId}?sessionId=${encodeURIComponent(input.sessionId)}`,
          ...(input.title?.trim() ? { sessionTitle: input.title.trim() } : {}),
        };
      }
    } catch {
      // ignore malformed metadata and fall through to chat route
    }
  }

  return {
    route: `/chat/${input.sessionId}`,
    ...(input.title?.trim() ? { sessionTitle: input.title.trim() } : {}),
  };
}

/**
 * 快照里是否真的存在「等待权限」待办。
 *
 * 用于把「切换会话的 null 广播」变成零成本操作:缓存里没有任何待审批项时,切换会话
 * 只是「无事发生」,连一次 WS 快照往返都可以省掉——这正是「不再每次切会话就发请求」的落点。
 */
function hasPendingPermissionNotification(notifications: readonly NotificationRecord[]): boolean {
  return notifications.some(
    (notification) =>
      notification.eventType === 'permission_asked' && Boolean(notification.sessionId),
  );
}

export function FloatingPermissionPrompt({ onPendingChange }: FloatingPermissionPromptProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const gatewayUrl = useAuthStore((s) => s.gatewayUrl);
  const navigate = useNavigate();
  const location = useLocation();
  const currentChatSessionId = location.pathname.split('/chat/')[1]?.split('/')[0] ?? null;

  const [pendingPermission, setPendingPermission] = useState<SessionPendingPermissionState | null>(
    null,
  );
  const [replyPendingDecision, setReplyPendingDecision] = useState<PermissionDecision | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [sessionTarget, setSessionTarget] = useState<FloatingPermissionSessionTarget | null>(null);

  const pendingPermissionRef = useRef<SessionPendingPermissionState | null>(null);
  /**
   * 最近一次 WS 快照里的通知列表(握手 / 重连 / 脏事件后主动索要都会刷新它)。
   *
   * 待审批恢复一律读这里,不再走 `GET /notifications?view=pending`——于是切换会话这条
   * 高频路径在「无事发生」时零网络往返,有变化时也走 WS 而非 HTTP。
   */
  const snapshotNotificationsRef = useRef<readonly NotificationRecord[]>([]);

  const updatePendingPermission = useCallback(
    (next: SessionPendingPermissionState | null) => {
      const current = pendingPermissionRef.current;

      if (next !== null && current?.requestId === next.requestId) {
        if (current.sessionTitle && !next.sessionTitle) return;
        const currentAlways = current.always ?? [];
        const nextAlways = next.always ?? [];
        if (
          current.scope === next.scope &&
          current.toolName === next.toolName &&
          current.reason === next.reason &&
          current.riskLevel === next.riskLevel &&
          current.previewAction === next.previewAction &&
          currentAlways.length === nextAlways.length &&
          currentAlways.every((v, i) => v === nextAlways[i])
        ) {
          return;
        }
      }

      pendingPermissionRef.current = next;
      setPendingPermission(next);
      setSessionTarget(null);

      if (next === null || current?.requestId !== next.requestId) {
        setReplyPendingDecision(null);
        setReplyError(null);
      }

      // Async session title resolution
      if (next && !next.sessionTitle && accessToken) {
        createSessionsClient(gatewayUrl)
          .get(accessToken, next.targetSessionId)
          .then((session) => {
            const navigationTarget = resolveSessionNavigationTarget({
              sessionId: next.targetSessionId,
              title: session?.title,
              roleLayer: session?.role_layer,
              metadataJson: session?.metadata_json,
            });
            setSessionTarget((currentTarget) => {
              if (pendingPermissionRef.current?.requestId !== next.requestId) {
                return currentTarget;
              }
              return navigationTarget;
            });
            if (!navigationTarget.sessionTitle) {
              return;
            }
            setPendingPermission((current) => {
              if (current?.requestId !== next.requestId) return current;
              const updated = { ...current, sessionTitle: navigationTarget.sessionTitle };
              pendingPermissionRef.current = updated;
              return updated;
            });
          })
          .catch(() => {});
      }
    },
    [accessToken, gatewayUrl],
  );

  // Notify parent about pending state changes (for indicator dot)
  const prevHasPendingRef = useRef(false);
  useEffect(() => {
    const hasPending = pendingPermission !== null;
    if (hasPending !== prevHasPendingRef.current) {
      prevHasPendingRef.current = hasPending;
      onPendingChange?.(hasPending);
    }
  }, [pendingPermission, onPendingChange]);

  // Subscribe to permission events
  useEffect(() => {
    if (!accessToken) {
      // 登出即清空 WS 快照缓存,避免换账号后拿上一个账号的旧列表做「是否需要索要快照」的判断。
      snapshotNotificationsRef.current = [];
      updatePendingPermission(null);
      return;
    }

    const snapshotPendingPermission = Array.from(
      getSessionPendingInteractionSnapshot().pendingPermissionBySession.values(),
    )[0];
    if (snapshotPendingPermission) {
      updatePendingPermission(snapshotPendingPermission);
    }

    let cancelled = false;
    const permissionsClient = createPermissionsClient(gatewayUrl);
    /**
     * 在途的 `hydrateFromUnreadNotifications` Promise,用于并发去重。
     *
     * 一次审批动作会同时点燃两条触发路径(`subscribeSessionPendingPermission` 的 null
     * 广播 + WS `onChange` 的落库事件),两者并发进入时守卫都还没生效;复用同一个在途
     * Promise 可把并发的 `listPending` 压成一次。
     */
    let hydrationInFlight: Promise<void> | null = null;

    /**
     * 从 WS 快照的通知列表里恢复待审批项。
     *
     * 数据只来自 WS:`seed` 是本次快照,缺省则读 `snapshotNotificationsRef` 中的最近快照,
     * 因此「刚连上就能弹出待审批」与「切换会话后恢复」都不需要额外一次 HTTP。
     */
    const hydrateFromUnreadNotifications = async (
      seed?: readonly NotificationRecord[],
    ): Promise<void> => {
      if (pendingPermissionRef.current !== null) {
        return;
      }
      // 已有一次 hydrate 在途:复用它,避免并发重复发起 listPending。
      if (hydrationInFlight) {
        return hydrationInFlight;
      }

      const run = async (): Promise<void> => {
        const notifications = seed ?? snapshotNotificationsRef.current;
        if (cancelled || pendingPermissionRef.current !== null) {
          return;
        }

        for (const notification of notifications) {
          if (notification.eventType !== 'permission_asked' || !notification.sessionId) {
            continue;
          }

          const pendingRequests = await permissionsClient.listPending(
            accessToken,
            notification.sessionId,
          );
          if (cancelled || pendingPermissionRef.current !== null) {
            return;
          }

          const matched = matchPendingPermissionForNotification(notification, pendingRequests);
          if (!matched) {
            continue;
          }

          updatePendingPermission(toSessionPendingPermissionStateFromRequest(matched));
          return;
        }
      };

      hydrationInFlight = run().finally(() => {
        hydrationInFlight = null;
      });
      return hydrationInFlight;
    };

    connectNotificationEvents(gatewayUrl, accessToken);

    const unsubscribePendingPermission = subscribeSessionPendingPermission(
      (_sessionId, permission) => {
        updatePendingPermission(permission);
        if (
          permission === null &&
          hasPendingPermissionNotification(snapshotNotificationsRef.current)
        ) {
          // 切换会话 / 待办清空时广播 null。只有当 WS 快照里确实还存在待审批项时才需要行动,
          // 否则这是一次「无事发生」的切换,连一次 WS 往返都不必发。有则向 WS 再要一份最新
          // 快照——绝不读可能已过期的本地缓存,也绝不发 HTTP,避免把刚处理完的审批又弹回来。
          requestNotificationEventsSnapshot();
        }
      },
    );

    // 通知数据只走 WS:落库事件只带「脏标记 + 权威红点数」,列表内容由快照交付。
    const unsubscribeEvents = subscribeNotificationEvents({
      onChange: () => {
        requestNotificationEventsSnapshot();
      },
      // 握手 / 每次重连 / 每次主动索要后的全量快照——落缓存并直接复用,无需任何 HTTP。
      onSnapshot: (snapshot) => {
        snapshotNotificationsRef.current = snapshot.notifications;
        void hydrateFromUnreadNotifications(snapshot.notifications).catch(() => undefined);
      },
    });

    return () => {
      cancelled = true;
      unsubscribeEvents();
      unsubscribePendingPermission();
      disconnectNotificationEvents();
    };
  }, [accessToken, gatewayUrl, updatePendingPermission]);

  const handleDecision = useCallback(
    async (requestId: string, decision: PermissionDecision, scopeLevel?: AlwaysScopeLevel) => {
      const permission = pendingPermissionRef.current;
      if (!accessToken || !permission) {
        updatePendingPermission(null);
        return;
      }

      const targetSessionId = permission.targetSessionId;
      const alwaysOverride = resolvePermissionAlwaysOverride(permission);
      setReplyPendingDecision(decision);
      setReplyError(null);

      try {
        await replyPermissionRequest({
          ...(decision !== 'once' && decision !== 'reject'
            ? { alwaysOverride: scopeLevel ? [scopeLevel.pattern] : alwaysOverride }
            : {}),
          decision,
          requestId,
          gatewayUrl,
          sessionId: targetSessionId,
          token: accessToken,
        });
        updatePendingPermission(null);
        // Refresh sessions
        if (currentChatSessionId) {
          requestCurrentSessionRefresh(currentChatSessionId);
        }
        requestCurrentSessionRefresh(targetSessionId);
        requestSessionListRefresh();
        window.setTimeout(() => {
          if (currentChatSessionId) {
            requestCurrentSessionRefresh(currentChatSessionId);
          }
          requestCurrentSessionRefresh(targetSessionId);
          requestSessionListRefresh();
        }, 2000);
      } catch (error) {
        const resolved = resolvePermissionReplyError(error);
        if (resolved.dismissPrompt) {
          updatePendingPermission(null);
          toast(resolved.toastMessage ?? resolved.inlineMessage, 'warning', 4200);
          if (currentChatSessionId) {
            requestCurrentSessionRefresh(currentChatSessionId);
          }
          requestCurrentSessionRefresh(targetSessionId);
          requestSessionListRefresh();
        } else {
          setReplyError(resolved.inlineMessage);
        }
      } finally {
        setReplyPendingDecision(null);
      }
    },
    [accessToken, currentChatSessionId, gatewayUrl, updatePendingPermission],
  );

  if (!pendingPermission) return null;

  return (
    <PermissionPrompt
      key={pendingPermission.requestId}
      requestId={pendingPermission.requestId}
      toolName={pendingPermission.toolName}
      scope={pendingPermission.scope}
      reason={pendingPermission.reason}
      riskLevel={pendingPermission.riskLevel}
      previewAction={pendingPermission.previewAction}
      always={pendingPermission.always}
      pendingDecision={replyPendingDecision}
      errorMessage={replyError ?? undefined}
      onDecide={(
        requestId: string,
        decision: PermissionDecision,
        scopeLevel?: AlwaysScopeLevel,
      ) => {
        void handleDecision(requestId, decision, scopeLevel);
      }}
      sessionTitle={pendingPermission.sessionTitle}
      onNavigateToSession={
        sessionTarget?.route
          ? () => {
              navigate(sessionTarget.route);
            }
          : undefined
      }
      style={{
        position: 'fixed',
        top: 56,
        right: 16,
        width: 440,
        zIndex: 500,
        animation: 'permissionSlideIn 0.25s ease forwards',
      }}
    />
  );
}
