import { describe, expect, it } from 'vitest';
import {
  classifyUpstreamError,
  computeRetryDelayMs,
  FREE_USAGE_UPSELL_MESSAGE,
  RETRY_INITIAL_DELAY_MS,
  RETRY_MAX_DELAY_NO_HEADERS_MS,
} from '../retry-classify.js';

describe('classifyUpstreamError', () => {
  it('flags 5xx as transient and retryable even when SDK says not', () => {
    const result = classifyUpstreamError({
      message: 'gateway timeout',
      data: { statusCode: 504, isRetryable: false },
    });
    expect(result.category).toBe('transient_5xx');
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(RETRY_INITIAL_DELAY_MS);
  });

  it('detects free-usage exhaustion via response body sniff', () => {
    const result = classifyUpstreamError({
      message: 'limit reached',
      data: { statusCode: 402, responseBody: '{"error":"FreeUsageLimitError"}' },
    });
    expect(result.category).toBe('free_usage_exhausted');
    expect(result.retryable).toBe(false);
    expect(result.message).toBe(FREE_USAGE_UPSELL_MESSAGE);
  });

  it('classifies "Overloaded" messages as overloaded retryable', () => {
    const result = classifyUpstreamError({ message: 'Provider Overloaded — try again' });
    expect(result.category).toBe('overloaded');
    expect(result.retryable).toBe(true);
  });

  it('classifies 429 status / rate-limit phrasing as rate_limit', () => {
    expect(classifyUpstreamError({ message: 'Rate limit exceeded' }).category).toBe('rate_limit');
    expect(classifyUpstreamError({ data: { statusCode: 429 } }).category).toBe('rate_limit');
  });

  it('parses Anthropic-style structured rate-limit envelopes', () => {
    const json = JSON.stringify({
      type: 'error',
      error: { type: 'too_many_requests' },
    });
    const result = classifyUpstreamError({ message: json });
    expect(result.category).toBe('rate_limit');
    expect(result.message).toBe('Too Many Requests');
  });

  it('falls back to unknown for opaque errors', () => {
    const result = classifyUpstreamError({ message: 'something blew up' });
    expect(result.category).toBe('unknown');
    expect(result.retryable).toBe(false);
  });
});

describe('computeRetryDelayMs', () => {
  it('honours retry-after-ms header when present', () => {
    expect(computeRetryDelayMs(1, { 'retry-after-ms': '4321' })).toBe(4321);
  });

  it('parses retry-after as seconds', () => {
    expect(computeRetryDelayMs(1, { 'retry-after': '7' })).toBe(7_000);
  });

  it('caps the no-header backoff to RETRY_MAX_DELAY_NO_HEADERS_MS', () => {
    expect(computeRetryDelayMs(20)).toBeLessThanOrEqual(RETRY_MAX_DELAY_NO_HEADERS_MS);
  });
});
