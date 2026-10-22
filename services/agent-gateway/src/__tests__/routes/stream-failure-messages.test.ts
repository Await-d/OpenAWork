/**
 * `resolveStreamFailureMessages` —— 流式失败结果的「摘要 + 技术详情」收敛。
 *
 * 回归背景：`stopReason === 'error'` 时 `errorSummary` 曾被硬编码成
 * 「模型服务内部错误，请稍后重试」，渠道落库与 IM 回复因此看不到任何上游原因。
 */

import { describe, expect, it } from 'vitest';
import {
  resolveStreamFailureMessages,
  STREAM_FAILURE_FALLBACK_SUMMARY,
} from '../../routes/stream-failure-messages.js';

describe('resolveStreamFailureMessages', () => {
  it('Given a 中文说明 When resolving Then the summary is single-line and keeps the cause', () => {
    const result = resolveStreamFailureMessages({
      statusCode: 502,
      upstreamError: {
        code: 'V2_TRANSIENT_5XX',
        message: 'Provider is overloaded',
        userMessage:
          '**原因**：上游模型服务异常（HTTP 503）。\n**上游返回**：upstream is temporarily unavailable\n**建议**：稍后重试。',
        technicalDetail:
          'Provider request failed with HTTP 503: upstream is temporarily unavailable',
      },
    });

    expect(result.summary).toContain('上游模型服务异常');
    expect(result.summary).toContain('upstream is temporarily unavailable');
    expect(result.summary).not.toContain('**');
    expect(result.summary).not.toContain('\n');
    expect(result.code).toBe('V2_TRANSIENT_5XX');
  });

  it('Given technical detail When resolving Then the detail carries code, status and raw error', () => {
    const result = resolveStreamFailureMessages({
      statusCode: 502,
      upstreamError: {
        code: 'V2_RATE_LIMIT',
        message: 'Rate Limited',
        technicalDetail: 'Provider request failed with HTTP 429: quota exceeded',
        retryAfterMs: 4_200,
      },
    });

    expect(result.detail).toContain('V2_RATE_LIMIT');
    expect(result.detail).toContain('HTTP 状态：502');
    expect(result.detail).toContain('quota exceeded');
    expect(result.detail).toContain('4200ms');
  });

  it('Given no upstream error When resolving Then it falls back to a status-bearing message', () => {
    const result = resolveStreamFailureMessages({ statusCode: 500 });

    expect(result.summary).toBe(`${STREAM_FAILURE_FALLBACK_SUMMARY}（HTTP 500）`);
    expect(result.detail).toContain('未收到上游错误详情');
    expect(result.code).toBeUndefined();
  });

  it('Given only technical detail When resolving Then the first line becomes the summary', () => {
    const result = resolveStreamFailureMessages({
      statusCode: 502,
      upstreamError: { technicalDetail: 'socket hang up\n    at capture' },
    });

    expect(result.summary).toBe('socket hang up');
  });

  it('Given an overlong technical detail When resolving Then the detail keeps the full text', () => {
    const longDetail = `Provider request failed with HTTP 500: ${'x'.repeat(900)}`;
    const result = resolveStreamFailureMessages({
      statusCode: 502,
      upstreamError: { code: 'V2_TRANSIENT_5XX', technicalDetail: longDetail },
    });

    // 摘要受 600 字上限约束，超出部分必须完整留在技术详情里，否则审计会丢证据。
    expect(result.summary.endsWith('…（已截断）')).toBe(true);
    expect(result.detail).toContain('x'.repeat(900));
  });

  it('Given an overlong summary When resolving Then it is truncated', () => {
    const result = resolveStreamFailureMessages({
      statusCode: 502,
      upstreamError: { message: 'x'.repeat(1_000) },
    });

    expect(result.summary.length).toBeLessThan(650);
    expect(result.summary.endsWith('…（已截断）')).toBe(true);
  });
});
