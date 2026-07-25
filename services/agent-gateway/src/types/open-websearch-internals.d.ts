declare module 'open-websearch/build/core/search/searchService.js' {
  import type {
    OpenWebSearchEngine,
    OpenWebSearchResult,
  } from 'open-websearch/build/runtime/createRuntime.js';

  export interface OpenWebSearchSearchFailure {
    readonly code: 'engine_error' | 'unsupported_engine';
    readonly engine: string;
    readonly message: string;
  }

  export interface OpenWebSearchSearchService {
    execute(input: {
      readonly engines: readonly OpenWebSearchEngine[];
      readonly limit: number;
      readonly query: string;
      readonly searchMode?: 'request' | 'auto' | 'playwright';
    }): Promise<{
      readonly engines: readonly string[];
      readonly partialFailures: readonly OpenWebSearchSearchFailure[];
      readonly query: string;
      readonly results: readonly OpenWebSearchResult[];
      readonly totalResults: number;
    }>;
  }

  export function createSearchService(
    engineMap: Partial<
      Record<
        OpenWebSearchEngine,
        (
          query: string,
          limit: number,
          context?: { readonly searchMode?: 'request' | 'playwright' },
        ) => Promise<readonly OpenWebSearchResult[]>
      >
    >,
  ): OpenWebSearchSearchService;
}

declare module 'open-websearch/build/engines/baidu/baidu.js' {
  import type { OpenWebSearchResult } from 'open-websearch/build/runtime/createRuntime.js';

  export function searchBaidu(
    query: string,
    limit: number,
    context?: { readonly searchMode?: 'request' | 'playwright' },
  ): Promise<readonly OpenWebSearchResult[]>;
}

declare module 'open-websearch/build/engines/bing/bing.js' {
  import type { OpenWebSearchResult } from 'open-websearch/build/runtime/createRuntime.js';

  export function searchBing(
    query: string,
    limit: number,
    context?: { readonly searchMode?: 'request' | 'playwright' },
  ): Promise<readonly OpenWebSearchResult[]>;
}

declare module 'open-websearch/build/engines/duckduckgo/index.js' {
  import type { OpenWebSearchResult } from 'open-websearch/build/runtime/createRuntime.js';

  export function searchDuckDuckGo(
    query: string,
    limit: number,
    context?: { readonly searchMode?: 'request' | 'playwright' },
  ): Promise<readonly OpenWebSearchResult[]>;
}

declare module 'open-websearch/build/engines/sogou/index.js' {
  import type { OpenWebSearchResult } from 'open-websearch/build/runtime/createRuntime.js';

  export function searchSogou(
    query: string,
    limit: number,
    context?: { readonly searchMode?: 'request' | 'playwright' },
  ): Promise<readonly OpenWebSearchResult[]>;
}

declare module 'open-websearch/build/engines/startpage/index.js' {
  import type { OpenWebSearchResult } from 'open-websearch/build/runtime/createRuntime.js';

  export function searchStartpage(
    query: string,
    limit: number,
    context?: { readonly searchMode?: 'request' | 'playwright' },
  ): Promise<readonly OpenWebSearchResult[]>;
}

declare module 'open-websearch/build/engines/github/index.js' {
  export function fetchGithubReadme(url: string): Promise<string | null>;
}

declare module 'open-websearch/build/utils/httpRequest.js' {
  export interface OpenWebSearchAxiosResponse {
    readonly data: unknown;
    readonly headers: Record<string, string | readonly string[] | undefined>;
    readonly request?: {
      readonly res?: {
        responseUrl?: string;
      };
    };
    readonly status: number;
  }

  export function buildAxiosRequestOptions(options?: {
    readonly allowInsecureTls?: boolean;
    readonly decompress?: boolean;
    readonly headers?: Record<string, string>;
    readonly maxBodyLength?: number;
    readonly maxContentLength?: number;
    readonly maxRedirects?: number;
    readonly responseType?: 'text';
    readonly timeout?: number;
    readonly trustedStaticHost?: boolean;
    readonly validateStatus?: (status: number) => boolean;
  }): Record<string, unknown>;

  export function requestWithSafeRedirects(
    method: string,
    initialUrl: string,
    options?: Record<string, unknown>,
    urlLabel?: string,
  ): Promise<OpenWebSearchAxiosResponse>;
}
