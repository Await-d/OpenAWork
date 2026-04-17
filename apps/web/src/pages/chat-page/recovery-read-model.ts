import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import { normalizeChatMessages, type ChatMessage } from './support.js';
import { filterTranscriptMessages } from './transcript-visibility.js';

interface RecoverySessionRecord {
  messages?: unknown;
  pendingPermissions?: unknown;
  pendingQuestions?: unknown;
}

interface RecoveryMessageSource {
  session?: RecoverySessionRecord | null;
}

interface RecoveryPendingInteractionSource {
  pendingPermissions?: unknown;
  pendingQuestions?: unknown;
  session?: RecoverySessionRecord | null;
}

function isPendingPermissionRequest(value: unknown): value is PendingPermissionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record['requestId'] === 'string' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['toolName'] === 'string' &&
    typeof record['scope'] === 'string' &&
    typeof record['reason'] === 'string' &&
    (record['riskLevel'] === 'low' ||
      record['riskLevel'] === 'medium' ||
      record['riskLevel'] === 'high') &&
    typeof record['status'] === 'string' &&
    typeof record['createdAt'] === 'string'
  );
}

function isPendingQuestionRequest(value: unknown): value is PendingQuestionRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record['requestId'] === 'string' &&
    typeof record['sessionId'] === 'string' &&
    typeof record['toolName'] === 'string' &&
    typeof record['title'] === 'string' &&
    Array.isArray(record['questions']) &&
    typeof record['status'] === 'string' &&
    typeof record['createdAt'] === 'string'
  );
}

function toPendingPermissionRequests(value: unknown): PendingPermissionRequest[] {
  return Array.isArray(value) ? value.filter((item) => isPendingPermissionRequest(item)) : [];
}

function toPendingQuestionRequests(value: unknown): PendingQuestionRequest[] {
  return Array.isArray(value) ? value.filter((item) => isPendingQuestionRequest(item)) : [];
}

function dedupePendingPermissionRequests(
  requests: PendingPermissionRequest[],
): PendingPermissionRequest[] {
  const mergedByRequestId = new Map<string, PendingPermissionRequest>();
  const order: string[] = [];

  for (const request of requests) {
    const existing = mergedByRequestId.get(request.requestId);
    if (!existing) {
      order.push(request.requestId);
      mergedByRequestId.set(request.requestId, request);
      continue;
    }

    mergedByRequestId.set(request.requestId, { ...existing, ...request });
  }

  return order
    .map((requestId) => mergedByRequestId.get(requestId))
    .filter((request): request is PendingPermissionRequest => request !== undefined);
}

function getRecoverySessionRecord(
  source: RecoveryMessageSource | RecoveryPendingInteractionSource,
) {
  return source.session && typeof source.session === 'object' ? source.session : null;
}

export function getRecoveryTranscriptMessages(source: RecoveryMessageSource): ChatMessage[] {
  const session = getRecoverySessionRecord(source);
  const rawMessages = session && Array.isArray(session.messages) ? session.messages : [];
  return filterTranscriptMessages(normalizeChatMessages(rawMessages));
}

export function getRecoveryPendingInteractions(source: RecoveryPendingInteractionSource): {
  pendingPermission: PendingPermissionRequest | null;
  pendingPermissions: PendingPermissionRequest[];
  pendingQuestion: PendingQuestionRequest | null;
  pendingQuestions: PendingQuestionRequest[];
} {
  const session = getRecoverySessionRecord(source);
  const pendingPermissions = toPendingPermissionRequests(source.pendingPermissions);
  const pendingQuestions = toPendingQuestionRequests(source.pendingQuestions);
  const fallbackPendingPermissions = toPendingPermissionRequests(session?.pendingPermissions);
  const fallbackPendingQuestions = toPendingQuestionRequests(session?.pendingQuestions);

  const resolvedPendingPermissions =
    pendingPermissions.length > 0 ? pendingPermissions : fallbackPendingPermissions;
  const resolvedPendingQuestions =
    pendingQuestions.length > 0 ? pendingQuestions : fallbackPendingQuestions;
  const dedupedPendingPermissions = dedupePendingPermissionRequests(resolvedPendingPermissions);

  return {
    pendingPermissions: dedupedPendingPermissions,
    pendingPermission:
      dedupedPendingPermissions.find((request) => request.status === 'pending') ?? null,
    pendingQuestions: resolvedPendingQuestions,
    pendingQuestion:
      resolvedPendingQuestions.find((request) => request.status === 'pending') ?? null,
  };
}
