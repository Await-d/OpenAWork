/**
 * Regression (§0.123, codesearch response body memory bound):
 * the codesearch tool read the Exa endpoint's response via response.text()
 * with no byte ceiling. The 30s tool timeout bounds wall-clock but NOT memory —
 * a fast or oversized SSE stream could buffer unboundedly and OOM the gateway.
 * The read now goes through readResponseTextWithLimit (like webfetch / skill
 * content). We set a tiny cap via env and return an oversized body, asserting
 * the tool surfaces the "response body too large" guard instead of buffering it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Set before importing the module so the cap resolver picks it up per-call.
process.env['OPENAWORK_CODESEARCH_MAX_BYTES'] = '64';

import { codesearchToolDefinition } from '../../tools/codesearch-tools.js';

const NO_SIGNAL = new AbortController().signal;

describe('codesearch tool response body limit', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects an oversized response body instead of buffering it unboundedly', async () => {
    // A 200 OK response whose body far exceeds the 64-byte cap.
    const huge = 'x'.repeat(10_000);
    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(`data: {"content":"${huge}"}\n`, { status: 200 }),
    );

    await expect(
      codesearchToolDefinition.execute({ query: 'react hooks', tokensNum: 5000 }, NO_SIGNAL),
    ).rejects.toThrow(/response body too large/);
  });
});
