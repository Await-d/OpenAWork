import { z } from 'zod';
import type { ToolDefinition } from '../tool-contract.js';

type WebSearchProvider =
  | 'duckduckgo'
  | 'tavily'
  | 'exa'
  | 'serper'
  | 'searxng'
  | 'bocha'
  | 'zhipu'
  | 'google'
  | 'bing';

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

export const webSearchTool: ToolDefinition = {
  name: 'web_search',
  description:
    'Search the web for current information. Use when user needs real-time data, news, or facts.',
  inputSchema: z.object({
    query: z.string().describe('Search query'),
    maxResults: z.number().int().min(1).max(20).default(5).describe('Max results (default 5)'),
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
      .describe('Web search provider (default duckduckgo)'),
    apiKey: z.string().optional().describe('Provider API key (if required)'),
    baseUrl: z.string().optional().describe('Provider base URL or engine id (provider-specific)'),
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
