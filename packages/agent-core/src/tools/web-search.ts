import { z } from 'zod';
import type { ToolDefinition } from './tool-contract.js';

export type WebSearchProvider =
  | 'duckduckgo'
  | 'tavily'
  | 'exa'
  | 'serper'
  | 'searxng'
  | 'bocha'
  | 'zhipu'
  | 'google'
  | 'bing'
  | 'baidu'
  | 'sogou'
  | 'startpage';

export interface WebSearchConfig {
  provider: WebSearchProvider;
  apiKey?: string;
  baseUrl?: string;
  maxResults?: number;
  timeout?: number;
}

/**
 * 各提供商「宿主环境变量 → API Key」的单一事实源（按优先级排列）。
 *
 * 密钥从设计上就不该由模型提供：`apiKey` 虽然形状上在 `web_search` 的入参里，
 * 但模型既读不到宿主的 `process.env`，也不应被要求携带密钥。旧提示词让模型写
 * `apiKey: process.env.BING_API_KEY`，模型只能省略该字段，于是每次调用都以
 * `Bing API key is required` 结束（2026-10-12 线上排障命中）。网关据此表在
 * 模型未提供密钥时补齐，报错文案也据此给出可操作指引。
 */
export const WEB_SEARCH_PROVIDER_API_KEY_ENV: Record<WebSearchProvider, readonly string[]> = {
  duckduckgo: [],
  tavily: ['TAVILY_API_KEY'],
  exa: ['EXA_API_KEY'],
  serper: ['SERPER_API_KEY'],
  searxng: [],
  bocha: ['BOCHA_API_KEY', 'BOCHA_API_TOKEN'],
  zhipu: ['ZHIPU_API_KEY', 'GLM_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_CSE_API_KEY'],
  bing: ['BING_API_KEY', 'BING_SEARCH_API_KEY'],
  baidu: [],
  sogou: [],
  startpage: [],
};

/**
 * 非密钥类必填配置对应的环境变量（SearXNG 实例地址、Google 可编程搜索的
 * 引擎 ID / cx）。与 {@link WEB_SEARCH_PROVIDER_API_KEY_ENV} 同理，属宿主配置。
 */
export const WEB_SEARCH_PROVIDER_BASE_URL_ENV: Record<WebSearchProvider, readonly string[]> = {
  duckduckgo: [],
  tavily: [],
  exa: [],
  serper: [],
  searxng: ['SEARXNG_BASE_URL'],
  bocha: [],
  zhipu: [],
  google: ['GOOGLE_CSE_ID', 'GOOGLE_CSE_CX'],
  bing: [],
  baidu: [],
  sogou: [],
  startpage: [],
};

/**
 * 取某个提供商的 API Key；缺失时抛出**可操作**的错误。
 *
 * 文案刻意区别于旧的裸英文 `X API key is required`：这条消息会直接进入模型的
 * tool_result，必须交代「密钥属于宿主配置、不在模型入参里」，否则模型会反复
 * 重试同一个必然失败的调用。
 */
function requireApiKey(provider: WebSearchProvider, config: WebSearchConfig): string {
  const key = config.apiKey?.trim();
  if (key) return key;
  const envNames = WEB_SEARCH_PROVIDER_API_KEY_ENV[provider];
  const envHint = envNames.length > 0 ? `（如 ${envNames.join(' / ')}）` : '';
  throw new Error(
    `${provider} 搜索需要 API Key，该密钥属于宿主 / 用户配置，无法由模型的入参提供。` +
      `请通过环境变量${envHint}或用户设置 websearch_policy 为该提供商配置密钥，` +
      `或改用无需密钥的 duckduckgo。`,
  );
}

