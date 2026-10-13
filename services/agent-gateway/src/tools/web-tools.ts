import type { ToolDefinition } from '@openAwork/agent-core';
import TurndownService from 'turndown';
import { z } from 'zod';
import { readResponseTextWithLimit, resolveHttpBodyLimitBytes } from '../infra/http-body-limit.js';

const MAX_WEBFETCH_TIMEOUT_SECONDS = 120;

/**
 * Hard ceiling on the response body `webfetch` will buffer into memory.
 *
 * `webfetch` targets an arbitrary user/agent-supplied URL; `response.text()`
 * buffers the WHOLE body before any downstream truncation. The wall-clock
 * timeout does not bound memory — a fast server can stream gigabytes within the
 * deadline — so a large response would OOM the gateway. The shared
 * `readResponseTextWithLimit` enforces a hard byte ceiling. Override via
 * `OPENAWORK_WEBFETCH_MAX_RESPONSE_BYTES`; <=0 disables the guard.
 */
const DEFAULT_WEBFETCH_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

function resolveWebfetchMaxResponseBytes(): number {
  return resolveHttpBodyLimitBytes(
    'OPENAWORK_WEBFETCH_MAX_RESPONSE_BYTES',
    DEFAULT_WEBFETCH_MAX_RESPONSE_BYTES,
  );
}

/**
 * Cloudflare 挑战重试时使用的 User-Agent。
 *
 * 首次请求**不显式设置** User-Agent（保持运行时默认，零行为变更）；
 * 仅当命中 Cloudflare 挑战（403 + `cf-mitigated: challenge`）时，改用这个
 * 与默认不同的 UA 重试一次（对齐 opencode v2.0.12 的「换 UA 重试」语义）。
 */
const WEBFETCH_CLOUDFLARE_RETRY_USER_AGENT = 'OpenAWork-webfetch';

/**
 * 非 2xx 时回灌给模型的响应头。
 *
 * 只取「能直接决定下一步动作」的头：GitHub 限流看 `x-ratelimit-*`，
 * 429/503 看 `retry-after`，Cloudflare 挑战看 `cf-mitigated`。
 * 丢弃这些信息等于让模型在「重试 / 换 UA / 等限流恢复」之间纯猜。
 */
const WEBFETCH_DIAGNOSTIC_HEADERS = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'cf-mitigated',
] as const;

/** 错误正文回灌上限：够看清 GitHub 的 `message` / Reddit 的拦截说明，又不至于撑爆上下文。 */
const WEBFETCH_ERROR_BODY_MAX_CHARS = 512;

function isAllowedWebfetchUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const webfetchUrlSchema = z
  .string()
  .url()
  .refine(isAllowedWebfetchUrl, 'webfetch only supports http(s) URLs');

/**
 * 必须是 `ZodObject`，不能挂 `.superRefine()` / `.transform()`。
 *
 * zod v3 下这些方法会把 schema 变成 `ZodEffects`，而
 * `v2-runtime/upstream/tool-adapter.ts::zodToJsonSchema` 只认 `ZodObject`
 * 等具体 typeName，命中 `ZodEffects` 会落到 `default: { type: 'string' }`，
 * 发给模型的工具 schema 直接退化成字符串 —— 模型将看不到任何参数名。
 * 改本 schema 前先确认 `zodTypeName(inputSchema) === 'ZodObject'`。
 */
const webfetchInputSchema = z.object({
  url: webfetchUrlSchema,
  format: z.enum(['markdown', 'text', 'html', 'image-preview']).default('markdown'),
  timeout: z.number().int().min(1).max(MAX_WEBFETCH_TIMEOUT_SECONDS).default(20),
});

const webfetchOutputSchema = z.object({
  url: webfetchUrlSchema,
  format: z.enum(['markdown', 'text', 'html', 'image-preview']),
  status: z.number().int(),
  contentType: z.string(),
  content: z.string(),
  mediaKind: z.literal('image').optional(),
  imageUrl: webfetchUrlSchema.optional(),
});

function normalizeWebfetchUrl(url: string): string {
  if (url.startsWith('http://')) {
    return `https://${url.slice('http://'.length)}`;
  }

  return url;
}

