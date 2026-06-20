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
import { createSessionsClient } from '@openAwork/web-client';
import { useAuthStore } from '../../stores/auth/auth.js';
import {
  requestCurrentSessionRefresh,
  requestSessionListRefresh,
  subscribeSessionPendingPermission,
} from '../../utils/session/session-list-events.js';
import type { SessionPendingPermissionState } from '../../utils/permission/pending-permission-state.js';
import { replyPermissionRequest } from '../../utils/permission/permission-reply.js';
import { resolvePermissionAlwaysOverride } from '../../utils/permission/permission-scope.js';
import { toast } from '../common/feedback/ToastNotification.js';

function resolvePermissionReplyError(error: unknown): {
  dismissPrompt: boolean;
  inlineMessage: string;
  toastMessage?: string;
} {
  const httpError =
    typeof error === 'object' && error !== null && typeof Reflect.get(error, 'status') === 'number'
      ? {
          status: Reflect.get(error, 'status') as number,
          data: Reflect.get(error, 'data') as { error?: string } | undefined,
        }
      : null;

  if (httpError) {
    if (httpError.status === 409 && httpError.data?.error === 'Permission request expired') {
      return {
        dismissPrompt: true,
        inlineMessage: '该权限请求已过期，正在重新同步。',
        toastMessage: '权限请求已过期，已重新同步状态。',
      };
    }
    if (
      httpError.status === 409 &&
      httpError.data?.error === 'Permission request already resolved'
    ) {
      return {
        dismissPrompt: true,
        inlineMessage: '该权限请求已被处理，正在重新同步。',
        toastMessage: '权限请求已被处理，已重新同步状态。',
      };
    }
    if (httpError.status === 404) {
      return {
        dismissPrompt: true,
        inlineMessage: '权限请求已不存在，正在重新同步。',
        toastMessage: '权限请求已不存在，已重新同步状态。',
      };
    }
  }

  return {
    dismissPrompt: false,
    inlineMessage: error instanceof Error ? error.message : '权限处理失败，请重试。',
  };
}

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
      const parsed = input.metadataJson ? (JSON.parse(input.metadataJson) as Record<string, unknown>) : null;
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
        if (
          current.scope === next.scope &&
          current.toolName === next.toolName &&
          current.reason === next.reason &&
          current.riskLevel === next.riskLevel &&
          current.previewAction === next.previewAction
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
    return subscribeSessionPendingPermission((_sessionId, permission) => {
      updatePendingPermission(permission);
    });
  }, [accessToken, updatePendingPermission]);

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
