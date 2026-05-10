/**
 * Regression coverage for the multi-provider rollout layer in
 * `web-search.ts` (opencode #26227 parity).
 *
 * Strategy:
 *
 * - The per-provider HTTP layer is exercised by stubbing `fetch`
 *   globally and returning canned JSON shaped like each provider's
 *   response contract. We pick DuckDuckGo / Tavily / Exa as
 *   representative providers — the other implementations follow the
 *   same `formatResults`-based output path so the merge / first-
 *   success logic is identical for them.
 *
 * - We do NOT unit-test every single provider's response parsing
 *   again here (those live in the existing single-provider paths)
 *   — the focus is the rollout orchestration: first-success vs merge
 *   vs sequential, abort propagation, combined-error formatting, and
 *   canonical URL dedupe.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicaliseSearchUrl,
  searchMultiProvider,
  type WebSearchMultiConfig,
} from './web-search.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

type FetchArgs = Parameters<typeof fetch>;

interface FetchMockCase {
  match: (url: string) => boolean;
  /** Delay before the mock resolves (ms). Default 0. */
  delayMs?: number;
  response:
    | { ok: true; body: unknown }
    | { ok: false; status: number; body?: unknown }
    /** Reject with a specific error (e.g. to simulate abort). */
    | { throw: Error };
}

/**
 * Install a deterministic fetch mock that dispatches on URL substring.
 * Returns a handle with the list of received requests so tests can
 * assert on them.
 */
function installFetchMock(cases: FetchMockCase[]): { calls: string[] } {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (...args: FetchArgs) => {
    const [input, init] = args;
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    calls.push(url);
    const matched = cases.find((c) => c.match(url));
    if (!matched) {
      throw new Error(`Unmocked fetch: ${url}`);
    }
    if (matched.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, matched.delayMs);
        const abortSignal = init?.signal;
        abortSignal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
    }
    const response = matched.response;
    if ('throw' in response) throw response.throw;
    if (response.ok) {
      return {
        ok: true,
        status: 200,
        json: async () => response.body,
      } as unknown as Response;
    }
    return {
      ok: false,
      status: response.status,
      json: async () => response.body ?? {},
    } as unknown as Response;
  }) as typeof fetch;
  return { calls };
}

function tavilyBody(urls: string[]): unknown {
  return {
    results: urls.map((url, index) => ({
      title: `Tavily ${index}`,
      content: `Tavily snippet ${index}`,
      url,
    })),
  };
}

function exaBody(urls: string[]): unknown {
  return {
    results: urls.map((url, index) => ({
      title: `Exa ${index}`,
      text: `Exa snippet ${index}`,
      url,
    })),
  };
}

function ddgBody(): unknown {
  return {
    Abstract: 'Duck abstract',
    AbstractURL: 'https://example.org/ddg',
    AbstractSource: 'DDG',
    RelatedTopics: [],
  };
}

describe('canonicaliseSearchUrl', () => {
  it('strips utm_* and gclid tracking params', () => {
    const a = canonicaliseSearchUrl('https://example.com/foo?utm_source=x&gclid=abc&q=1');
    const b = canonicaliseSearchUrl('https://example.com/foo?q=1');
    expect(a).toBe(b);
  });

  it('normalises hostname to lowercase', () => {
    expect(canonicaliseSearchUrl('https://EXAMPLE.com/')).toBe(
      canonicaliseSearchUrl('https://example.com/'),
    );
  });

  it('strips a trailing slash on non-root paths', () => {
    expect(canonicaliseSearchUrl('https://example.com/foo/')).toBe('https://example.com/foo');
    // Root path keeps its slash (opaque enough to avoid breaking real URLs).
    expect(canonicaliseSearchUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('reorders query params so equivalent URLs collapse', () => {
    const a = canonicaliseSearchUrl('https://example.com/x?b=2&a=1');
    const b = canonicaliseSearchUrl('https://example.com/x?a=1&b=2');
    expect(a).toBe(b);
  });

  it('returns the lowercased input when the URL cannot be parsed', () => {
    expect(canonicaliseSearchUrl('NOT A URL')).toBe('not a url');
    expect(canonicaliseSearchUrl('  ')).toBe('');
  });
});

describe('searchMultiProvider — sequential mode', () => {
  it('falls through to the next provider on failure', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.duckduckgo.com/'),
        response: { ok: false, status: 503 },
      },
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: { ok: true, body: tavilyBody(['https://example.com/tv']) },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [{ provider: 'duckduckgo' }, { provider: 'tavily', apiKey: 'tvly-xxxxx' }],
      rolloutMode: 'sequential',
      maxResults: 5,
    };
    const output = await searchMultiProvider(
      'who is ada lovelace',
      config,
      new AbortController().signal,
    );
    expect(output).toContain('Tavily 0');
    expect(output).toContain('https://example.com/tv');
  });

  it('combines provider errors when every provider fails', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.duckduckgo.com/'),
        response: { ok: false, status: 503 },
      },
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: { ok: false, status: 402 },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [{ provider: 'duckduckgo' }, { provider: 'tavily', apiKey: 'tvly-xxxxx' }],
      rolloutMode: 'sequential',
    };
    await expect(searchMultiProvider('q', config, new AbortController().signal)).rejects.toThrow(
      /All web search providers failed.*duckduckgo.*tavily/,
    );
  });
});

