import { createPermissionsClient } from '@openAwork/web-client';
import type { PermissionDecision } from '@openAwork/web-client';
import { requestSessionStreamResumeAttach } from '../session/session-stream-resume-events.js';

export async function replyPermissionRequest(input: {
  alwaysOverride?: string[];
  decision: PermissionDecision;
  feedback?: string;
  gatewayUrl: string;
  requestId: string;
  sessionId: string;
  token: string;
}): Promise<void> {
  await createPermissionsClient(input.gatewayUrl).reply(input.token, input.sessionId, {
    requestId: input.requestId,
    decision: input.decision,
    ...(input.alwaysOverride ? { alwaysOverride: input.alwaysOverride } : {}),
    ...(input.decision === 'reject' && input.feedback ? { feedback: input.feedback } : {}),
  });
  if (input.decision !== 'reject') {
    requestSessionStreamResumeAttach(input.sessionId);
  }
}

export function getPermissionReplySuccessMessage(decision: PermissionDecision): string {
  if (decision === 'once') {
    return '已提交：本次允许';
  }
  if (decision === 'session') {
    return '已提交：本会话允许';
  }
  if (decision === 'permanent') {
    return '已提交：永久允许';
  }
  return '已提交：已拒绝';
}

export function getPermissionReplyStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const status = Reflect.get(error, 'status');
  return typeof status === 'number' ? status : null;
}

/**
 * 404 / 409 表示服务端上该权限请求已不存在或已处理完毕。
 * 前端应视为幂等成功：关闭弹层 / 从通知列表移除，而不是保留可重复提交的 UI。
 */
export function isPermissionReplyAlreadyHandled(error: unknown): boolean {
  const status = getPermissionReplyStatusCode(error);
  return status === 404 || status === 409;
}

export function getPermissionReplyErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '权限处理失败，请重试。';
}

export function resolvePermissionReplyError(error: unknown): {
  dismissPrompt: boolean;
  inlineMessage: string;
  toastMessage?: string;
} {
  if (isPermissionReplyAlreadyHandled(error)) {
    const status = getPermissionReplyStatusCode(error);
    if (status === 404) {
      return {
        dismissPrompt: true,
        inlineMessage: '权限请求已不存在，正在重新同步。',
        toastMessage: '权限请求已不存在，已重新同步状态。',
      };
    }
    return {
      dismissPrompt: true,
      inlineMessage: '该权限请求已被处理，正在重新同步。',
      toastMessage: '权限请求已被处理，已重新同步状态。',
    };
  }

  return {
    dismissPrompt: false,
    inlineMessage: getPermissionReplyErrorMessage(error),
  };
}
