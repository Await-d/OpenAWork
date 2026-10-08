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
import {
  createNotificationsClient,
  createPermissionsClient,
  createSessionsClient,
} from '@openAwork/web-client';
import type { NotificationRecord } from '@openAwork/web-client';
import { useAuthStore } from '../../../stores/auth/auth.js';
import {
  connectNotificationEvents,
  disconnectNotificationEvents,
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
    const notificationsClient = createNotificationsClient(gatewayUrl);
    const permissionsClient = createPermissionsClient(gatewayUrl);
    /**
     * 在途的 `hydrateFromUnreadNotifications` Promise，用于并发去重。
     *
     * 此前只有「发起前检查 `pendingPermissionRef.current !== null`」这一道守卫，
     * 而常态下没有待审批项 → 该守卫恒不命中，于是每个触发源都会发一次完整的
     * `GET /notifications?view=pending&limit=20`。而一次审批动作会同时点燃两条
     * 触发路径（`subscribeSessionPendingPermission` 的 null 广播 + WS `onChange`
     * 的落库事件），两者并发进入时守卫都还没生效 → 并发两次相同请求。
     *
     * 复用同一个在途 Promise 后，并发触发被合并为一次网络往返。
     */
    let hydrationInFlight: Promise<void> | null = null;

    /**
     * 从未读通知里恢复待审批项。
     *
     * `seed` 允许直接吃 WS 握手快照里的通知列表——那份数据与服务端 `list(view=pending)`
     * 同源同口径，于是「刚连上就能弹出待审批」不需要额外一次 HTTP。
     */
    const hydrateFromUnreadNotifications = async (
      seed?: readonly NotificationRecord[],
    ): Promise<void> => {
      if (pendingPermissionRef.current !== null) {
        return;
      }
      // 已有一次 hydrate 在途：复用它，不再发第二次相同请求。
      if (hydrationInFlight) {
        return hydrationInFlight;
      }

      const run = async (): Promise<void> => {
        const notifications =
          seed ??
          (
            await notificationsClient.list(accessToken, {
              limit: 20,
              view: 'pending',
            })
          ).notifications;
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
        if (permission === null) {
          void hydrateFromUnreadNotifications().catch(() => undefined);
        }
      },
    );

    // 落库事件：只带脏标记与红点数，因此这里补一次列表拉取即可。
    const unsubscribeEvents = subscribeNotificationEvents({
      onChange: () => {
        void hydrateFromUnreadNotifications().catch(() => undefined);
      },
      // 握手 / 每次重连后的全量快照——直接复用，省掉一次 HTTP。
      onSnapshot: (snapshot) => {
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
