import { describe, expect, it, vi } from 'vitest';
import { handlePendingInteractionEvent } from './handle-pending-interaction-event.js';

describe('handlePendingInteractionEvent', () => {
  it('permission_asked 且未自动接受时会标记 pausedForPermission', () => {
    const onPermissionAsked = vi.fn();
    const requestSessionListRefresh = vi.fn();

    const result = handlePendingInteractionEvent({
      event: {
        type: 'permission_asked',
        requestId: 'r1',
        toolName: 'bash',
        scope: '*',
        reason: 'need permission',
        riskLevel: 'medium',
      },
      gatewayUrl: 'https://gw.test',
      isAutoAcceptEnabled: () => false,
      onPermissionAsked,
      onPermissionAskedAutoReplyFallback: vi.fn(),
      onPermissionReplied: vi.fn(),
      onQuestionAsked: vi.fn(),
      onQuestionReplied: vi.fn(),
      pausedForPermission: false,
      pausedForQuestion: false,
      requestSessionListRefresh,
      replyPermissionRequest: vi.fn(),
      sessionId: 's1',
      token: 'tok',
    });

    expect(onPermissionAsked).toHaveBeenCalled();
    expect(requestSessionListRefresh).toHaveBeenCalled();
    expect(result.pausedForPermission).toBe(true);
  });

  it('question_replied 会调用 onQuestionReplied 并保留 paused 标记', () => {
    const onQuestionReplied = vi.fn();
    const refreshCurrentSession = vi.fn();

    const result = handlePendingInteractionEvent({
      event: { type: 'question_replied', requestId: 'q1', status: 'answered' },
      gatewayUrl: 'https://gw.test',
      isAutoAcceptEnabled: () => false,
      onPermissionAsked: vi.fn(),
      onPermissionAskedAutoReplyFallback: vi.fn(),
      onPermissionReplied: vi.fn(),
      onQuestionAsked: vi.fn(),
      onQuestionReplied,
      pausedForPermission: false,
      pausedForQuestion: true,
      refreshCurrentSession,
      requestSessionListRefresh: vi.fn(),
      replyPermissionRequest: vi.fn(),
      sessionId: 's1',
      token: 'tok',
    });

    expect(onQuestionReplied).toHaveBeenCalled();
    expect(refreshCurrentSession).toHaveBeenCalled();
    expect(result.pausedForQuestion).toBe(true);
  });
});
