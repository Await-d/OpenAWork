/**
 * Unit tests for `websearch-policy` + `createWebsearchTool` rollout
 * decision (P2-WEBSEARCH workflow 260509).
 *
 * Scope:
 *   - schema parsing & defaults survive bad / empty rows.
 *   - tool factory falls through to the legacy single-call when no
 *     resolver is wired or the policy is empty.
 *   - tool factory routes to `searchMultiProvider` when ≥2 providers
 *     OR a non-sequential rolloutMode is configured.
 *   - LLM-pinned `provider` always wins (resolver is never consulted).
 *
 * We mock fetch so we never touch the live web. The mock is shared
 * across cases via `installFetchMock` so we can assert on which
 * provider endpoints actually got hit.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebsearchTool } from '../tool-aliases.js';
import { readWebsearchPolicy, websearchPolicySchema } from '../websearch-policy.js';

interface FetchPlanEntry {
  match: (url: string) => boolean;
  status?: number;
  body: unknown;
}

function installFetchMock(plan: FetchPlanEntry[]): {
  calls: string[];
  restore: () => void;
} {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    const entry = plan.find((p) => p.match(url));
    if (!entry) {
      return new Response(JSON.stringify({ error: `unmocked: ${url}` }), { status: 500 });
    }
    return new Response(JSON.stringify(entry.body), {
      status: entry.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('readWebsearchPolicy', () => {
  it('returns the default policy for null / non-object input', () => {
    expect(readWebsearchPolicy(null)).toEqual({ providers: [], rolloutMode: 'sequential' });
    expect(readWebsearchPolicy(undefined)).toEqual({
      providers: [],
      rolloutMode: 'sequential',
    });
    expect(readWebsearchPolicy('garbage')).toEqual({
      providers: [],
      rolloutMode: 'sequential',
    });
  });

  it('passes through a valid stored policy', () => {
    const stored = {
      providers: [{ provider: 'tavily', apiKey: 'tk' }, { provider: 'duckduckgo' }],
      rolloutMode: 'first-success',
      timeoutMs: 8_000,
    };
    expect(readWebsearchPolicy(stored)).toEqual(stored);
  });

  it('falls back to defaults when a partial blob fails schema validation', () => {
    // `provider` must be one of the allowlist; `bogus` should reject.
    const bad = { providers: [{ provider: 'bogus' }] };
    expect(readWebsearchPolicy(bad)).toEqual({ providers: [], rolloutMode: 'sequential' });
  });

  it('rejects more than 8 provider entries via the schema', () => {
    const tooMany = { providers: Array.from({ length: 9 }, () => ({ provider: 'duckduckgo' })) };
    const parsed = websearchPolicySchema.safeParse(tooMany);
    expect(parsed.success).toBe(false);
  });
});

describe('createWebsearchTool — decision routing', () => {
  let mock: ReturnType<typeof installFetchMock>;

  beforeEach(() => {
    mock = installFetchMock([
      // Tavily — used by the multi-provider rollout in tests below.
      {
        match: (u) => u.includes('api.tavily.com'),
        body: {
          results: [{ title: 'Tavily 0', url: 'https://example.com/tv', content: 'snippet tv' }],
        },
      },
      // Exa — second provider in the multi-provider rollout.
      {
        match: (u) => u.includes('api.exa.ai'),
        body: {
          results: [{ title: 'Exa 0', url: 'https://example.com/ex', text: 'snippet ex' }],
        },
      },
      // DuckDuckGo (default legacy provider).
      {
        match: (u) => u.includes('duckduckgo.com'),
        body: {
          AbstractText: 'duck answer',
          AbstractURL: 'https://duck.test/answer',
          RelatedTopics: [],
        },
      },
    ]);
  });

  afterEach(() => {
    mock.restore();
    vi.restoreAllMocks();
  });

  it('falls through to the legacy provider when no resolver is wired', async () => {
    const tool = createWebsearchTool();
    const result = await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    expect(typeof result).toBe('string');
    // The DDG mock is the only one that should have been touched.
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(false);
  });

  it('falls through to legacy when policy resolver returns null', async () => {
    const tool = createWebsearchTool({ resolveMultiConfig: () => null });
    await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(false);
  });

  it('falls through to legacy when policy has only one provider in sequential mode', async () => {
    // Single-provider sequential is functionally the legacy call;
    // we explicitly do NOT trip the multi-provider path here so users
    // can keep the same single-provider config without surprise.
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [{ provider: 'tavily', apiKey: 'tk' }],
        rolloutMode: 'sequential',
      }),
    });
    await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    // No multi-provider call → the legacy fallback hit DDG (the
    // input did not pin tavily, so legacy default applies).
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(false);
  });

  it('routes to the multi-provider path when 2+ providers are configured', async () => {
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [
          { provider: 'tavily', apiKey: 'tk' },
          { provider: 'exa', apiKey: 'ek' },
        ],
        rolloutMode: 'sequential',
      }),
    });
    const out = await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    expect(out).toContain('Tavily 0');
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(true);
    // Sequential mode short-circuits on the first success → exa is
    // not hit. The point of this assertion is that `searchSequential`
    // is the dispatcher (not the legacy path); both endpoints would
    // be hit in `merge` mode.
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(false);
  });

  it('routes to multi-provider path on first-success even with one provider', async () => {
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [{ provider: 'tavily', apiKey: 'tk' }],
        rolloutMode: 'first-success',
      }),
    });
    const out = await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    expect(out).toContain('Tavily 0');
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(false);
  });

  it('respects an LLM-pinned provider over the policy', async () => {
    const resolveSpy = vi.fn(() => ({
      providers: [{ provider: 'tavily' as const, apiKey: 'tk' }],
      rolloutMode: 'first-success' as const,
    }));
    const tool = createWebsearchTool({ resolveMultiConfig: resolveSpy });
    // The LLM said "duckduckgo" — we MUST honour that pin and skip
    // the rollout entirely so per-call overrides remain trustworthy.
    await tool.execute!(
      { query: 'q', maxResults: 5, provider: 'duckduckgo' },
      new AbortController().signal,
    );
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(mock.calls.some((u) => u.includes('duckduckgo.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(false);
  });

  it('forwards merge mode + timeout to searchMultiProvider', async () => {
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [
          { provider: 'tavily', apiKey: 'tk' },
          { provider: 'exa', apiKey: 'ek' },
        ],
        rolloutMode: 'merge',
        timeoutMs: 5_000,
      }),
    });
    const out = await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    // Merge mode races both providers and dedupes — both should fire.
    expect(mock.calls.some((u) => u.includes('api.tavily.com'))).toBe(true);
    expect(mock.calls.some((u) => u.includes('api.exa.ai'))).toBe(true);
    expect(out).toMatch(/Tavily|Exa/);
  });
});
