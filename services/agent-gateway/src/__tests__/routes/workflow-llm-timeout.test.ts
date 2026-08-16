/**
 * Robustness: `requestWorkflowLlmCompletion` must enforce a wall-clock
 * deadline on the non-streaming upstream call.
 *
 * The native upstream generator only honours an `abortSignal`; it has no
 * built-in timeout. Every team-runtime LLM hop (reception router /
 * intent rewrite, pm1 artifact chain, pm2 constitution + architecture
 * review, d.4 quality review) routes through this helper. Without an
 * internal deadline a hung upstream socket leaves those awaits pending
 * forever — and because pm2 quality review dedups in-flight work via an
 * in-memory `Set`, a single stuck call wedges that handoff permanently.
 *
 * These tests assert the helper:
 *   1. passes a real `AbortSignal` down to `runUpstreamGenerate`,
 *   2. aborts and throws a stable `workflow LLM timeout` error when the
 *      upstream never settles before the deadline,
 *   3. lets callers opt out (`timeoutMs: 0`) for their own wrapping, and
 *   4. surfaces caller-abort distinctly from a timeout.
 */

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runUpstreamGenerate: vi.fn(),
}));

vi.mock('../../v2-runtime/upstream/index.js', async (orig) => {
  type UpstreamModule = typeof UpstreamActual;
  const actual = await (orig() as Promise<UpstreamModule>);
  return {
    ...actual,
    runUpstreamGenerate: mocks.runUpstreamGenerate,
  };
});

import { requestWorkflowLlmCompletion } from '../../routes/workflow-llm.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

const BASE_INPUT = {
  apiBaseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  prompt: 'hi',
  temperature: 0.1,
} as const;

describe('requestWorkflowLlmCompletion — wall-clock timeout', () => {
  beforeEach(() => {
    mocks.runUpstreamGenerate.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('forwards an AbortSignal to runUpstreamGenerate', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );

    await requestWorkflowLlmCompletion({ ...BASE_INPUT });

    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    const callArg = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as { signal?: AbortSignal };
    expect(callArg.signal).toBeInstanceOf(AbortSignal);
    expect(callArg.signal?.aborted).toBe(false);
  });

  it('forwards the configured OpenAI Fast mode to the native upstream caller', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );

    await requestWorkflowLlmCompletion({ ...BASE_INPUT, openaiFastMode: true });

    const callArg = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as {
      openaiFastMode?: boolean;
    };
    expect(callArg.openaiFastMode).toBe(true);
  });

  it('aborts and throws a stable timeout error when upstream hangs', async () => {
    vi.useFakeTimers();

    let abortedReason: unknown;
    mocks.runUpstreamGenerate.mockImplementation((arg: { signal?: AbortSignal }) =>
      Effect.callback<never, Error>((resume) => {
        const abort = () => {
          abortedReason = arg.signal?.reason;
          resume(Effect.fail(new Error('aborted by signal')));
        };
        arg.signal?.addEventListener('abort', abort, { once: true });
        return Effect.sync(() => arg.signal?.removeEventListener('abort', abort));
      }),
    );

    const promise = requestWorkflowLlmCompletion({ ...BASE_INPUT, timeoutMs: 1_000 });
    // Surface the rejection without an unhandled-rejection warning.
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBeInstanceOf(Error);
      expect((result.err as Error).message).toContain('workflow LLM timeout');
      expect((result.err as Error).message).toContain('1000');
    }
    expect(abortedReason).toBeDefined();
  });

  it('does not arm a deadline when timeoutMs is 0 (caller opt-out)', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'ok',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );

    await requestWorkflowLlmCompletion({ ...BASE_INPUT, timeoutMs: 0 });

    const callArg = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as { signal?: AbortSignal };
    // With no caller signal and no internal deadline, the forwarded signal
    // must never fire on its own.
    expect(callArg.signal?.aborted).toBe(false);
  });

  it('propagates a non-timeout upstream error unchanged', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(Effect.fail(new Error('upstream 500')));

    await expect(requestWorkflowLlmCompletion({ ...BASE_INPUT })).rejects.toThrow('upstream 500');
  });

  it('honours a caller-supplied abort signal distinctly from timeout', async () => {
    const controller = new AbortController();
    mocks.runUpstreamGenerate.mockImplementation((arg: { signal?: AbortSignal }) =>
      Effect.callback<never, Error>((resume) => {
        const abort = () => resume(Effect.fail(new Error('caller aborted')));
        arg.signal?.addEventListener('abort', abort, { once: true });
        return Effect.sync(() => arg.signal?.removeEventListener('abort', abort));
      }),
    );

    const promise = requestWorkflowLlmCompletion({
      ...BASE_INPUT,
      timeoutMs: 60_000,
      signal: controller.signal,
    });
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );
    controller.abort();

    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Caller abort is not a timeout, so the stable timeout message must
      // not be substituted.
      expect((result.err as Error).message).not.toContain('workflow LLM timeout');
    }
  });
});
