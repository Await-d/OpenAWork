/**
 * 友好的错误信息映射系统
 * 将技术性错误转换为用户友好的描述
 */

export interface FriendlyError {
  title: string;
  message: string;
  suggestion?: string;
  canRetry: boolean;
}

/**
 * 错误模式匹配规则
 */
const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  handler: (match: RegExpMatchArray, original: string) => FriendlyError;
}> = [
  // MODEL_ERROR - 模型服务错误
  {
    pattern: /\[错误:\s*MODEL_ERROR\]\s*Failed after (\d+) attempts?\.\s*Last error:\s*(.+)/i,
    handler: (match) => ({
      title: '模型服务暂时不可用',
      message: `系统尝试了 ${match[1]} 次连接，但模型服务暂时无法响应`,
      suggestion: '这通常是暂时性问题，请稍后重试',
      canRetry: true,
    }),
  },

  // Service Unavailable
  {
    pattern: /Service Unavailable|503|服务不可用/i,
    handler: () => ({
      title: '服务暂时不可用',
      message: '后端服务正在维护或负载过高',
      suggestion: '请稍等片刻后重试',
      canRetry: true,
    }),
  },

  // Network timeout
  {
    pattern: /timeout|超时|ETIMEDOUT/i,
    handler: () => ({
      title: '请求超时',
      message: '连接时间过长，请求未能完成',
      suggestion: '请检查网络连接后重试',
      canRetry: true,
    }),
  },

  // Rate limit
  {
    pattern: /rate limit|too many requests|429/i,
    handler: () => ({
      title: '请求过于频繁',
      message: '您的操作过于频繁，已触发限流保护',
      suggestion: '请稍等片刻后再试',
      canRetry: true,
    }),
  },

  // Authentication error
  {
    pattern: /unauthorized|401|authentication failed|认证失败/i,
    handler: () => ({
      title: '身份验证失败',
      message: '登录状态已失效或权限不足',
      suggestion: '请重新登录后再试',
      canRetry: false,
    }),
  },

  // API Key error
  {
    pattern: /api[_\s-]?key|invalid.*key/i,
    handler: () => ({
      title: 'API 配置错误',
      message: 'API 密钥无效或已过期',
      suggestion: '请检查 API 配置',
      canRetry: false,
    }),
  },

  // Connection error
  {
    pattern: /connection.*refused|ECONNREFUSED|无法连接/i,
    handler: () => ({
      title: '无法连接到服务器',
      message: '网络连接失败或服务器未响应',
      suggestion: '请检查网络连接',
      canRetry: true,
    }),
  },

  // Internal server error
  {
    pattern: /internal.*server.*error|500/i,
    handler: () => ({
      title: '服务器内部错误',
      message: '服务器处理请求时发生了错误',
      suggestion: '我们会尽快修复，请稍后重试',
      canRetry: true,
    }),
  },

  // Bad request
  {
    pattern: /bad.*request|400|invalid.*request/i,
    handler: () => ({
      title: '请求格式错误',
      message: '发送的请求格式不正确',
      suggestion: '请检查输入内容后重试',
      canRetry: false,
    }),
  },

  // Context length exceeded
  {
    pattern: /context.*length|token.*limit|maximum.*context/i,
    handler: () => ({
      title: '对话内容过长',
      message: '当前对话已超出模型的最大处理长度',
      suggestion: '建议开始新对话或精简内容',
      canRetry: false,
    }),
  },

  // Network error
  {
    pattern: /network.*error|ERR_NETWORK|网络错误/i,
    handler: () => ({
      title: '网络错误',
      message: '网络连接出现问题',
      suggestion: '请检查网络连接后重试',
      canRetry: true,
    }),
  },

  // AbortError
  {
    pattern: /AbortError|请求已取消/i,
    handler: () => ({
      title: '请求已取消',
      message: '操作被主动取消',
      suggestion: '如需继续，请重新发起请求',
      canRetry: true,
    }),
  },
];

/**
 * 将技术性错误消息转换为用户友好的描述
 */
export function getFriendlyErrorMessage(errorMessage: string): FriendlyError {
  const normalized = errorMessage.trim();

  // 尝试匹配所有错误模式
  for (const { pattern, handler } of ERROR_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return handler(match, normalized);
    }
  }

  // 默认错误信息（当没有匹配到任何模式时）
  return {
    title: '请求失败',
    message: '处理您的请求时遇到了问题',
    suggestion: '请稍后重试，如问题持续请联系支持',
    canRetry: true,
  };
}

/**
 * 从错误对象中提取并转换为友好的错误信息
 */
export function extractFriendlyError(error: unknown): FriendlyError {
  if (error instanceof Error) {
    return getFriendlyErrorMessage(error.message);
  }

  if (typeof error === 'string') {
    return getFriendlyErrorMessage(error);
  }

  return {
    title: '未知错误',
    message: '发生了意外错误',
    suggestion: '请稍后重试',
    canRetry: true,
  };
}

/**
 * 格式化友好错误信息为显示文本
 */
export function formatFriendlyError(friendlyError: FriendlyError): string {
  const parts = [friendlyError.title];

  if (friendlyError.message) {
    parts.push(friendlyError.message);
  }

  if (friendlyError.suggestion) {
    parts.push(`💡 ${friendlyError.suggestion}`);
  }

  return parts.join('\n');
}
