import type {
  OpenWebSearchEngine,
  OpenWebSearchResult,
} from 'open-websearch/build/runtime/createRuntime.js';

export interface OpenWebSearchSearchFailure {
  readonly code: 'engine_error' | 'unsupported_engine';
  readonly engine: string;
  readonly message: string;
}

export interface OpenWebSearchSearchResponse {
  readonly engines: readonly string[];
  readonly partialFailures: readonly OpenWebSearchSearchFailure[];
  readonly query: string;
  readonly results: readonly OpenWebSearchResult[];
  readonly totalResults: number;
}

export interface OpenWebSearchSearchService {
  execute(input: {
    readonly engines: readonly OpenWebSearchEngine[];
    readonly limit: number;
    readonly query: string;
    readonly searchMode: 'request';
  }): Promise<OpenWebSearchSearchResponse>;
}

export interface OpenWebSearchGithubReadmeService {
  execute(input: { readonly url: string }): Promise<string | null>;
}

interface PromiseCache<T> {
  current: Promise<T> | undefined;
}

const searchServiceCache: PromiseCache<OpenWebSearchSearchService> = {
  current: undefined,
};

const githubReadmeServiceCache: PromiseCache<OpenWebSearchGithubReadmeService> = {
  current: undefined,
};

export async function loadOpenWebSearchSearchService(): Promise<OpenWebSearchSearchService> {
  return readCachedService(searchServiceCache, createOpenWebSearchSearchService);
}

export async function loadOpenWebSearchGithubReadmeService(): Promise<OpenWebSearchGithubReadmeService> {
  return readCachedService(githubReadmeServiceCache, createOpenWebSearchGithubReadmeService);
}

async function readCachedService<T>(
  cache: PromiseCache<T>,
  createService: () => Promise<T>,
): Promise<T> {
  if (!cache.current) {
    cache.current = createService();
  }

  try {
    return await cache.current;
  } catch (error) {
    cache.current = undefined;
    throw error;
  }
}

async function createOpenWebSearchSearchService(): Promise<OpenWebSearchSearchService> {
  const [
    { createSearchService },
    { searchBaidu },
    { searchBing },
    { searchDuckDuckGo },
    { searchSogou },
    { searchStartpage },
  ] = await Promise.all([
    import('open-websearch/build/core/search/searchService.js'),
    import('open-websearch/build/engines/baidu/baidu.js'),
    import('open-websearch/build/engines/bing/bing.js'),
    import('open-websearch/build/engines/duckduckgo/index.js'),
    import('open-websearch/build/engines/sogou/index.js'),
    import('open-websearch/build/engines/startpage/index.js'),
  ]);

  return createSearchService({
    baidu: searchBaidu,
    bing: searchBing,
    duckduckgo: searchDuckDuckGo,
    sogou: searchSogou,
    startpage: searchStartpage,
  });
}

async function createOpenWebSearchGithubReadmeService(): Promise<OpenWebSearchGithubReadmeService> {
  const { fetchGithubReadme } = await import('open-websearch/build/engines/github/index.js');

  return {
    execute: async ({ url }) => fetchGithubReadme(url),
  };
}
