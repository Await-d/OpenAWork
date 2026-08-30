import { Duration, Effect, Schedule, Stream } from 'effect';
import * as OpenCodeLLM from '@openAwork/opencode-llm';
import { classifyUpstreamError } from '../../provider/retry-classify.js';

export const DEFAULT_UPSTREAM_STREAM_MAX_RETRIES = 3;
export const MAX_UPSTREAM_STREAM_MAX_RETRIES = 3;
export const UPSTREAM_STREAM_RETRY_INITIAL_DELAY_MS = 2_000;

export function normalizeUpstreamStreamMaxRetries(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_UPSTREAM_STREAM_MAX_RETRIES;
  }
  return Math.min(MAX_UPSTREAM_STREAM_MAX_RETRIES, Math.max(0, Math.floor(value)));
}

export function isRetryableUpstreamStreamError(error: unknown): boolean {
  if (error instanceof OpenCodeLLM.LLMError) {
    return error.retryable || error.reason._tag === 'Transport';
  }
  return classifyUpstreamError(error).retryable;
}

export function withUpstreamStreamRetry<A, E, R>(
  source: Stream.Stream<A, E, R>,
  maxRetries: number,
): Stream.Stream<A, E, R> {
  if (maxRetries <= 0) return source;

  const hasOutput = { value: false };

  const retrySchedule = Schedule.exponential(
    Duration.millis(UPSTREAM_STREAM_RETRY_INITIAL_DELAY_MS),
  ).pipe(
    Schedule.both(Schedule.recurs(maxRetries)),
    Schedule.while(({ input }) => !hasOutput.value && isRetryableUpstreamStreamError(input)),
  );

  return source.pipe(
    Stream.tap(() =>
      Effect.sync(() => {
        hasOutput.value = true;
      }),
    ),
    Stream.retry(retrySchedule),
  );
}