/** 命中这些主机且配置了 token 时，自动注入 GitHub 认证头。 */
const WEBFETCH_GITHUB_API_HOSTS = new Set(['api.github.com']);

function resolveGitHubToken(): string | undefined {
  const raw = globalThis.process?.env?.['GITHUB_TOKEN'] ?? globalThis.process?.env?.['GH_TOKEN'];
  const trimmed = raw?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 组装自动注入的请求头。
 *
 * 未认证的 `api.github.com` 只有 60 次/小时，批量查仓库必然撞 403 限流，
 * 因此配置了 `GITHUB_TOKEN` 时自动补认证头——否则模型只能看到无信息量的 403。
 * 空结果表示「不设置任何请求头」，调用方据此保持运行时默认 UA。
 */
function buildWebfetchRequestHeaders(url: string): Record<string, string> {
  const host = new URL(url).host.toLowerCase();
  const token = WEBFETCH_GITHUB_API_HOSTS.has(host) ? resolveGitHubToken() : undefined;
  if (!token) {
    return {};
  }
  return {
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };
}

/**
 * 非 2xx 的错误文案：状态码 + 可行动响应头 + 正文片段。
 *
 * 过去直接丢弃 body 只留状态码，模型因此无法区分「仓库不存在」、
 * 「raw.githubusercontent 文件名大小写写错」和「触发 API 限流」，
 * 只能对同一个错误 URL 反复重试。
 */
async function buildWebfetchFailureMessage(response: Response): Promise<string> {
  const statusText = response.statusText ? ` ${response.statusText}` : '';
  const lines = [`webfetch request failed with status ${response.status}${statusText}`];

  const headerHints = WEBFETCH_DIAGNOSTIC_HEADERS.map(
    (name) => [name, response.headers.get(name)] as [string, string | null],
  ).filter((entry): entry is [string, string] => entry[1] !== null);
  if (headerHints.length > 0) {
    lines.push(`响应头：${headerHints.map(([name, value]) => `${name}=${value}`).join(' | ')}`);
  }

  let bodySnippet: string;
  try {
    const raw = await readResponseTextWithLimit(response, WEBFETCH_ERROR_BODY_MAX_CHARS);
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const cleaned = contentType.includes('text/html') ? htmlToText(raw) : raw.trim();
    bodySnippet = cleaned.length > 0 ? cleaned : '<空正文>';
  } catch (error) {
    // 诊断信息读失败不能盖掉原始 HTTP 错误，把读取失败原因并入文案即可。
    bodySnippet = `<响应正文读取失败：${error instanceof Error ? error.message : String(error)}>`;
  }
  lines.push(`响应正文：${bodySnippet}`);

  if (response.status === 403 || response.status === 429) {
    lines.push(
      '排查建议：403/429 通常是限流或 UA 拦截 —— GitHub API 可设置 GITHUB_TOKEN 环境变量，或在 headers 中传浏览器 user-agent 后重试；若响应头 x-ratelimit-remaining=0，请等待限流恢复再试。',
    );
  } else if (response.status === 404) {
    lines.push(
      '排查建议：404 通常是路径写错 —— raw.githubusercontent.com 的文件名大小写敏感（如 README.md 而非 readme.md），仓库也可能已改名或不存在。',
    );
  }
  return lines.join('\n');
}

/**
 * 超时中断的标记文本。fetch 会把 `abort(reason)` 的 reason 原样作为 rejection
 * 抛出，靠它区分「本工具超时」与「用户取消」（父级 signal 的取消必须原样
 * 透传，不能被翻译成超时，否则会破坏沙箱的取消语义）。
 */
const WEBFETCH_TIMEOUT_MARKER = 'webfetch timeout exceeded';

/**
 * 把 fetch 抛出的底层网络错误翻译成可操作的中文文案。
 *
 * 排障包里裸奔的 `getaddrinfo ENOTFOUND raw.githubusercontent.com` 与
 * `webfetch timeout exceeded` 对模型和用户都没有信息量：前者分不清是本地
 * DNS 还是目标站点问题，后者不知道阈值与应对方式。
 */
function describeWebfetchNetworkError(input: {
  error: unknown;
  url: string;
  timeoutSeconds: number;
  parentSignal?: AbortSignal;
}): Error {
  const { error, url, timeoutSeconds, parentSignal } = input;
  const raw = error instanceof Error ? error : new Error(String(error));
  // 用户取消：原样透传，绝不改写成超时。
  if (parentSignal?.aborted) {
    return raw;
  }
  const rawMessage = raw.message;
  const errno = (raw as { code?: unknown }).code;
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();

  const isTimeout =
    rawMessage.includes(WEBFETCH_TIMEOUT_MARKER) ||
    (parentSignal?.aborted !== true &&
      (errno === 'ABORT_ERR' || raw.name === 'AbortError' || errno === 'UND_ERR_ABORTED'));
  if (isTimeout) {
    return new Error(
      `webfetch 超时（${timeoutSeconds}s）：${host} 在时限内未完成响应。` +
        '境外站点在部分网络下不可直连，可改用可达的镜像源后重试。',
    );
  }

  switch (errno) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new Error(
        `webfetch 失败：无法解析域名 ${host}（DNS 解析失败）。` +
          '通常是本机 DNS 解析不了该域名（境外站点被污染或网络不可用），可改用可达的镜像域名后重试。',
      );
    case 'ECONNREFUSED':
      return new Error(`webfetch 失败：${host} 拒绝连接，目标服务可能未启动或端口不正确。`);
    case 'ECONNRESET':
    case 'EPIPE':
      return new Error(
        `webfetch 失败：与 ${host} 的连接被重置，常见于网络不稳定或被中间设备拦截，可稍后重试。`,
      );
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return new Error(`webfetch 失败：连接 ${host} 超时，可改用镜像源或稍后重试。`);
    default:
      break;
  }
  if (/CERT|SSL|TLS/i.test(String(errno)) || /certificate|self-signed/i.test(rawMessage)) {
    return new Error(`webfetch 失败：${host} 的 TLS 证书校验未通过（${rawMessage}）。`);
  }
  return new Error(`webfetch 失败：${rawMessage}（${host}）`);
}

