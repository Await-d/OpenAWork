export type AgentErrorCategory =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'model'
  | 'tool'
  | 'permission'
  | 'context_overflow'
  | 'unknown';

export type ErrorActionType = 'retry' | 'switch_model' | 'check_settings' | 'contact_support';

export type ErrorAction =
  | { type: 'retry' }
  | { type: 'switch_model' }
  | { type: 'check_settings'; tab: string }
  | { type: 'contact_support' };

export interface AgentError {
  category: AgentErrorCategory;
  message: string;
  technicalDetail?: string;
  retryable: boolean;
  retryAfterMs?: number;
  action?: ErrorAction;
}

const CATEGORY_MESSAGES: Record<AgentErrorCategory, string> = {
  network: '网络连接中断，请检查网络后重试',
  auth: 'API Key 无效，请在设置中重新配置',
  rate_limit: '请求过于频繁，请稍后重试',
  model: '模型服务暂时不可用，请稍后重试',
  tool: '工具执行失败',
  permission: '操作被权限规则拒绝',
  context_overflow: '对话过长，已自动压缩历史消息',
  unknown: '发生未知错误',
};

const CATEGORY_RETRYABLE: Record<AgentErrorCategory, boolean> = {
  network: true,
  auth: false,
  rate_limit: true,
  model: true,
  tool: true,
  permission: false,
  context_overflow: false,
  unknown: true,
};

const CATEGORY_ACTIONS: Record<AgentErrorCategory, ErrorAction | undefined> = {
  network: { type: 'retry' },
  auth: { type: 'check_settings', tab: 'provider' },
  rate_limit: { type: 'retry' },
  model: { type: 'switch_model' },
  tool: { type: 'retry' },
  permission: undefined,
  context_overflow: undefined,
  unknown: { type: 'contact_support' },
};

export function createAgentError(
  category: AgentErrorCategory,
  technicalDetail?: string,
  options?: { retryAfterMs?: number; message?: string },
): AgentError {
  return {
    category,
    message: options?.message ?? CATEGORY_MESSAGES[category],
    technicalDetail,
    retryable: CATEGORY_RETRYABLE[category],
    retryAfterMs: options?.retryAfterMs,
    action: CATEGORY_ACTIONS[category],
  };
}

export function classifyHttpError(status: number, body?: unknown): AgentError {
  const detail = typeof body === 'string' ? body : JSON.stringify(body ?? '');

  if (status === 401 || status === 403) return createAgentError('auth', detail);
  if (status === 429) {
    const retryAfter =
      typeof body === 'object' && body !== null && 'retry_after' in body
        ? Number((body as Record<string, unknown>).retry_after) * 1000
        : 60_000;
    return createAgentError('rate_limit', detail, { retryAfterMs: retryAfter });
  }
  if (status >= 500) return createAgentError('model', detail);
  if (status === 400 && detail.includes('context'))
    return createAgentError('context_overflow', detail);
  return createAgentError('unknown', detail);
}

export function classifyNetworkError(err: unknown): AgentError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/timeout|ETIMEDOUT/.test(msg)) {
    return createAgentError('network', msg, {
      message: 'Request timed out, please check your connection',
    });
  }
  if (/ECONNREFUSED|ENOTFOUND|failed to fetch/i.test(msg)) {
    return createAgentError('network', msg);
  }
  return createAgentError('network', msg);
}

export function formatRetryMessage(error: AgentError): string {
  if (!error.retryAfterMs) return error.message;
  const seconds = Math.ceil(error.retryAfterMs / 1000);
  return `${error.message}（${seconds} 秒后重试）`;
}
