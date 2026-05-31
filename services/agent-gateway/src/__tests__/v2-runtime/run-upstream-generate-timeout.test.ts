/**
 * Regression (§0.131, runUpstreamGenerate intrinsic wall-clock backstop):
 * The non-streaming upstream entry point only forwarded the caller's signal to
 * the AI SDK `generateText`, which has NO built-in deadline. Its streaming
 * sibling `runUpstreamStream` already bounds a connects-but-hangs upstream with
 * an idle watchdog; the non-streaming path had no equivalent floor, so a
 * forgetful / future caller (or one whose request-scoped signal only fires on
 * client disconnect) could leave a half-open upstream call pending forever.
 * The runner now arms its own AbortSignal.timeout backstop (env-overridable,
 * combined with any caller signal via AbortSignal.any) and surfaces a clear
 * `upstream generate timeout` error.
 *
 * We mock the `ai` SDK so generateText hangs until its abortSignal fires, set a
 * tiny intrinsic timeout, and assert the call rejects with the timeout message.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// `generateText` hangs until the provided abortSignal aborts, then rejects like
// the AI SDK does on abort. Lets us prove the intrinsic backstop fires.
const generateTextMock = vi.fn(
  (opts: { abortSignal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      const signal = opts.abortSignal;
      if (!signal) return; // no signal → would hang forever (the bug)
      if (signal.aborted) {
        reject(new DOMException('aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true,
      });
    }),
);

vi.mock('ai', () => ({
  generateText: (opts: unknown) => generateTextMock(opts as { abortSignal?: AbortSignal }),
}));

// Stub the provider factory so no real network / SDK provider is constructed.
vi.mock('../../v2-runtime/upstream/provider.js', () => ({
  buildAISdkProvider: () => ({
    languageModel: () => ({ modelId: 'stub-model' }),
  }),
}));

const { runUpstreamGenerate } = await import('../../v2-runtime/upstream/run-upstream-generate.js');

afterEach(() => {
  generateTextMock.mockClear();
  delete process.env['OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS'];
});

describe('runUpstreamGenerate intrinsic timeout', () => {
  it('上游 connects-but-hangs 时，内置墙钟超时触发并抛出可识别错误', async () => {
    process.env['OPENAWORK_UPSTREAM_GENERATE_TIMEOUT_MS'] = '50';

    await expect(
      runUpstreamGenerate({
        providerType: 'openai',
        model: 'stub-model',
        messages: [{ role: 'user', content: 'ping' }],
        // No caller signal — the intrinsic backstop is the only thing that can
        // unwedge this call.
      }),
    ).rejects.toThrow(/upstream generate timeout/);
  });

  it('timeoutMs<=0 显式禁用内置超时（交由调用方/上游自行决定）', async () => {
    // With the backstop disabled and no caller signal, generateText receives no
    // abortSignal at all — assert we passed through without arming a timer by
    // racing against a short real timer.
    const pending = runUpstreamGenerate({
      providerType: 'openai',
      model: 'stub-model',
      messages: [{ role: 'user', content: 'ping' }],
      timeoutMs: 0,
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 120));
    expect(settled).toBe(false);
    // The mock's generateText got no abortSignal (backstop disabled, no caller
    // signal), confirming the intrinsic timer was not armed.
    const callArg = generateTextMock.mock.calls[0]?.[0];
    expect(callArg?.abortSignal).toBeUndefined();
  });
});
