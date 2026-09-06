import { describe, expect, it } from 'vitest';
import { LLMError, InvalidProviderOutputReason } from '../../schema/index.js';
import { httpStreamError } from '../transport/stream-error.js';

describe('HTTP 流读取错误', () => {
  it('保留嵌套连接错误码，归类为传输失败且不自动重放', () => {
    const error = httpStreamError('zhipu/openai-compatible-chat', {
      reason: { cause: { code: 'ECONNRESET', message: 'secret-header' } },
    });
    expect(error.reason._tag).toBe('Transport');
    expect(error.message).toContain('ECONNRESET');
    expect(error.message).not.toContain('secret-header');
    expect(error.retryable).toBe(false);
  });

  it.each(['AbortError', 'TimeoutError'])('标明取消或超时：%s', (name) => {
    expect(httpStreamError('route', { cause: { name } }).message).toContain(name);
  });

  it('已有协议错误保持原类型和内容', () => {
    const error = new LLMError({
      module: 'test',
      method: 'stream',
      reason: new InvalidProviderOutputReason({ message: 'invalid event' }),
    });
    expect(httpStreamError('route', error)).toBe(error);
  });

  it('循环原因有界，未知错误不泄露凭据', () => {
    const error: { cause?: unknown; message: string } = {
      message: 'https://secret/?token=private',
    };
    error.cause = error;
    const result = httpStreamError('route', error);
    expect(result.reason._tag).toBe('Transport');
    expect(result.message).not.toContain('private');
    expect(result.message).toContain('HTTP 响应流读取失败');
  });
});
