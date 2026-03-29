import type { ToolDefinition } from '@openAwork/agent-core';
import TurndownService from 'turndown';
import { z } from 'zod';

const MAX_WEBFETCH_TIMEOUT_SECONDS = 120;

const webfetchInputSchema = z.object({
  url: z.string().url(),
  format: z.enum(['markdown', 'text', 'html']).default('markdown'),
  timeout: z.number().int().min(1).max(MAX_WEBFETCH_TIMEOUT_SECONDS).default(20),
});

const webfetchOutputSchema = z.object({
  url: z.string(),
  format: z.enum(['markdown', 'text', 'html']),
  status: z.number().int(),
  contentType: z.string(),
  content: z.string(),
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

  if (!isHtml) {
    return input.body;
  }

  const turndown = new TurndownService();
  return turndown.turndown(input.body).trim();
}

export const webfetchTool: ToolDefinition<typeof webfetchInputSchema, typeof webfetchOutputSchema> =
  {
    name: 'webfetch',
    description:
      'Fetch content from a specific URL in markdown, text, or html format. Use websearch for discovery and webfetch for a concrete URL.',
    inputSchema: webfetchInputSchema,
    outputSchema: webfetchOutputSchema,
    timeout: MAX_WEBFETCH_TIMEOUT_SECONDS * 1000,
    execute: async (input, signal) => {
      const normalizedUrl = normalizeWebfetchUrl(input.url);
      const { signal: requestSignal, cleanup } = createAbortSignal(input.timeout, signal);

      try {
        const response = await fetch(normalizedUrl, { signal: requestSignal });
        const body = await response.text();
        const contentType = response.headers.get('content-type') ?? 'text/plain';

        if (!response.ok) {
          throw new Error(`webfetch request failed with status ${response.status}`);
        }

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
