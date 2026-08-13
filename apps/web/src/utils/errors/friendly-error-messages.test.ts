import { describe, it, expect } from 'vitest';
import {
  getFriendlyErrorMessage,
  extractFriendlyError,
  formatFriendlyError,
} from './friendly-error-messages';

describe('friendly-error-messages', () => {
  it('应该转换 MODEL_ERROR 为友好消息', () => {
    const input =
      '[错误: MODEL_ERROR] Failed after 4 attempts. Last error: AI_APICallError: Service Unavailable';
    const result = getFriendlyErrorMessage(input);

    expect(result.title).toBe('模型服务暂时不可用');
    expect(result.message).toContain('4 次连接');
    expect(result.canRetry).toBe(true);
    expect(result.suggestion).toBeTruthy();
  });

  it('应该转换 Service Unavailable 错误', () => {
    const result = getFriendlyErrorMessage('Service Unavailable');

    expect(result.title).toBe('服务暂时不可用');
    expect(result.canRetry).toBe(true);
  });

  it('应该转换超时错误', () => {
    const result = getFriendlyErrorMessage('Request timeout');

    expect(result.title).toBe('请求超时');
    expect(result.suggestion).toContain('网络');
    expect(result.canRetry).toBe(true);
  });

  it('应该转换限流错误', () => {
    const result = getFriendlyErrorMessage('rate limit exceeded');

    expect(result.title).toBe('请求过于频繁');
    expect(result.canRetry).toBe(true);
  });

  it('应该转换认证错误且不显示重试', () => {
    const result = getFriendlyErrorMessage('unauthorized');

    expect(result.title).toBe('身份验证失败');
    expect(result.canRetry).toBe(false);
  });

  it('应该转换上下文长度错误', () => {
    const result = getFriendlyErrorMessage('context length exceeded');

    expect(result.title).toBe('对话内容过长');
    expect(result.canRetry).toBe(false);
  });

  it('应该处理未知错误', () => {
    const result = getFriendlyErrorMessage('something went wrong');

    expect(result.title).toBe('请求失败');
    expect(result.canRetry).toBe(true);
  });

  it('应该从 Error 对象提取错误', () => {
    const error = new Error('Service Unavailable');
    const result = extractFriendlyError(error);

    expect(result.title).toBe('服务暂时不可用');
  });

  it('应该格式化友好错误为文本', () => {
    const friendlyError = {
      title: '测试错误',
      message: '这是错误信息',
      suggestion: '这是建议',
      canRetry: true,
    };

    const formatted = formatFriendlyError(friendlyError);

    expect(formatted).toContain('测试错误');
    expect(formatted).toContain('这是错误信息');
    expect(formatted).toContain('💡 这是建议');
  });
});
