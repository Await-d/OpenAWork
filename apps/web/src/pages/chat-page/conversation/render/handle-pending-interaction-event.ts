import type {
  StreamPermissionAskedChunk,
  StreamPermissionRepliedChunk,
  StreamQuestionAskedChunk,
  StreamQuestionRepliedChunk,
} from '@openAwork/shared';

export type PendingInteractionEventLike =
  | StreamPermissionAskedChunk
  | StreamPermissionRepliedChunk
  | StreamQuestionAskedChunk
  | StreamQuestionRepliedChunk;

export interface HandlePendingInteractionEventOptions {
  event: PendingInteractionEventLike;
  gatewayUrl: string;
  isAutoAcceptEnabled: (sessionId: string) => boolean;
  onPermissionAsked: (event: StreamPermissionAskedChunk) => void;
  onPermissionAskedAutoReplyFallback: (event: StreamPermissionAskedChunk) => void;
  onPermissionReplied: (event: StreamPermissionRepliedChunk) => void;
  onQuestionAsked: (event: StreamQuestionAskedChunk) => void;
  onQuestionReplied: (event: StreamQuestionRepliedChunk) => void;
  pausedForPermission: boolean;
  pausedForQuestion: boolean;
  refreshCurrentSession?: () => void;
  requestSessionListRefresh: () => void;
  replyPermissionRequest: (input: {
    decision: 'once';
    gatewayUrl: string;
    requestId: string;
    sessionId: string;
    token: string;
  }) => Promise<unknown>;
  sessionId: string;
  token: string | null;
}

export interface HandlePendingInteractionEventResult {
  handled: boolean;
  pausedForPermission: boolean;
  pausedForQuestion: boolean;
}

export function handlePendingInteractionEvent(
  options: HandlePendingInteractionEventOptions,
): HandlePendingInteractionEventResult {
  const {
    event,
    gatewayUrl,
    isAutoAcceptEnabled,
    onPermissionAsked,
    onPermissionAskedAutoReplyFallback,
    onPermissionReplied,
    onQuestionAsked,
    onQuestionReplied,
    pausedForPermission,
    pausedForQuestion,
    refreshCurrentSession,
    requestSessionListRefresh,
    replyPermissionRequest,
    sessionId,
    token,
  } = options;

  if (event.type === 'permission_asked') {
    if (token && isAutoAcceptEnabled(sessionId)) {
      void replyPermissionRequest({
        decision: 'once',
        gatewayUrl,
        requestId: event.requestId,
        sessionId,
        token,
      }).catch(() => {
        onPermissionAskedAutoReplyFallback(event);
      });

      return { handled: true, pausedForPermission, pausedForQuestion };
    }

    onPermissionAsked(event);
    requestSessionListRefresh();
    return { handled: true, pausedForPermission: true, pausedForQuestion };
  }

  if (event.type === 'permission_replied') {
    onPermissionReplied(event);
    refreshCurrentSession?.();
    return { handled: true, pausedForPermission, pausedForQuestion };
  }

  if (event.type === 'question_asked') {
    onQuestionAsked(event);
    refreshCurrentSession?.();
    requestSessionListRefresh();
    return { handled: true, pausedForPermission, pausedForQuestion: true };
  }

  if (event.type === 'question_replied') {
    onQuestionReplied(event);
    refreshCurrentSession?.();
    return { handled: true, pausedForPermission, pausedForQuestion };
  }

  return { handled: false, pausedForPermission, pausedForQuestion };
}