function createAbortSignal(
  timeoutSeconds: number,
  signal?: AbortSignal,
): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(WEBFETCH_TIMEOUT_MARKER)),
    timeoutSeconds * 1000,
  );
  const abortFromParent = () => controller.abort(signal?.reason);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', abortFromParent);
      }
    },
  };
}

/**
 * Cloudflare 挑战判定：仅当 HTTP 403 且响应头附带 `cf-mitigated: challenge`。
 * 其它 403（普通拒绝）不满足条件，保持原有错误路径不变。
 */
function isCloudflareChallenge(response: Response): boolean {
  return response.status === 403 && response.headers.get('cf-mitigated') === 'challenge';
}

/**
 * 发起 webfetch 请求并在命中 Cloudflare 挑战时换一个 User-Agent 重试一次。
 *
 * 首次请求**不主动设置 User-Agent**（保持运行时默认，与改动前行为一致）；
 * 仅重试且调用方未显式指定 UA 时改用 `WEBFETCH_CLOUDFLARE_RETRY_USER_AGENT`。
 * 重试复用同一个 `AbortSignal`，因此仍受整体超时约束，最多只重试一次；
 * 重试仍失败时把末尾响应交回调用方，由既有 `!response.ok` 分支按原样抛错。
 */
async function fetchWithCloudflareChallengeRetry(
  url: string,
  signal: AbortSignal,
  requestHeaders: Record<string, string>,
): Promise<Response> {
  const hasCustomHeaders = Object.keys(requestHeaders).length > 0;
  const response = await fetch(
    url,
    hasCustomHeaders ? { signal, headers: requestHeaders } : { signal },
  );

  if (!isCloudflareChallenge(response)) {
    return response;
  }

  // 释放首次挑战响应体，再换 UA 重试一次。
  await response.body?.cancel().catch(() => undefined);

  return fetch(url, {
    signal,
    headers: {
      ...requestHeaders,
      'user-agent': requestHeaders['user-agent'] ?? WEBFETCH_CLOUDFLARE_RETRY_USER_AGENT,
    },
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/giu, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function formatFetchedContent(input: {
  body: string;
  contentType: string;
  format: z.infer<typeof webfetchInputSchema>['format'];
}): string {
  const normalizedContentType = input.contentType.toLowerCase();
  const isHtml =
    normalizedContentType.includes('text/html') ||
    normalizedContentType.includes('application/xhtml+xml');

  if (input.format === 'html') {
    return input.body;
  }

  if (input.format === 'text') {
    return isHtml ? htmlToText(input.body) : input.body;
  }

  if (input.format === 'image-preview') {
    return input.body;
  }

  if (!isHtml) {
    return input.body;
  }

  const turndown = new TurndownService();
  return turndown.turndown(input.body).trim();
}

function isImageContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(';', 1)[0]?.trim().startsWith('image/') === true;
}

export const webfetchTool: ToolDefinition<typeof webfetchInputSchema, typeof webfetchOutputSchema> =
  {
    name: 'webfetch',
    description:
      'Fetch content from a specific URL in markdown, text, html, or image-preview format. Use websearch for discovery — it is the only web-search entry — and use webfetch (or open_websearch/fetch_web) for a concrete URL; open_websearch/fetch_github_readme reads a GitHub repository README. If the user asks to fetch, find, show, or display an existing web image, use websearch plus webfetch and return the existing image URL; do not use generate_image unless the user explicitly asks to create/draw/design a new image. On 403/429 do not retry the same URL blindly: the error message carries the rate-limit headers and the response body needed to tell限流、UA 拦截与路径写错 apart.',
    inputSchema: webfetchInputSchema,
    outputSchema: webfetchOutputSchema,
    timeout: MAX_WEBFETCH_TIMEOUT_SECONDS * 1000,
    execute: async (input, signal) => {
      const normalizedUrl = normalizeWebfetchUrl(input.url);
      if (!isAllowedWebfetchUrl(normalizedUrl)) {
        throw new Error('webfetch only supports http(s) URLs');
      }
      const { signal: requestSignal, cleanup } = createAbortSignal(input.timeout, signal);

      try {
        const requestHeaders = buildWebfetchRequestHeaders(normalizedUrl);
        let response: Response;
        try {
          response = await fetchWithCloudflareChallengeRetry(
            normalizedUrl,
            requestSignal,
            requestHeaders,
          );
        } catch (error) {
          // DNS / 超时 / 连接失败等底层错误在这里归因；HTTP 非 2xx 走下方
          // 专属文案，不被本包装覆盖。
          throw describeWebfetchNetworkError({
            error,
            url: normalizedUrl,
            timeoutSeconds: input.timeout,
            parentSignal: signal,
          });
        }
        const contentType = response.headers.get('content-type') ?? 'text/plain';

        if (!response.ok) {
          // 不丢弃错误正文：状态码 + 诊断响应头 + 正文片段是模型判断
          // 「限流 / UA 拦截 / 路径写错」的唯一依据。
          throw new Error(await buildWebfetchFailureMessage(response));
        }

        if (isImageContentType(contentType)) {
          await response.body?.cancel().catch(() => undefined);
          return {
            url: normalizedUrl,
            format: input.format,
            status: response.status,
            contentType,
            mediaKind: 'image',
            imageUrl: normalizedUrl,
            content: `![Fetched image](${normalizedUrl})`,
          };
        }

        if (input.format === 'image-preview') {
          await response.body?.cancel().catch(() => undefined);
          throw new Error('webfetch image-preview requires an image response');
        }

        // Size-capped read: never buffer an unbounded body into memory.
        const body = await readResponseTextWithLimit(response, resolveWebfetchMaxResponseBytes());

        return {
          url: normalizedUrl,
          format: input.format,
          status: response.status,
          contentType,
          content: formatFetchedContent({
            body,
            contentType,
            format: input.format,
          }),
        };
      } finally {
        cleanup();
      }
    },
  };
