import type { SharedSessionCommentRecord, SharedSessionDetailRecord } from '@openAwork/web-client';

export function appendSharedSessionCommentPreview(
  detail: SharedSessionDetailRecord | null,
  input: {
    comment: SharedSessionCommentRecord;
    sessionId: string;
  },
): SharedSessionDetailRecord | null {
  if (!detail || detail.share.sessionId !== input.sessionId) {
    return detail;
  }

  const merged = [
    ...detail.comments.filter((comment) => comment.id !== input.comment.id),
    input.comment,
  ].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );

  return {
    ...detail,
    comments: merged,
  };
}

export function applySharedSessionPermissionReplyPreview(
  detail: SharedSessionDetailRecord | null,
  input: {
    requestId: string;
    sessionId: string;
  },
): SharedSessionDetailRecord | null {
  if (!detail || detail.share.sessionId !== input.sessionId) {
    return detail;
  }

  return {
    ...detail,
    pendingPermissions: detail.pendingPermissions.filter(
      (request) => request.requestId !== input.requestId,
    ),
  };
}

export function applySharedSessionQuestionReplyPreview(
  detail: SharedSessionDetailRecord | null,
  input: {
    requestId: string;
    sessionId: string;
  },
): SharedSessionDetailRecord | null {
  if (!detail || detail.share.sessionId !== input.sessionId) {
    return detail;
  }

  return {
    ...detail,
    pendingQuestions: detail.pendingQuestions.filter(
      (request) => request.requestId !== input.requestId,
    ),
  };
}
