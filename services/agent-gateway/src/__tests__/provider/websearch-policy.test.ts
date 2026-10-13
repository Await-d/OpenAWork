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

import { createWebsearchTool } from '../../tools/tool-aliases.js';
import { readWebsearchPolicy, websearchPolicySchema } from '../../provider/websearch-policy.js';

// 免密钥回退（bing 等）会调用真实的抓取服务。本文件只验证路由与凭据优先级，
// 所以把服务换成「一被调用就炸」，保证任何用例都不会意外打真实网络。
vi.mock('../../mcp/open-websearch-services.js', () => ({
  loadOpenWebSearchSearchService: async () => ({
    execute: async () => {
      throw new Error('keyless search service must not be used in websearch-policy.test.ts');
    },
  }),
  loadOpenWebSearchGithubReadmeService: async () => ({ execute: async () => null }),
}));

interface FetchPlanEntry {
  match: (url: string) => boolean;
  status?: number;
  body: unknown;
}

function installFetchMock(plan: FetchPlanEntry[]): {
  calls: string[];
  /** 每次请求的 headers 快照，用于断言凭据确实被带到了上游。 */
  headers: Array<Record<string, string>>;
  restore: () => void;
} {
  const calls: string[] = [];
  const headers: Array<Record<string, string>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    calls.push(url);
    headers.push((init?.headers as Record<string, string> | undefined) ?? {});
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
    headers,
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
      // Bing — 用于「模型指定 provider 时由宿主补齐密钥」的回归用例。
      {
        match: (u) => u.includes('api.bing.microsoft.com'),
        body: {
          webPages: {
            value: [{ name: 'Bing 0', url: 'https://example.com/bing', snippet: 'snippet bing' }],
          },
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

/**
 * 回归（2026-10-12 线上排障）：模型指定 `provider: "bing"` 却拿不到密钥，调用
 * 以裸英文 `Bing API key is required` 结束。密钥属于宿主 / 用户配置——模型既
 * 读不到 `process.env`，也不该被要求携带——所以必须由网关按「用户设置 →
 * 环境变量」补齐；两处都取不到时给出可操作的中文指引，而不是让模型原样重试。
 */
describe('createWebsearchTool — 宿主侧凭据补全', () => {
  let mock: ReturnType<typeof installFetchMock>;
  let savedBingKey: string | undefined;
  let savedGoogleCseId: string | undefined;

  beforeEach(() => {
    savedBingKey = process.env['BING_API_KEY'];
    savedGoogleCseId = process.env['GOOGLE_CSE_ID'];
    delete process.env['BING_API_KEY'];
    delete process.env['GOOGLE_CSE_ID'];
    mock = installFetchMock([
      {
        match: (u) => u.includes('api.bing.microsoft.com'),
        body: {
          webPages: {
            value: [{ name: 'Bing 0', url: 'https://example.com/bing', snippet: 'snippet bing' }],
          },
        },
      },
      {
        // Google 的密钥 / cx 走 query string，便于断言优先级。
        match: (u) => u.includes('googleapis.com/customsearch'),
        body: {
          items: [{ title: 'Google 0', link: 'https://example.com/g', snippet: 'snippet g' }],
        },
      },
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
    if (savedBingKey === undefined) delete process.env['BING_API_KEY'];
    else process.env['BING_API_KEY'] = savedBingKey;
    if (savedGoogleCseId === undefined) delete process.env['GOOGLE_CSE_ID'];
    else process.env['GOOGLE_CSE_ID'] = savedGoogleCseId;
    vi.restoreAllMocks();
  });

  function lastHeaders(): Record<string, string> {
    return mock.headers[mock.headers.length - 1] ?? {};
  }

  it('模型指定 bing 但未给密钥 → 用宿主环境变量补齐并成功', async () => {
    process.env['BING_API_KEY'] = 'env-bing-key';
    const tool = createWebsearchTool();
    const out = await tool.execute!(
      { query: 'q', maxResults: 5, provider: 'bing' },
      new AbortController().signal,
    );
    expect(out).toContain('Bing 0');
    expect(lastHeaders()['Ocp-Apim-Subscription-Key']).toBe('env-bing-key');
  });

  it('用户设置里的密钥优先于环境变量', async () => {
    process.env['BING_API_KEY'] = 'env-bing-key';
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [{ provider: 'bing', apiKey: 'policy-bing-key' }],
        rolloutMode: 'sequential',
      }),
    });
    const out = await tool.execute!(
      { query: 'q', maxResults: 5, provider: 'bing' },
      new AbortController().signal,
    );
    expect(out).toContain('Bing 0');
    expect(lastHeaders()['Ocp-Apim-Subscription-Key']).toBe('policy-bing-key');
  });

  it('模型显式给出的密钥优先于宿主配置', async () => {
    process.env['BING_API_KEY'] = 'env-bing-key';
    const tool = createWebsearchTool();
    await tool.execute!(
      { query: 'q', maxResults: 5, provider: 'bing', apiKey: 'caller-key' },
      new AbortController().signal,
    );
    expect(lastHeaders()['Ocp-Apim-Subscription-Key']).toBe('caller-key');
  });

  it('模型给了 apiKey 但缺 cx 时，模型密钥不被用户设置反向覆盖', async () => {
    process.env['GOOGLE_CSE_ID'] = 'env-cx';
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [{ provider: 'google', apiKey: 'policy-google-key' }],
        rolloutMode: 'sequential',
      }),
    });
    await tool.execute!(
      { query: 'q', maxResults: 5, provider: 'google', apiKey: 'caller-google-key' },
      new AbortController().signal,
    );
    const url = mock.calls[mock.calls.length - 1] ?? '';
    // 优先级：模型入参 > 用户设置 > 环境变量。
    expect(url).toContain('key=caller-google-key');
    expect(url).not.toContain('policy-google-key');
    // 缺的 cx 才向后兜底到环境变量。
    expect(url).toContain('cx=env-cx');
  });

  it('宿主也没配密钥且无免密钥回退 → 抛出含配置指引的错误，而非裸英文', async () => {
    // 用 tavily 而非 bing：`bing` 现在有网关注册的免密钥抓取回退（见
    // websearch-keyless-providers.ts），无 Key 时不再报错；`tavily` 没有回退，
    // 仍是「缺 Key ⇒ 可操作错误」这条契约的代表。
    const tool = createWebsearchTool({ resolveMultiConfig: () => null });
    await expect(
      tool.execute!({ query: 'q', provider: 'tavily' }, new AbortController().signal),
    ).rejects.toThrow(/TAVILY_API_KEY/);
  });

  it('策略条目只写了 provider、密钥留在环境变量里也能跑通', async () => {
    process.env['BING_API_KEY'] = 'env-bing-key';
    const tool = createWebsearchTool({
      resolveMultiConfig: () => ({
        providers: [{ provider: 'bing' }, { provider: 'duckduckgo' }],
        rolloutMode: 'sequential',
      }),
    });
    const out = await tool.execute!({ query: 'q', maxResults: 5 }, new AbortController().signal);
    expect(out).toContain('Bing 0');
    expect(mock.calls.some((u) => u.includes('api.bing.microsoft.com'))).toBe(true);
  });
});