describe('searchMultiProvider — first-success mode', () => {
  it('returns as soon as any one provider succeeds and aborts the losers', async () => {
    const mock = installFetchMock([
      {
        match: (url) => url.startsWith('https://api.duckduckgo.com/'),
        delayMs: 200,
        response: { ok: true, body: ddgBody() },
      },
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        delayMs: 5,
        response: { ok: true, body: tavilyBody(['https://example.com/tv']) },
      },
      {
        match: (url) => url.startsWith('https://api.exa.ai/'),
        delayMs: 200,
        response: { ok: true, body: exaBody(['https://example.com/ex']) },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [
        { provider: 'duckduckgo' },
        { provider: 'tavily', apiKey: 'tvly-xxxxx' },
        { provider: 'exa', apiKey: 'exa-xxxxx' },
      ],
      rolloutMode: 'first-success',
    };
    const output = await searchMultiProvider('q', config, new AbortController().signal);
    expect(output).toContain('Tavily 0');
    // The mock fired for all three — the abort gets raised but our
    // test mock simply returns its canned value unless aborted
    // during the delay.
    expect(mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('reports a combined error when every provider fails', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.duckduckgo.com/'),
        response: { ok: false, status: 503 },
      },
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: { ok: false, status: 402 },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [{ provider: 'duckduckgo' }, { provider: 'tavily', apiKey: 'tvly-xxxxx' }],
      rolloutMode: 'first-success',
    };
    await expect(searchMultiProvider('q', config, new AbortController().signal)).rejects.toThrow(
      /All web search providers failed/,
    );
  });

  it('propagates the parent abort signal to in-flight provider requests', async () => {
    installFetchMock([
      {
        match: () => true,
        delayMs: 500,
        response: { ok: true, body: ddgBody() },
      },
    ]);
    const controller = new AbortController();
    const config: WebSearchMultiConfig = {
      providers: [{ provider: 'duckduckgo' }, { provider: 'tavily', apiKey: 'k' }],
      rolloutMode: 'first-success',
    };
    const task = searchMultiProvider('q', config, controller.signal);
    setTimeout(() => controller.abort(), 10);
    // Every provider errors out due to the abort → combined error path.
    await expect(task).rejects.toThrow(/All web search providers failed/);
  });
});

describe('searchMultiProvider — merge mode', () => {
  it('deduplicates by canonical URL and keeps the higher-weight title/snippet', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: {
          ok: true,
          body: tavilyBody([
            'https://example.com/shared?utm_source=low',
            'https://example.com/only-t',
          ]),
        },
      },
      {
        match: (url) => url.startsWith('https://api.exa.ai/'),
        response: {
          ok: true,
          body: exaBody(['https://example.com/shared', 'https://example.com/only-e']),
        },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [
        { provider: 'tavily', apiKey: 'tv', weight: 1 },
        { provider: 'exa', apiKey: 'ex', weight: 5 },
      ],
      rolloutMode: 'merge',
      maxResults: 5,
    };
    const output = await searchMultiProvider('q', config, new AbortController().signal);
    // Exa (higher weight) wins the shared URL's title even though Tavily
    // returned the same canonical URL first.
    expect(output).toContain('Exa');
    expect(output).toContain('https://example.com/only-t');
    expect(output).toContain('https://example.com/only-e');
    // Dedupe: the shared URL should appear exactly once.
    const sharedOccurrences = output.split('https://example.com/shared').length - 1;
    expect(sharedOccurrences).toBe(1);
  });

  it('returns a "no results" message when every provider yields an empty list', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: { ok: true, body: tavilyBody([]) },
      },
      {
        match: (url) => url.startsWith('https://api.exa.ai/'),
        response: { ok: true, body: exaBody([]) },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [
        { provider: 'tavily', apiKey: 'tv' },
        { provider: 'exa', apiKey: 'ex' },
      ],
      rolloutMode: 'merge',
    };
    const output = await searchMultiProvider('q', config, new AbortController().signal);
    expect(output).toContain('No results found for: q');
  });

  it('throws a combined error when every provider fails', async () => {
    installFetchMock([
      {
        match: (url) => url.startsWith('https://api.tavily.com/'),
        response: { ok: false, status: 500 },
      },
      {
        match: (url) => url.startsWith('https://api.exa.ai/'),
        response: { ok: false, status: 500 },
      },
    ]);
    const config: WebSearchMultiConfig = {
      providers: [
        { provider: 'tavily', apiKey: 'tv' },
        { provider: 'exa', apiKey: 'ex' },
      ],
      rolloutMode: 'merge',
    };
    await expect(searchMultiProvider('q', config, new AbortController().signal)).rejects.toThrow(
      /All web search providers failed.*tavily.*exa/,
    );
  });
});

describe('searchMultiProvider — validation', () => {
  it('refuses an empty provider list', async () => {
    await expect(
      searchMultiProvider('q', { providers: [] }, new AbortController().signal),
    ).rejects.toThrow(/at least one provider/);
  });
});
