/**
 * 流处理工具函数
 */

import { Effect } from 'effect';
import { LLMError, InvalidProviderOutputReason } from '../schema/index.js';

/**
 * 创建流错误
 */
export const streamError = (message: string, raw?: string): LLMError =>
  new LLMError({
    module: 'Stream',
    method: 'process',
    reason: new InvalidProviderOutputReason({ route: 'stream', message, raw }),
  });

/**
 * 安全解析 JSON，返回 Effect
 */
export const safeParseJson = (text: string): Effect.Effect<unknown, LLMError> =>
  Effect.try({
    try: () => JSON.parse(text),
    catch: (error) =>
      streamError(
        `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        text,
      ),
  });

/**
 * 检查字符串是否为有效的 JSON
 */
export const isValidJson = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/**
 * 延迟执行
 */
export const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 指数退避计算
 */
export const calculateBackoff = (
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter = true,
): number => {
  const exponential = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
  if (!jitter) return exponential;
  // 添加 ±25% 的随机抖动
  const jitterAmount = exponential * 0.25;
  return exponential + (Math.random() * 2 - 1) * jitterAmount;
};

/**
 * 检查错误是否可重试
 */
export const isRetryableError = (error: unknown): boolean => {
  const retryableMessage = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('network') ||
      normalized.includes('timeout') ||
      normalized.includes('econnreset') ||
      normalized.includes('econnrefused') ||
      normalized.includes('socket hang up') ||
      normalized.includes('503') ||
      normalized.includes('504') ||
      normalized.includes('429')
    );
  };

  if (error instanceof LLMError) {
    // 检查是否是网络错误或临时错误
    return retryableMessage(error.message ?? '');
  }

  if (error instanceof Error) {
    return retryableMessage(error.message);
  }

  return false;
};

/**
 * 格式化字节大小
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
};

/**
 * 创建超时 Promise
 */
export const timeout = <T>(
  promise: Promise<T>,
  ms: number,
  message = 'Operation timed out',
): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(streamError(`${message} after ${ms}ms`)), ms),
    ),
  ]);
};

export * as StreamUtils from './utils.js';
