/**
 * Robustness: `callCompactionLlm` must enforce a wall-clock deadline on
 * its upstream summary call.
 *
 * Compaction fires automatically on context pressure (often mid-turn).
 * The native upstream generator honours `abortSignal` but has no built-in
 * deadline, and the request-scoped signal callers pass only fires when
 * the client disconnects — not when an upstream socket connects but
 * never responds. Without an internal timeout a hung summary call would
 * stall the session indefinitely.
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

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
