import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { MCPToolDef, MCPToolResult } from '@openAwork/mcp-client';
import type { OpenWebSearchRuntime } from 'open-websearch/build/runtime/createRuntime.js';
import type { MCPCallInput } from './mcp-runtime.js';

const OPEN_WEBSEARCH_ENGINES = ['bing', 'duckduckgo', 'baidu', 'sogou', 'startpage'] as const;

const DEFAULT_OPEN_WEBSEARCH_ENGINES = ['bing', 'duckduckgo'] as const;
const PUBLIC_HTTP_URL_MESSAGE = '只支持公开 HTTP(S) 网页 URL。';
const GITHUB_REPOSITORY_URL_MESSAGE = '只支持公开 GitHub 仓库 URL。';

const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(20).default(8),
  engines: z
    .array(z.enum(OPEN_WEBSEARCH_ENGINES))
    .min(1)
    .max(4)
    .default([...DEFAULT_OPEN_WEBSEARCH_ENGINES]),
});

const publicHttpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine(isPublicHttpUrl, PUBLIC_HTTP_URL_MESSAGE);

const githubRepositoryUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_000)
  .refine(isPublicGithubRepositoryUrl, GITHUB_REPOSITORY_URL_MESSAGE);

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

let cachedRuntimePromise: Promise<OpenWebSearchRuntime> | undefined;

async function getRuntime(): Promise<OpenWebSearchRuntime> {
  if (!cachedRuntimePromise) {
    cachedRuntimePromise = loadRuntime();
  }
  try {
    return await cachedRuntimePromise;
  } catch (error) {
    cachedRuntimePromise = undefined;
    throw error;
  }
}

async function loadRuntime(): Promise<OpenWebSearchRuntime> {
  const { createOpenWebSearchRuntime } =
    await import('open-websearch/build/runtime/createRuntime.js');
  return createOpenWebSearchRuntime();
}

export async function callOpenWebSearchVirtualMcp(
  _sessionId: string,
  input: MCPCallInput,
): Promise<MCPToolResult> {
  switch (input.toolName) {
    case 'search':
      return executeSearch(await getRuntime(), input.arguments ?? {});
    case 'fetch_web':
      return executeFetchWeb(await getRuntime(), input.arguments ?? {});
    case 'fetch_github_readme':
      return executeFetchGithubReadme(await getRuntime(), input.arguments ?? {});
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
      return executeSearch(runtime, input.arguments ?? {});
    case 'fetch_web':
      return executeFetchWeb(runtime, input.arguments ?? {});
    case 'fetch_github_readme':
      return executeFetchGithubReadme(runtime, input.arguments ?? {});
    default:
      return errorResult(`未知的 Open WebSearch 工具：${input.toolName}`);
  }
}

async function executeSearch(
  runtime: OpenWebSearchRuntime,
  rawInput: Record<string, unknown>,
): Promise<MCPToolResult> {
  const parsed = searchInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '搜索参数无效。');

  try {
    const result = await runtime.services.search.execute({
      ...parsed.data,
      engines: parsed.data.engines,
      searchMode: 'request',
    });
    return jsonResult(result);
  } catch (error) {
    return errorResult(`网络搜索失败：${readErrorMessage(error)}`);
  }
}

async function executeFetchWeb(
  runtime: OpenWebSearchRuntime,
  rawInput: Record<string, unknown>,
): Promise<MCPToolResult> {
  const parsed = fetchWebInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '网页提取参数无效。');

  try {
    const urlError = await readPublicUrlError(parsed.data.url, PUBLIC_HTTP_URL_MESSAGE);
    if (urlError) {
      return errorResult(urlError);
    }
    return jsonResult(await runtime.services.fetchWeb.execute(parsed.data));
  } catch (error) {
    return errorResult(`网页提取失败：${readErrorMessage(error)}`);
  }
}

async function executeFetchGithubReadme(
  runtime: OpenWebSearchRuntime,
  rawInput: Record<string, unknown>,
): Promise<MCPToolResult> {
  const parsed = fetchGithubReadmeInputSchema.safeParse(rawInput);
  if (!parsed.success) return errorResult(parsed.error.issues[0]?.message ?? '仓库地址无效。');

  try {
    const urlError = await readPublicUrlError(parsed.data.url, GITHUB_REPOSITORY_URL_MESSAGE);
    if (urlError) {
      return errorResult(urlError);
    }
    const content = await runtime.services.fetchGithubReadme.execute(parsed.data);
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

function isPublicHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url) return false;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return !isLocalOrPrivateHost(url.hostname);
}

function isPublicGithubRepositoryUrl(value: string): boolean {
  const url = parseUrl(value);
  if (!url || !isPublicHttpUrl(value)) return false;
  const hostname = normalizeHostname(url.hostname);
  if (hostname !== 'github.com' && hostname !== 'www.github.com') return false;
  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  return segments.length === 2;
}

async function readPublicUrlError(value: string, message: string): Promise<string | null> {
  const url = parseUrl(value);
  if (!url || !isPublicHttpUrl(value)) {
    return message;
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname || isIP(hostname) !== 0) {
    return null;
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      return message;
    }
    return addresses.some((entry) => isLocalOrPrivateHost(entry.address)) ? message : null;
  } catch {
    return message;
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.+$/u, '')
    .toLowerCase();
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    normalizedHostname === 'localhost' ||
    normalizedHostname.endsWith('.localhost') ||
    normalizedHostname === '0.0.0.0' ||
    normalizedHostname === '::' ||
    normalizedHostname === '::1'
  ) {
    return true;
  }

  const ipVersion = isIP(normalizedHostname);
  if (ipVersion === 4) return isPrivateIpv4(normalizedHostname);
  if (ipVersion === 6) return isPrivateIpv6(normalizedHostname);
  return false;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((segment) => Number(segment));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [first, second] = parts;
  if (first === undefined || second === undefined) return false;

  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}
