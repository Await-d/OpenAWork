import { z } from 'zod';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { OpenWebSearchRuntime } from 'open-websearch/build/runtime/createRuntime.js';
import { fetchOpenWebSearchPage } from './open-websearch-fetch-web.js';
import {
  loadOpenWebSearchGithubReadmeService,
  loadOpenWebSearchSearchService,
  type OpenWebSearchGithubReadmeService,
  type OpenWebSearchSearchService,
} from './open-websearch-services.js';
import {
  GITHUB_REPOSITORY_URL_MESSAGE,
  PUBLIC_HTTP_URL_MESSAGE,
  githubRepositoryUrlSchema,
  publicHttpUrlSchema,
  readPublicUrlError,
} from './open-websearch-url.js';
import type { MCPCallInput } from './mcp-runtime.js';

const OPEN_WEBSEARCH_ENGINES = ['bing', 'duckduckgo', 'baidu', 'sogou', 'startpage'] as const;

const DEFAULT_OPEN_WEBSEARCH_ENGINES = ['bing', 'duckduckgo'] as const;

const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(8),
  engines: z
    .array(z.enum(OPEN_WEBSEARCH_ENGINES))
    .min(1)
    .max(4)
    .default([...DEFAULT_OPEN_WEBSEARCH_ENGINES]),
});

const fetchWebInputSchema = z.object({
  url: publicHttpUrlSchema,
  maxChars: z.number().int().min(1_000).max(100_000).default(30_000),
  readability: z.boolean().optional(),
  includeLinks: z.boolean().optional(),
});

const fetchGithubReadmeInputSchema = z.object({
  url: githubRepositoryUrlSchema,
});

export const OPEN_WEBSEARCH_VIRTUAL_MCP_TOOLS = [
  {
    name: 'search',
    description: '使用内置免 API Key 的多引擎网络搜索。默认并行检索 Bing 与 DuckDuckGo。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要搜索的关键词。' },
        limit: { type: 'integer', minimum: 1, maximum: 20, description: '总结果数上限。' },
        engines: {
          type: 'array',
          items: { type: 'string', enum: [...OPEN_WEBSEARCH_ENGINES] },
          minItems: 1,
          maxItems: 4,
          description: '可选搜索引擎列表。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_web',
    description: '提取公开网页的可读正文。目标必须是可公开访问的 HTTP(S) URL。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', format: 'uri', description: '要提取的网页 URL。' },
        maxChars: { type: 'integer', minimum: 1_000, maximum: 100_000 },
        readability: { type: 'boolean', description: '是否使用正文可读性提取。' },
        includeLinks: { type: 'boolean', description: '是否保留正文中的链接。' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_github_readme',
    description: '读取公开 GitHub 仓库的 README。',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'GitHub 仓库 URL。' },
      },
      required: ['url'],
      additionalProperties: false,
    },
  },
] satisfies readonly MCPToolDef[];

export async function callOpenWebSearchVirtualMcp(
  _sessionId: string,
  input: MCPCallInput,
): Promise<MCPToolResult> {
  switch (input.toolName) {
    case 'search':
      return executeSearch(await loadOpenWebSearchSearchService(), input.arguments ?? {});
    case 'fetch_web':
      return executeFetchWeb(input.arguments ?? {});
    case 'fetch_github_readme':
      return executeFetchGithubReadme(
        await loadOpenWebSearchGithubReadmeService(),
        input.arguments ?? {},
      );
    default:
      return errorResult(`未知的 Open WebSearch 工具：${input.toolName}`);
  }
}

export async function executeOpenWebSearchTool(
  runtime: OpenWebSearchRuntime,
  input: MCPCallInput,
): Promise<MCPToolResult> {
  switch (input.toolName) {
    case 'search':
      return executeSearch(runtime.services.search, input.arguments ?? {});
    case 'fetch_web':
      return executeFetchWeb(input.arguments ?? {});
    case 'fetch_github_readme':
      return executeFetchGithubReadme(runtime.services.fetchGithubReadme, input.arguments ?? {});
    default:
      return errorResult(`未知的 Open WebSearch 工具：${input.toolName}`);
  }
}

async function executeSearch(
  searchService: OpenWebSearchSearchService,
  rawInput: Record<string, unknown>,
): Promise<MCPToolResult> {
  const parsed = searchInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '搜索参数无效。');

  try {
    const result = await searchService.execute({
      ...parsed.data,
      engines: parsed.data.engines,
      searchMode: 'request',
    });
    return jsonResult(result);
  } catch (error) {
    return errorResult(`网络搜索失败：${readErrorMessage(error)}`);
  }
}

async function executeFetchWeb(rawInput: Record<string, unknown>): Promise<MCPToolResult> {
  const parsed = fetchWebInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '网页提取参数无效。');

  try {
    const urlError = await readPublicUrlError(parsed.data.url, PUBLIC_HTTP_URL_MESSAGE);
    if (urlError) {
      return errorResult(urlError);
    }
    return jsonResult(await fetchOpenWebSearchPage(parsed.data));
  } catch (error) {
    return errorResult(`网页提取失败：${readErrorMessage(error)}`);
  }
}

async function executeFetchGithubReadme(
  githubReadmeService: OpenWebSearchGithubReadmeService,
  rawInput: Record<string, unknown>,
): Promise<MCPToolResult> {
  const parsed = fetchGithubReadmeInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '仓库地址无效。');

  try {
    const urlError = await readPublicUrlError(parsed.data.url, GITHUB_REPOSITORY_URL_MESSAGE);
    if (urlError) {
      return errorResult(urlError);
    }
    const content = await githubReadmeService.execute(parsed.data);
    return content === null ? errorResult('未找到该 GitHub 仓库的 README。') : textResult(content);
  } catch (error) {
    return errorResult(`README 提取失败：${readErrorMessage(error)}`);
  }
}

function jsonResult(value: unknown): MCPToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function textResult(text: string): MCPToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
