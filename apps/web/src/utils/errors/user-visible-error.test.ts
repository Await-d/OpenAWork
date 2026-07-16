import { describe, expect, it } from 'vitest';
import { HttpError } from '@openAwork/web-client';
import {
  getUserVisibleErrorDescriptor,
  isAbortLikeError,
  isSafeUserVisibleErrorMessage,
} from './user-visible-error.js';

describe('user-visible-error', () => {
  it('识别安全的用户可见错误消息', () => {
    expect(isSafeUserVisibleErrorMessage('读取快捷提示词失败。')).toBe(true);
    expect(isSafeUserVisibleErrorMessage('AI_APICallError: 401 https://secret.example.com')).toBe(
      false,
    );
  });

  it('从 HttpError 中提取 retryable 与 code', () => {
    const error = new HttpError('上游模型暂时不可用，请稍后重试。', 502, {
      code: 'upstream_unavailable',
      retryable: true,
    });

    expect(getUserVisibleErrorDescriptor(error, '优化提示词失败，请稍后重试。')).toMatchObject({
      code: 'upstream_unavailable',
      message: '上游模型暂时不可用，请稍后重试。',
      retryable: true,
    });
  });

  it('对可疑错误消息回退到稳定文案', () => {
    const error = new Error('select * from users where token="secret"');

    expect(getUserVisibleErrorDescriptor(error, '创建提示词失败，请稍后重试。')).toMatchObject({
      message: '创建提示词失败，请稍后重试。',
      retryable: false,
    });
  });

  it('识别 AbortError', () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    expect(isAbortLikeError(error)).toBe(true);
  });
});
