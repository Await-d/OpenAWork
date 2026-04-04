import { describe, expect, it } from 'vitest';
import {
  isUpstreamContextOverflowError,
  readUpstreamError,
  readUpstreamErrorDetail,
} from '../routes/upstream-error.js';

describe('readUpstreamErrorDetail', () => {
  it('extracts OpenAI-style nested error messages', async () => {
    const response = new Response(
      JSON.stringify({ error: { message: 'The model `gpt-5.1-nano` does not exist' } }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    await expect(readUpstreamErrorDetail(response)).resolves.toBe(
      'Upstream request failed (404): The model `gpt-5.1-nano` does not exist',
    );
  });

  it('falls back to plain-text response bodies', async () => {
    const response = new Response('invalid_api_key', { status: 401 });

    await expect(readUpstreamErrorDetail(response)).resolves.toBe(
      'Upstream request failed (401): invalid_api_key',
    );
  });

  it('classifies daily limit exhaustion as quota exceeded with a user-facing message', async () => {
    const response = new Response(
      'error: code=429 reason="DAILY_LIMIT_EXCEEDED" message="daily usage limit exceeded" metadata=map[]',
      { status: 429 },
    );

    await expect(readUpstreamError(response)).resolves.toEqual({
      code: 'QUOTA_EXCEEDED',
      message: '当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
      technicalDetail:
        'Upstream request failed (429): error: code=429 reason="DAILY_LIMIT_EXCEEDED" message="daily usage limit exceeded" metadata=map[]',
    });
  });

  it('classifies generic 429 responses as rate limit errors', async () => {
    const response = new Response(JSON.stringify({ error: { message: 'rate limit reached' } }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });

    await expect(readUpstreamError(response)).resolves.toEqual({
      code: 'RATE_LIMIT',
      message: '模型服务触发速率限制，请稍后重试',
      technicalDetail: 'Upstream request failed (429): rate limit reached',
    });
  });

  it('classifies OpenAI current quota responses as quota exceeded', async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 'insufficient_quota',
          type: 'insufficient_quota',
          message: 'You exceeded your current quota, please check your plan and billing details.',
        },
      }),
      {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    await expect(readUpstreamError(response)).resolves.toEqual({
      code: 'QUOTA_EXCEEDED',
      message: '当前模型提供方额度已用尽，请切换模型或提供方，或等待额度恢复后再试',
      technicalDetail:
        'Upstream request failed (429): You exceeded your current quota, please check your plan and billing details.',
    });
  });

  it('detects context overflow errors from provider messages', () => {
    expect(
      isUpstreamContextOverflowError({
        response: { status: 400 },
        error: {
          code: 'MODEL_ERROR',
          message: 'maximum context length exceeded',
          technicalDetail: 'Upstream request failed (400): maximum context length exceeded',
        },
      }),
    ).toBe(true);

    expect(
      isUpstreamContextOverflowError({
        response: { status: 400 },
        error: {
          code: 'MODEL_ERROR',
          message: 'invalid api key',
          technicalDetail: 'Upstream request failed (400): invalid api key',
        },
      }),
    ).toBe(false);
  });
});
