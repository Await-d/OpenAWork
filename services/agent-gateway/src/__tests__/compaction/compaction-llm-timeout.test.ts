/**
 * Robustness: `callCompactionLlm` must enforce a wall-clock deadline on
 * its upstream summary call.
 *
 * Compaction fires automatically on context pressure (often mid-turn).
 * The upstream backstop starts after plugin preprocessing and depends on
 * interruption cooperation. Compaction therefore owns a total deadline
 * spanning preprocessing and PTL retry, with independent promise settlement.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import type { ModelRouteConfig } from '../../provider/model-router.js';
import type { UnifiedMessage } from '../../message/message-to-model-messages.js';

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

import { callCompactionLlm } from '../../compaction/compaction-llm.js';
import type * as UpstreamActual from '../../v2-runtime/upstream/index.js';

function createRoute(overrides?: Partial<ModelRouteConfig>): ModelRouteConfig {
  return {
    model: overrides?.model ?? 'gpt-4o-mini',
    apiBaseUrl: overrides?.apiBaseUrl ?? 'https://api.openai.com/v1',
    apiKey: overrides?.apiKey ?? 'sk-test',
    maxTokens: overrides?.maxTokens ?? 1024,
    temperature: overrides?.temperature ?? 0,
    upstreamProtocol: overrides?.upstreamProtocol ?? 'chat_completions',
    requestOverrides: overrides?.requestOverrides ?? {},
    supportsThinking: overrides?.supportsThinking ?? false,
    providerType: overrides?.providerType ?? 'openai',
  };
}

const CONVERSATION: UnifiedMessage[] = [{ role: 'user', content: 'hello there' }];

describe('callCompactionLlm — wall-clock timeout', () => {
  beforeEach(() => {
    mocks.runUpstreamGenerate.mockReset();
    vi.stubEnv('OPENAWORK_COMPACTION_TIMEOUT_MS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function observe(input: Parameters<typeof callCompactionLlm>[0]) {
    const state: { result?: Awaited<ReturnType<typeof callCompactionLlm>>; error?: unknown } = {};
    const done = callCompactionLlm(input).then(
      (result) => {
        state.result = result;
      },
      (error: unknown) => {
        state.error = error;
      },
    );
    return { state, done };
  }

  it.each(['resolve', 'reject'] as const)(
    'settles despite ignored abort and safely handles late %s',
    async (late) => {
      vi.useFakeTimers();
      let resolve!: (value: { text: string; inputTokens: number; outputTokens: number }) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<{ text: string; inputTokens: number; outputTokens: number }>(
        (yes, no) => {
          resolve = yes;
          reject = no;
        },
      );
      mocks.runUpstreamGenerate.mockReturnValue(
        Effect.promise(() => pending).pipe(Effect.uninterruptible),
      );
      const { state, done } = observe({ conversationMessages: CONVERSATION, route: createRoute() });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(state.error).toMatchObject({
        message: expect.stringContaining('compaction LLM timeout'),
      });
      expect(mocks.runUpstreamGenerate.mock.calls[0]?.[0].signal.aborted).toBe(true);
      expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
      if (late === 'resolve') resolve({ text: 'late', inputTokens: 1, outputTokens: 1 });
      else reject(new Error('late rejection'));
      await vi.advanceTimersByTimeAsync(0);
      await done;
      expect(state.result).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('does not start upstream when already cancelled, even with a PTL-shaped reason', async () => {
    const controller = new AbortController();
    controller.abort(new Error('prompt is too long'));
    mocks.runUpstreamGenerate.mockReturnValue(Effect.succeed({ text: 'ignored' }));
    await expect(
      callCompactionLlm({
        conversationMessages: Array(8).fill(CONVERSATION[0]),
        route: createRoute(),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.runUpstreamGenerate).not.toHaveBeenCalled();
  });

  it('settles caller cancellation during an uncooperative call and removes listeners', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    mocks.runUpstreamGenerate.mockReturnValue(Effect.never);
    const { state, done } = observe({
      conversationMessages: Array(8).fill(CONVERSATION[0]),
      route: createRoute(),
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort('prompt is too long');
    await vi.advanceTimersByTimeAsync(0);
    expect(state.error).toMatchObject({ name: 'AbortError' });
    expect(mocks.runUpstreamGenerate.mock.calls[0]?.[0].signal.aborted).toBe(true);
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
    expect(vi.getTimerCount()).toBe(0);
    await done;
  });

  it('shares one deadline across PTL retry and forwards the remaining upstream budget', async () => {
    vi.useFakeTimers();
    mocks.runUpstreamGenerate
      .mockReturnValueOnce(
        Effect.promise(async () => {
          await new Promise((resolve) => setTimeout(resolve, 90_000));
          throw new Error('prompt is too long');
        }),
      )
      .mockReturnValueOnce(Effect.never);
    const { state, done } = observe({
      conversationMessages: Array(8).fill(CONVERSATION[0]),
      route: createRoute(),
    });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(2);
    expect(mocks.runUpstreamGenerate.mock.calls[1]?.[0].timeoutMs).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.error).toMatchObject({
      message: expect.stringContaining('compaction LLM timeout'),
    });
    expect(vi.getTimerCount()).toBe(0);
    await done;
  });

  it.each([
    ['1', 1],
    ['240000', 240_000],
    ['180001', 180_001],
    ['', 120_000],
    ['0', 120_000],
    ['-1', 120_000],
    ['1.5', 120_000],
    ['240001', 120_000],
    ['Infinity', 120_000],
    ['no', 120_000],
    ['1e3', 120_000],
  ])('uses bounded environment timeout %j as %i ms', async (raw, expected) => {
    vi.useFakeTimers();
    vi.stubEnv('OPENAWORK_COMPACTION_TIMEOUT_MS', raw);
    mocks.runUpstreamGenerate.mockReturnValue(Effect.never);
    const { state, done } = observe({ conversationMessages: CONVERSATION, route: createRoute() });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.runUpstreamGenerate.mock.calls[0]?.[0].timeoutMs).toBe(expected);
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(state.error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toMatchObject({
      message: expect.stringContaining('compaction LLM timeout'),
    });
    expect(vi.getTimerCount()).toBe(0);
    await done;
  });

  it('cleans the deadline and caller listener after success or upstream failure', async () => {
    vi.useFakeTimers();
    for (const effect of [
      Effect.succeed({ text: 'summary', inputTokens: 1, outputTokens: 1 }),
      Effect.fail(new Error('network failure')),
    ]) {
      const controller = new AbortController();
      const add = vi.spyOn(controller.signal, 'addEventListener');
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      mocks.runUpstreamGenerate.mockReturnValue(effect);
      const { done } = observe({
        conversationMessages: CONVERSATION,
        route: createRoute(),
        signal: controller.signal,
      });
      await done;
      expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]?.[1]);
      expect(vi.getTimerCount()).toBe(0);
    }
  });

  it.each(['cancel', 'deadline'] as const)(
    'rejects success when %s wins before the timer callback runs',
    async (cause) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      mocks.runUpstreamGenerate.mockReturnValue(
        Effect.sync(() => {
          if (cause === 'cancel') controller.abort(new Error('too many tokens'));
          else vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 120_000);
          return { text: 'must not be accepted', inputTokens: 1, outputTokens: 1 };
        }),
      );
      const { state, done } = observe({
        conversationMessages: CONVERSATION,
        route: createRoute(),
        signal: controller.signal,
      });
      await done;
      expect(state.result).toBeUndefined();
      expect(state.error).toMatchObject(
        cause === 'cancel'
          ? { name: 'AbortError' }
          : { message: expect.stringContaining('compaction LLM timeout') },
      );
      expect(mocks.runUpstreamGenerate).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('forwards an AbortSignal to runUpstreamGenerate', async () => {
    mocks.runUpstreamGenerate.mockReturnValue(
      Effect.succeed({
        text: 'summary',
        inputTokens: 1,
        outputTokens: 1,
        finishReason: 'stop',
      }),
    );
    await callCompactionLlm({ conversationMessages: CONVERSATION, route: createRoute() });

    const callArgs = mocks.runUpstreamGenerate.mock.calls[0]?.[0] as { signal?: AbortSignal };
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    expect(callArgs.signal?.aborted).toBe(false);
  });

  it('aborts and throws a stable timeout error when upstream hangs', async () => {
    vi.useFakeTimers();

    let abortFired = false;
    mocks.runUpstreamGenerate.mockImplementation((arg: { signal?: AbortSignal }) =>
      Effect.callback<never, Error>((resume) => {
        const abort = () => {
          abortFired = true;
          resume(Effect.fail(new Error('aborted by signal')));
        };
        arg.signal?.addEventListener('abort', abort, { once: true });
        return Effect.sync(() => arg.signal?.removeEventListener('abort', abort));
      }),
    );

    const promise = callCompactionLlm({ conversationMessages: CONVERSATION, route: createRoute() });
    const settled = promise.then(
      () => ({ ok: true as const }),
      (err: unknown) => ({ ok: false as const, err }),
    );

    await vi.advanceTimersByTimeAsync(120_000);
    const result = await settled;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect((result.err as Error).message).toContain('compaction LLM timeout');
    }
    expect(abortFired).toBe(true);
  });
});
