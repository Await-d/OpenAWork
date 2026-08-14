import { z } from 'zod';
import type { ToolDefinition } from './tool-contract.js';

type WebSearchProvider =
  'duckduckgo' | 'tavily' | 'exa' | 'serper' | 'searxng' | 'bocha' | 'zhipu' | 'google' | 'bing';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
  timeout?: number;
}

interface SearchResultItem {
  title: string;
  snippet: string;
  url: string;
}

interface DuckDuckGoResponse {
  Abstract: string;
  AbstractURL: string;
  AbstractSource: string;
  RelatedTopics: Array<{
    Text?: string;
    FirstURL?: string;
    Topics?: Array<{ Text?: string; FirstURL?: string }>;
  }>;
}

function formatResults(query: string, results: SearchResultItem[], maxResults: number): string {
  if (results.length === 0) {
    return `No results found for: ${query}`;
  }

  return results
    .slice(0, maxResults)
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
    .join('\n\n');
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeResults(items: SearchResultItem[], maxResults: number): SearchResultItem[] {
  return items
    .filter((item) => item.title || item.snippet || item.url)
    .slice(0, maxResults)
    .map((item) => ({
      title: item.title || 'Untitled',
      snippet: item.snippet,
      url: item.url,
    }));
}

async function duckduckgoSearch(
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<string> {
  const url = new URL('https://api.duckduckgo.com/');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('no_html', '1');
  url.searchParams.set('skip_disambig', '1');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`DuckDuckGo API error: ${res.status}`);

  const data = (await res.json()) as DuckDuckGoResponse;

  const results: SearchResultItem[] = [];

  if (data.Abstract) {
    results.push({
      title: data.AbstractSource || 'DuckDuckGo',
      snippet: data.Abstract,
      url: data.AbstractURL || '',
    });
  }

  for (const topic of data.RelatedTopics) {
    if (results.length >= maxResults) break;
    if (topic.Text && topic.FirstURL) {
      const dashIdx = topic.Text.indexOf(' - ');
      const title = dashIdx !== -1 ? topic.Text.slice(0, dashIdx) : topic.Text.slice(0, 60);
      const snippet = dashIdx !== -1 ? topic.Text.slice(dashIdx + 3) : topic.Text;
      results.push({ title, snippet, url: topic.FirstURL });
    } else if (topic.Topics) {
      for (const sub of topic.Topics) {
        if (results.length >= maxResults) break;
        if (sub.Text && sub.FirstURL) {
          const dashIdx = sub.Text.indexOf(' - ');
          const title = dashIdx !== -1 ? sub.Text.slice(0, dashIdx) : sub.Text.slice(0, 60);
          const snippet = dashIdx !== -1 ? sub.Text.slice(dashIdx + 3) : sub.Text;
          results.push({ title, snippet, url: sub.FirstURL });
        }
      }
    }
  }

  return formatResults(query, results, maxResults);
}

async function tavilySearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Tavily API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: config.apiKey,
      query,
      max_results: maxResults,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Tavily API error: ${res.status}`);

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const results = normalizeResults(
    (data.results ?? []).map((item) => ({
      title: getString(item.title),
      snippet: getString(item.content) || getString(item.snippet),
      url: getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function exaSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Exa API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: maxResults,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Exa API error: ${res.status}`);

  const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
  const results = normalizeResults(
    (data.results ?? []).map((item) => ({
      title: getString(item.title),
      snippet: getString(item.text) || getString(item.snippet),
      url: getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function serperSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Serper API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': config.apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: maxResults,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Serper API error: ${res.status}`);

  const data = (await res.json()) as {
    organic?: Array<Record<string, unknown>>;
  };
  const results = normalizeResults(
    (data.organic ?? []).map((item) => ({
      title: getString(item.title),
      snippet: getString(item.snippet),
      url: getString(item.link),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function searxngSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  const maxResults = config.maxResults ?? 5;
  const baseUrl = config.baseUrl?.trim();
  if (!baseUrl) {
    throw new Error('SearXNG baseUrl is required');
  }
  const url = new URL('/search', baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`SearXNG API error: ${res.status}`);

  const data = (await res.json()) as {
    results?: Array<Record<string, unknown>>;
  };
  const results = normalizeResults(
    (data.results ?? []).map((item) => ({
      title: getString(item.title),
      snippet: getString(item.content),
      url: getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function bochaSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Bocha API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      query,
      count: maxResults,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Bocha API error: ${res.status}`);

  const data = (await res.json()) as {
    data?: {
      webPages?: {
        value?: Array<Record<string, unknown>>;
      };
      results?: Array<Record<string, unknown>>;
    };
    results?: Array<Record<string, unknown>>;
  };
  const rawResults = data.data?.results ?? data.data?.webPages?.value ?? data.results ?? [];
  const results = normalizeResults(
    rawResults.map((item) => ({
      title: getString(item.title) || getString(item.name),
      snippet: getString(item.snippet) || getString(item.summary),
      url: getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function zhipuSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Zhipu API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/tools/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ query }),
    signal,
  });
  if (!res.ok) throw new Error(`Zhipu API error: ${res.status}`);

  const data = (await res.json()) as {
    data?: Array<Record<string, unknown>>;
    search_result?: Array<Record<string, unknown>>;
    results?: Array<Record<string, unknown>>;
  };
  const rawResults = data.search_result ?? data.data ?? data.results ?? [];
  const results = normalizeResults(
    rawResults.map((item) => ({
      title: getString(item.title),
      snippet: getString(item.content) || getString(item.snippet),
      url: getString(item.link) || getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function googleSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Google API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', config.apiKey);
  url.searchParams.set('cx', config.baseUrl ?? '');
  url.searchParams.set('q', query);
  url.searchParams.set('num', String(maxResults));

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Google API error: ${res.status}`);

  const data = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const results = normalizeResults(
    (data.items ?? []).map((item) => ({
      title: getString(item.title),
      snippet: getString(item.snippet),
      url: getString(item.link),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function bingSearch(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  if (!config.apiKey) {
    throw new Error('Bing API key is required');
  }
  const maxResults = config.maxResults ?? 5;
  const url = new URL('https://api.bing.microsoft.com/v7.0/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const res = await fetch(url.toString(), {
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
    },
    signal,
  });
  if (!res.ok) throw new Error(`Bing API error: ${res.status}`);

  const data = (await res.json()) as {
    webPages?: { value?: Array<Record<string, unknown>> };
  };
  const results = normalizeResults(
    (data.webPages?.value ?? []).map((item) => ({
      title: getString(item.name),
      snippet: getString(item.snippet),
      url: getString(item.url),
    })),
    maxResults,
  );
  return formatResults(query, results, maxResults);
}

async function searchWithConfig(
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
): Promise<string> {
  switch (config.provider) {
    case 'duckduckgo':
      return duckduckgoSearch(query, config.maxResults ?? 5, signal);
    case 'tavily':
      return tavilySearch(query, config, signal);
    case 'exa':
      return exaSearch(query, config, signal);
    case 'serper':
      return serperSearch(query, config, signal);
    case 'searxng':
      return searxngSearch(query, config, signal);
    case 'bocha':
      return bochaSearch(query, config, signal);
    case 'zhipu':
      return zhipuSearch(query, config, signal);
    case 'google':
      return googleSearch(query, config, signal);
    case 'bing':
      return bingSearch(query, config, signal);
    default:
      throw new Error(`Unsupported web search provider: ${String(config.provider)}`);
  }
}

// ---------------------------------------------------------------------------
// Multi-provider rollout (opencode #26227 parity).
// ---------------------------------------------------------------------------

/**
 * One entry in a multi-provider rollout. Each entry carries its own
 * credentials so callers can mix e.g. a keyless DuckDuckGo with a
 * paid Tavily in the same race.
 */
export interface WebSearchMultiEntry {
  provider: WebSearchProvider;
  apiKey?: string;
  baseUrl?: string;
  /**
   * Soft ranking hint used by the `merge` strategy: higher weight
   * results are surfaced first when multiple providers return
   * overlapping URLs. Defaults to 1. Ignored by `first-success` and
   * `sequential`.
   */
  weight?: number;
}

/** Strategy for combining results from multiple providers. */
export type WebSearchRolloutMode =
  /** Fire all providers in parallel; first non-error result wins and the rest are aborted. */
  | 'first-success'
  /** Fire all providers, wait for all (bounded by `timeoutMs`), dedupe by canonical URL, sort by weight. */
  | 'merge'
  /** Try providers one at a time; fall back to the next only on failure. */
  | 'sequential';

export interface WebSearchMultiConfig {
  providers: WebSearchMultiEntry[];
  rolloutMode?: WebSearchRolloutMode;
  maxResults?: number;
  /** Only enforced by `merge` — caps how long we wait for the slowest provider. */
  timeoutMs?: number;
}

interface SingleProviderOutcome {
  provider: WebSearchProvider;
  weight: number;
  result: string;
  durationMs: number;
}

/** Deduplication key used by `merge`. Strips tracking params and a trailing slash. */
export function canonicaliseSearchUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed.toLowerCase();
  }
  const TRACKING_PREFIXES = ['utm_', 'mc_', 'fbclid', 'gclid', 'ref_', 'ref='];
  const keysToDrop: string[] = [];
  url.searchParams.forEach((_, key) => {
    const lower = key.toLowerCase();
    if (TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix) || lower === prefix)) {
      keysToDrop.push(key);
    }
  });
  for (const key of keysToDrop) url.searchParams.delete(key);
  // Stable param ordering: sort by key so two URLs that differ only
  // in query-param order collapse into the same canonical form.
  const sortedEntries = Array.from(url.searchParams.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  url.search = '';
  for (const [k, v] of sortedEntries) url.searchParams.append(k, v);
  url.hostname = url.hostname.toLowerCase();
  let result = url.toString();
  if (result.endsWith('/') && url.pathname !== '/') {
    result = result.slice(0, -1);
  }
  return result;
}

interface ParsedResultItem {
  index: number;
  title: string;
  snippet: string;
  url: string;
  canonical: string;
  weight: number;
}

/**
 * Parse the string output produced by `formatResults`. The single-
 * provider search functions all return strings (to match the tool
 * contract), so for `merge` we have to reconstruct the item list
 * from those strings. Format we rely on:
 *
 *   `${n}. ${title}\n   ${snippet}\n   ${url}`
 *
 * joined by `\n\n`. Resilient to unexpected lines.
 */
function parseFormattedResults(output: string, weight: number): ParsedResultItem[] {
  if (output.startsWith('No results found')) return [];
  const blocks = output.split(/\n\n+/);
  const items: ParsedResultItem[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;
    const header = lines[0] ?? '';
    const titleMatch = header.match(/^\s*\d+\.\s*(.*)$/);
    if (!titleMatch) continue;
    const title = (titleMatch[1] ?? '').trim();
    const snippet = (lines[1] ?? '').trim();
    const url = (lines[2] ?? '').trim();
    if (!url) continue;
    const canonical = canonicaliseSearchUrl(url);
    items.push({
      index: items.length,
      title,
      snippet,
      url,
      canonical: canonical || url.toLowerCase(),
      weight,
    });
  }
  return items;
}

function buildCombinedError(
  failures: Array<{ provider: WebSearchProvider; error: unknown }>,
): Error {
  const parts = failures.map((failure) => {
    const message = failure.error instanceof Error ? failure.error.message : String(failure.error);
    return `[${failure.provider}] ${message}`;
  });
  return new Error(`All web search providers failed: ${parts.join('; ')}`);
}

async function runProvider(
  query: string,
  entry: WebSearchMultiEntry,
  maxResults: number | undefined,
  signal: AbortSignal,
): Promise<SingleProviderOutcome> {
  const config: WebSearchConfig = {
    provider: entry.provider,
    ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    ...(maxResults !== undefined ? { maxResults } : {}),
  };
  const startedAt = Date.now();
  const result = await searchWithConfig(query, config, signal);
  return {
    provider: entry.provider,
    weight: entry.weight ?? 1,
    result,
    durationMs: Date.now() - startedAt,
  };
}

async function searchSequential(
  query: string,
  config: WebSearchMultiConfig,
  signal: AbortSignal,
): Promise<string> {
  const failures: Array<{ provider: WebSearchProvider; error: unknown }> = [];
  for (const entry of config.providers) {
    if (signal.aborted) throw new Error('web search aborted');
    try {
      const outcome = await runProvider(query, entry, config.maxResults, signal);
      return outcome.result;
    } catch (error) {
      failures.push({ provider: entry.provider, error });
    }
  }
  throw buildCombinedError(failures);
}

async function searchFirstSuccess(
  query: string,
  config: WebSearchMultiConfig,
  signal: AbortSignal,
): Promise<string> {
  const controllers = config.providers.map(() => new AbortController());
  const onParentAbort = () => controllers.forEach((c) => c.abort());
  if (signal.aborted) onParentAbort();
  else signal.addEventListener('abort', onParentAbort, { once: true });

  const failures: Array<{ provider: WebSearchProvider; error: unknown }> = [];
  try {
    const tasks = config.providers.map((entry, index) =>
      runProvider(query, entry, config.maxResults, controllers[index]!.signal).catch((error) => {
        failures.push({ provider: entry.provider, error });
        throw error;
      }),
    );
    try {
      const winner = await Promise.any(tasks);
      // Abort the losers so they stop consuming credits / quota.
      controllers.forEach((c, i) => {
        if (config.providers[i]!.provider !== winner.provider) c.abort();
      });
      return winner.result;
    } catch (error) {
      // Promise.any → AggregateError when every provider fails. Surface
      // the structured combined error instead so callers get a single
      // readable message.
      if (error instanceof AggregateError) throw buildCombinedError(failures);
      throw error;
    }
  } finally {
    signal.removeEventListener('abort', onParentAbort);
  }
}

async function searchMerge(
  query: string,
  config: WebSearchMultiConfig,
  signal: AbortSignal,
): Promise<string> {
  const controllers = config.providers.map(() => new AbortController());
  const onParentAbort = () => controllers.forEach((c) => c.abort());
  if (signal.aborted) onParentAbort();
  else signal.addEventListener('abort', onParentAbort, { once: true });

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (config.timeoutMs && config.timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      controllers.forEach((c) => c.abort());
    }, config.timeoutMs);
  }

  try {
    const settled = await Promise.allSettled(
      config.providers.map((entry, index) =>
        runProvider(query, entry, config.maxResults, controllers[index]!.signal),
      ),
    );

    const failures: Array<{ provider: WebSearchProvider; error: unknown }> = [];
    const items: ParsedResultItem[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        items.push(...parseFormattedResults(result.value.result, result.value.weight));
      } else {
        // settled.reason can be anything; we don't know the provider
        // from here, so fall back to using the settled index.
      }
    }
    // Re-walk settled to capture provider+error pairs for the combined
    // error in case nothing succeeded.
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        failures.push({
          provider: config.providers[index]!.provider,
          error: result.reason,
        });
      }
    });

    if (items.length === 0) {
      if (failures.length === config.providers.length) {
        throw buildCombinedError(failures);
      }
      return `No results found for: ${query}`;
    }

    // Dedupe by canonical URL, keeping the highest-weight hit; break
    // ties by the earlier index (so provider order in the config
    // acts as a stable secondary ranking signal).
    const byCanonical = new Map<string, ParsedResultItem>();
    for (const item of items) {
      const existing = byCanonical.get(item.canonical);
      if (
        !existing ||
        item.weight > existing.weight ||
        (item.weight === existing.weight && item.index < existing.index)
      ) {
        byCanonical.set(item.canonical, item);
      }
    }
    const deduped = Array.from(byCanonical.values()).sort((a, b) => {
      if (a.weight !== b.weight) return b.weight - a.weight;
      return a.index - b.index;
    });
    const maxResults = config.maxResults ?? 5;
    return formatResults(
      query,
      deduped.map((item) => ({ title: item.title, snippet: item.snippet, url: item.url })),
      maxResults,
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    signal.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Run a web search across multiple providers according to the
 * requested rollout mode. Throws a structured combined error if every
 * provider fails.
 */
export async function searchMultiProvider(
  query: string,
  config: WebSearchMultiConfig,
  signal: AbortSignal,
): Promise<string> {
  if (config.providers.length === 0) {
    throw new Error('searchMultiProvider: at least one provider entry is required');
  }
  const mode = config.rolloutMode ?? 'sequential';
  if (mode === 'sequential') return searchSequential(query, config, signal);
  if (mode === 'merge') return searchMerge(query, config, signal);
  return searchFirstSuccess(query, config, signal);
}

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description: '在网上搜索实时信息。当用户需要实时数据、新闻或事实时使用。',
  inputSchema: z.object({
    query: z.string().describe('搜索关键词'),
    maxResults: z.number().int().min(1).max(20).default(5).describe('最多返回结果数（默认 5）'),
    provider: z
      .enum([
        'duckduckgo',
        'tavily',
        'exa',
        'serper',
        'searxng',
        'bocha',
        'zhipu',
        'google',
        'bing',
      ])
      .optional()
      .describe('网页搜索提供商（默认 duckduckgo）'),
    apiKey: z.string().optional().describe('提供商 API Key（如需）'),
    baseUrl: z.string().optional().describe('提供商 base URL 或 engine id（各提供商不同）'),
  }),
  outputSchema: z.string(),
  timeout: 30_000,
  execute: async (input, signal) => {
    const config: WebSearchConfig = {
      provider: input.provider ?? 'duckduckgo',
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      maxResults: input.maxResults,
    };
    return searchWithConfig(input.query, config, signal);
  },
};

export const WEB_SEARCH_TOOLS = [webSearchTool] as const;

// 导出提示词
export {
  WEB_SEARCH_TOOL_USAGE_GUIDE,
  WEB_SEARCH_TOOLS_LIST,
  WEB_SEARCH_PROVIDERS,
} from './prompts/web-search-prompt.js';
