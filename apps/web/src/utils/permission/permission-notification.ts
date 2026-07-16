import type { NotificationRecord, PendingPermissionRequest } from '@openAwork/web-client';

export interface ParsedPermissionNotificationBody {
  requestId?: string;
  reason: string;
  previewAction: string;
  scope: string;
  riskLevel: string;
}

export function parsePermissionNotificationBody(
  body: string,
): ParsedPermissionNotificationBody | null {
  const lines = body.split('\n');
  const firstLine = lines[0] ?? '';
  const hasRequestIdPrefix = firstLine.startsWith('requestId=');
  const offset = hasRequestIdPrefix ? 1 : 0;
  if (lines.length < offset + 2) return null;
  return {
    ...(hasRequestIdPrefix ? { requestId: firstLine.slice('requestId='.length) } : {}),
    reason: lines[offset] ?? '',
    previewAction: lines[offset + 1] ?? '',
    scope: lines[offset + 2] ?? '',
    riskLevel: lines[offset + 3] ?? '',
  };
}

export function extractPermissionToolName(notificationTitle: string): string | null {
  const titleMatch = notificationTitle.match(/·\s*(.+)$/);
  const toolName = titleMatch?.[1]?.trim();
  return toolName && toolName.length > 0 ? toolName : null;
}

export function matchPendingPermissionForNotification(
  notification: NotificationRecord,
  pendingRequests: readonly PendingPermissionRequest[],
): PendingPermissionRequest | undefined {
  if (notification.eventType !== 'permission_asked') {
    return undefined;
  }

  const pendingOnly = pendingRequests.filter((request) => request.status === 'pending');
  if (pendingOnly.length === 0) {
    return undefined;
  }

  const parsedBody = parsePermissionNotificationBody(notification.body);
  if (parsedBody?.requestId) {
    return pendingOnly.find((request) => request.requestId === parsedBody.requestId);
  }

  const toolName = extractPermissionToolName(notification.title);
  const exactMatches = pendingOnly.filter((request) => {
    if (toolName && request.toolName !== toolName) {
      return false;
    }
    if (!parsedBody) {
      return true;
    }

    return (
      request.reason === parsedBody.reason &&
      (request.previewAction ?? '') === parsedBody.previewAction &&
      request.scope === parsedBody.scope &&
      request.riskLevel === parsedBody.riskLevel
    );
  });

  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  if (toolName) {
    const sameToolMatches = pendingOnly.filter((request) => request.toolName === toolName);
    if (sameToolMatches.length === 1) {
      return sameToolMatches[0];
    }
  }

  return pendingOnly.length === 1 ? pendingOnly[0] : undefined;
}
