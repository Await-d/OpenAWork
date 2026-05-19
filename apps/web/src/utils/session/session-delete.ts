import { HttpError } from '@openAwork/web-client';

interface DeleteSessionErrorData {
  blockReason?: 'pendingInteraction' | 'runtimeThread' | 'state' | 'stream';
  error?: string;
  sessionId?: string;
  state_status?: string;
}

export function isSessionAlreadyDeletedError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

function readDeleteSessionErrorData(error: unknown): DeleteSessionErrorData | undefined {
  return error instanceof HttpError
    ? ((error as HttpError & { data?: DeleteSessionErrorData }).data ?? undefined)
    : undefined;
}

export function getSessionDeleteErrorMessage(error: unknown): string {
  const data = readDeleteSessionErrorData(error);

  if (error instanceof HttpError && error.status === 409) {
    switch (data?.blockReason) {
      case 'pendingInteraction':
        return '请先处理相关会话中的待确认问题或权限请求，再删除会话';
      case 'runtimeThread':
        return '请等待相关子代理运行结束后再删除会话';
      case 'stream':
        return '系统正在停止相关会话的运行，请稍后再试';
      case 'state':
        return '请等待相关会话回到空闲状态后再删除';
      default:
        return data?.error ?? '当前会话暂时无法删除';
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return '删除失败，请重试';
}
