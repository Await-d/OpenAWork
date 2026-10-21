import {
  dedupePendingPermissionRequests,
  findFirstPendingPermission,
  normalizePendingQuestionRequest,
  toPendingPermissionRequests,
} from '@openAwork/web-client';
import type { PendingPermissionRequest, PendingQuestionRequest } from '@openAwork/web-client';
import { normalizeChatMessages, type ChatMessage } from '../messages/support.js';
import { filterTranscriptMessages } from '../messages/transcript-visibility.js';

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

function toPendingQuestionRequests(value: unknown): PendingQuestionRequest[] {
  if (!Array.isArray(value)) {
    return [];
  }
  // 必须走 `normalizePendingQuestionRequest`：recovery 快照里的问题列表同样是网关
  // 原始 JSON 透传，多选标记的字段名是 `multiSelect` 而前端模型读 `multiple`。
  // 只做类型校验（旧实现）会把它丢掉，于是「刷新页面 / 切会话回来后多选又变回单选」。
  return value
    .map((item) => (isPendingQuestionRequest(item) ? normalizePendingQuestionRequest(item) : null))
    .filter((item): item is PendingQuestionRequest => item !== null);
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
    pendingPermission: findFirstPendingPermission(dedupedPendingPermissions),
    pendingQuestions: resolvedPendingQuestions,
    pendingQuestion:
      resolvedPendingQuestions.find((request) => request.status === 'pending') ?? null,
  };
}
