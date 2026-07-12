declare module 'open-websearch/build/runtime/createRuntime.js' {
  export type OpenWebSearchEngine =
    | 'baidu'
    | 'bing'
    | 'brave'
    | 'csdn'
    | 'duckduckgo'
    | 'exa'
    | 'juejin'
    | 'linuxdo'
    | 'sogou'
    | 'startpage';

  export interface OpenWebSearchResult {
    readonly description: string;
    readonly engine: string;
    readonly source: string;
    readonly title: string;
    readonly url: string;
  }

  export interface OpenWebSearchRuntime {
    readonly services: {
      readonly fetchGithubReadme: {
        execute(input: { readonly url: string }): Promise<string | null>;
      };
      readonly fetchWeb: {
        execute(input: {
          readonly includeLinks?: boolean;
          readonly maxChars: number;
          readonly readability?: boolean;
          readonly url: string;
        }): Promise<unknown>;
      };
      readonly search: {
        execute(input: {
          readonly engines: readonly OpenWebSearchEngine[];
          readonly limit: number;
          readonly query: string;
          readonly searchMode: 'request';
        }): Promise<{
          readonly engines: readonly string[];
          readonly partialFailures: readonly {
            readonly code: 'engine_error' | 'unsupported_engine';
            readonly engine: string;
            readonly message: string;
          }[];
          readonly query: string;
          readonly results: readonly OpenWebSearchResult[];
          readonly totalResults: number;
        }>;
      };
    };
  }

  export function createOpenWebSearchRuntime(): OpenWebSearchRuntime;
}
