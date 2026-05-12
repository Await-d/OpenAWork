import type { PendingPermissionRequest } from '@openAwork/web-client';
import { findFirstPendingPermission } from '@openAwork/web-client';

export interface SessionPendingPermissionState extends Pick<
  PendingPermissionRequest,
  'requestId' | 'toolName' | 'scope' | 'reason' | 'riskLevel' | 'previewAction' | 'always'
> {
  targetSessionId: string;
  /** Resolved session title — filled in asynchronously after the event arrives. */
  sessionTitle?: string;
}

export function toSessionPendingPermissionStateFromRequest(
  request: PendingPermissionRequest | null,
): SessionPendingPermissionState | null {
  if (!request) {
    return null;
  }

  return {
    previewAction: request.previewAction,
    reason: request.reason,
    requestId: request.requestId,
    riskLevel: request.riskLevel,
    scope: request.scope,
    targetSessionId: request.sessionId,
    toolName: request.toolName,
    ...(request.always && request.always.length > 0 ? { always: request.always } : {}),
  };
}

export function toSessionPendingPermissionState(
  pendingPermissions: PendingPermissionRequest[],
): SessionPendingPermissionState | null {
  return toSessionPendingPermissionStateFromRequest(findFirstPendingPermission(pendingPermissions));
}
