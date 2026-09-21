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

// Single source of truth for "this tool output means waiting for approval".
// Duplicated marker lists drifted between the batch card and the copied-tool
// card before; both now import from here.
export const PENDING_PERMISSION_OUTPUT_MARKERS = [
  'waiting for approval',
  'requires approval',
  'permission request',
  'waiting for answer',
  'waiting for confirmation',
  '等待权限',
  '等待审批',
  '等待回答',
  '等待确认',
] as const;

export function looksLikePendingPermissionOutput(output: unknown): boolean {
  const serialized =
    typeof output === 'string'
      ? output
      : (() => {
          if (output === undefined || output === null) return '';
          try {
            return JSON.stringify(output) ?? '';
          } catch {
            return String(output);
          }
        })();
  const normalized = serialized.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return PENDING_PERMISSION_OUTPUT_MARKERS.some((marker) => normalized.includes(marker));
}
