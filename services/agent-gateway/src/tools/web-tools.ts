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

function createAbortSignal(
  timeoutSeconds: number,
  signal?: AbortSignal,
): {
  cleanup: () => void;
  signal: AbortSignal;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('webfetch timeout exceeded')),
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
 * 首次请求**不显式设置 User-Agent**（保持运行时默认，与改动前行为一致）；
 * 仅重试时改用 `WEBFETCH_CLOUDFLARE_RETRY_USER_AGENT`。
 * 重试复用同一个 `AbortSignal`，因此仍受整体超时约束，最多只重试一次；
 * 重试仍失败时把末尾响应交回调用方，由既有 `!response.ok` 分支按原样抛错。
 */
async function fetchWithCloudflareChallengeRetry(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  const response = await fetch(url, { signal });

  if (!isCloudflareChallenge(response)) {
    return response;
  }

  // 释放首次挑战响应体，再换 UA 重试一次。
  await response.body?.cancel().catch(() => undefined);

  return fetch(url, {
    signal,
    headers: { 'user-agent': WEBFETCH_CLOUDFLARE_RETRY_USER_AGENT },
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
      'Fetch content from a specific URL in markdown, text, html, or image-preview format. Use open_websearch for discovery by default, fall back to websearch when open_websearch is unavailable, and use webfetch for a concrete URL. If the user asks to fetch, find, show, or display an existing web image, use open_websearch/websearch plus webfetch and return the existing image URL; do not use generate_image unless the user explicitly asks to create/draw/design a new image.',
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
        const response = await fetchWithCloudflareChallengeRetry(normalizedUrl, requestSignal);
        const contentType = response.headers.get('content-type') ?? 'text/plain';

        if (!response.ok) {
          // Drop the (unused) error body so the socket is released promptly.
          await response.body?.cancel().catch(() => undefined);
          throw new Error(`webfetch request failed with status ${response.status}`);
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