/** 取某个提供商必填的非密钥配置；缺失时抛出可操作的错误。 */
function requireBaseUrl(
  provider: WebSearchProvider,
  config: WebSearchConfig,
  what: string,
): string {
  const baseUrl = config.baseUrl?.trim();
  if (baseUrl) return baseUrl;
  const envNames = WEB_SEARCH_PROVIDER_BASE_URL_ENV[provider];
  const envHint = envNames.length > 0 ? `（如 ${envNames.join(' / ')}）` : '';
  throw new Error(
    `${provider} 搜索需要${what}，该配置属于宿主 / 用户配置。` +
      `请通过环境变量${envHint}或用户设置 websearch_policy 补齐。`,
  );
}

/**
 * 由宿主（网关）注册的「免密钥引擎」执行器。
 *
 * `baidu` / `sogou` / `startpage` 没有公开搜索 API，只能走 HTML 抓取，实现依赖
 * `open-websearch` 包 —— 该依赖在网关侧而非 agent-core，因此这里只定义插槽，
 * 由宿主在模块加载时调用 {@link registerWebSearchProvider} 注入。
 *
 * `bing` 是特例：官方 API 需要 Key，但同一引擎另有免密钥抓取实现，故
 * `bingSearch` 在未配置 Key 时会回退到这里注册的 `bing` 执行器；有 Key 时
 * 行为不变，仍走官方 API。
 */
export type WebSearchProviderExecutor = (
  query: string,
  config: WebSearchConfig,
  signal: AbortSignal,
) => Promise<string>;

const externalProviderExecutors = new Map<WebSearchProvider, WebSearchProviderExecutor>();

export function registerWebSearchProvider(
  provider: WebSearchProvider,
  executor: WebSearchProviderExecutor,
): void {
  externalProviderExecutors.set(provider, executor);
}

function requireExternalExecutor(provider: WebSearchProvider): WebSearchProviderExecutor {
  const executor = externalProviderExecutors.get(provider);
  if (executor) return executor;
  throw new Error(
    `${provider} 搜索需要免密钥引擎实现，但当前宿主尚未注册。` +
      `请改用 duckduckgo，或在网关侧调用 registerWebSearchProvider('${provider}', ...) 注册引擎。`,
  );
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
  const apiKey = requireApiKey('tavily', config);
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
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
  const apiKey = requireApiKey('exa', config);
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
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
  const apiKey = requireApiKey('serper', config);
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-API-KEY': apiKey,
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
  const baseUrl = requireBaseUrl('searxng', config, '实例地址（baseUrl）');
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
  const apiKey = requireApiKey('bocha', config);
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://api.bochaai.com/v1/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
  const apiKey = requireApiKey('zhipu', config);
  const maxResults = config.maxResults ?? 5;
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/tools/web-search', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
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
  const apiKey = requireApiKey('google', config);
  // `cx`（可编程搜索引擎 ID）缺失时旧实现会静默发一个空 cx，换回 Google 的
  // 400 —— 对模型完全不可解释。这里提前给出宿主配置指引。
  const cx = requireBaseUrl('google', config, '可编程搜索引擎 ID（cx）');
  const maxResults = config.maxResults ?? 5;
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', cx);
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
  // 未配置 Azure Key 时先回退到宿主注册的免密钥抓取引擎（open-websearch 的
  // bing 实现），而不是直接抛「需要 API Key」把这条免密钥检索路径整条掐掉。
  // 有 Key 时行为不变，仍走官方 API。
  if (!config.apiKey?.trim()) {
    const keyless = externalProviderExecutors.get('bing');
    if (keyless) return keyless(query, config, signal);
  }
  const apiKey = requireApiKey('bing', config);
  const maxResults = config.maxResults ?? 5;
  const url = new URL('https://api.bing.microsoft.com/v7.0/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const res = await fetch(url.toString(), {
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
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
    case 'baidu':
    case 'sogou':
    case 'startpage':
      return requireExternalExecutor(config.provider)(query, config, signal);
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
        'baidu',
        'sogou',
        'startpage',
      ])
      .optional()
      .describe(
        '网页搜索提供商（默认 duckduckgo；baidu / sogou / startpage 由网关注册的免密钥引擎提供，bing 无 Key 时自动回退到免密钥抓取）',
      ),
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
