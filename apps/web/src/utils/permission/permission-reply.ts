import { createPermissionsClient } from '@openAwork/web-client';
import type { PermissionDecision } from '@openAwork/web-client';

export async function replyPermissionRequest(input: {
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
    ...(input.decision === 'reject' && input.feedback ? { feedback: input.feedback } : {}),
  });
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
