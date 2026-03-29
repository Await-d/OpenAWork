import { describe, expect, it, vi } from 'vitest';
import {
  fetchUpstreamStreamWithRetry,
  isRetryableUpstreamStatus,
} from '../routes/upstream-stream-retry.js';

const FAST_RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 0,
  maxDelayMs: 0,
  backoffMultiplier: 1,
  jitterFactor: 0,
} as const;

describe('isRetryableUpstreamStatus', () => {
  it('marks transient upstream failures as retryable', () => {
    expect(isRetryableUpstreamStatus(500)).toBe(true);
    expect(isRetryableUpstreamStatus(502)).toBe(true);
    expect(isRetryableUpstreamStatus(503)).toBe(true);
    expect(isRetryableUpstreamStatus(504)).toBe(true);
    expect(isRetryableUpstreamStatus(429)).toBe(false);
    expect(isRetryableUpstreamStatus(404)).toBe(false);
  });
});

describe('fetchUpstreamStreamWithRetry', () => {
  it('retries retryable upstream statuses before succeeding', async () => {
    const firstResponse = new Response('gateway error', { status: 502 });
    const secondResponse = new Response('temporary unavailable', { status: 503 });
    const firstCancel = vi.spyOn(firstResponse.body!, 'cancel');
    const secondCancel = vi.spyOn(secondResponse.body!, 'cancel');
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse)
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const response = await fetchUpstreamStreamWithRetry({
      url: 'https://example.com/chat/completions',
      init: { method: 'POST', body: '{}' },
      signal: new AbortController().signal,
      fetchImpl,
      retryOptions: FAST_RETRY_OPTIONS,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(secondCancel).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('ok');
  });

  it('returns the final retryable response after retries are exhausted', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response('bad gateway', { status: 502 });
    });

    const response = await fetchUpstreamStreamWithRetry({
      url: 'https://example.com/chat/completions',
      init: { method: 'POST', body: '{}' },
      signal: new AbortController().signal,
      fetchImpl,
      retryOptions: FAST_RETRY_OPTIONS,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(502);
    await expect(response.text()).resolves.toBe('bad gateway');
  });

  it('rethrows the last network error after retries are exhausted', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(
      fetchUpstreamStreamWithRetry({
        url: 'https://example.com/chat/completions',
        init: { method: 'POST', body: '{}' },
        signal: new AbortController().signal,
        fetchImpl,
        retryOptions: FAST_RETRY_OPTIONS,
      }),
    ).rejects.toThrow('fetch failed');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable upstream statuses', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('missing', { status: 404 }));

    const response = await fetchUpstreamStreamWithRetry({
      url: 'https://example.com/chat/completions',
      init: { method: 'POST', body: '{}' },
      signal: new AbortController().signal,
      fetchImpl,
      retryOptions: FAST_RETRY_OPTIONS,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });
});
