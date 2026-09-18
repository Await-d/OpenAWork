import {
  buildAxiosRequestOptions,
  requestWithSafeRedirects,
} from 'open-websearch/build/utils/httpRequest.js';
import {
  extractDocumentLinks,
  extractReadableContent,
  extractTitle,
  looksLikeHtml,
  normalizeText,
  readHeaderValue,
  selectDocumentContentHtml,
} from './open-websearch-html.js';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024;
const CONTENT_HEADERS = {
  Accept:
    'text/markdown,text/plain,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
} as const;

export interface OpenWebSearchFetchWebInput {
  readonly includeLinks?: boolean;
  readonly maxChars: number;
  readonly readability?: boolean;
  readonly url: string;
}

export interface OpenWebSearchFetchWebLink {
  readonly href: string;
  readonly text: string;
}

export interface OpenWebSearchFetchWebResult {
  readonly content: string;
  readonly contentType: string;
  readonly finalUrl: string;
  readonly links?: readonly OpenWebSearchFetchWebLink[];
  /** 仅在请求显式传入 readability 时出现；true 表示正文来自 Mozilla Readability。 */
  readonly readabilityApplied?: boolean;
  readonly retrievalMethod: 'request';
  readonly title: string;
  readonly truncated: boolean;
  readonly url: string;
}

interface ReadabilityArticle {
  readonly text: string;
  readonly title: string;
}

export async function fetchOpenWebSearchPage(
  input: OpenWebSearchFetchWebInput,
): Promise<OpenWebSearchFetchWebResult> {
  const response = await requestWithSafeRedirects(
    'GET',
    input.url,
    buildAxiosRequestOptions({
      decompress: true,
      headers: CONTENT_HEADERS,
      maxBodyLength: MAX_DOWNLOAD_BYTES,
      maxContentLength: MAX_DOWNLOAD_BYTES,
      maxRedirects: 5,
      responseType: 'text',
      timeout: DEFAULT_TIMEOUT_MS,
    }),
    'Request URL',
  );

  const contentType = readHeaderValue(response.headers, 'content-type').toLowerCase();
  const finalUrl = response.request?.res?.responseUrl ?? input.url;
  const raw =
    typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
  let title = looksLikeHtml(contentType, raw) ? extractTitle(raw) : '';
  let content = extractReadableContent({
    contentType,
    finalUrl,
    raw,
  });
  let readabilityApplied = false;

  if (input.readability === true && looksLikeHtml(contentType, raw)) {
    const article = await extractReadabilityArticle({ finalUrl, raw });
    if (article) {
      readabilityApplied = true;
      title = article.title || title;
      content = article.text;
    }
  }

  const truncated = content.length > input.maxChars;

  return {
    url: input.url,
    finalUrl,
    contentType,
    title,
    retrievalMethod: 'request',
    truncated,
    content: truncated ? content.slice(0, input.maxChars) : content,
    ...(input.readability === true ? { readabilityApplied } : {}),
    ...(input.includeLinks === true
      ? { links: extractDocumentLinks(selectDocumentContentHtml(raw), finalUrl) }
      : {}),
  };
}

/**
 * 可读性解析属于尽力而为的增强：解析失败、正文为空或运行时模块不可加载
 * （sidecar 打包风险）都只降级到既有容器提取，绝不让 fetch_web 整体失败。
 */
async function extractReadabilityArticle(input: {
  readonly finalUrl: string;
  readonly raw: string;
}): Promise<ReadabilityArticle | null> {
  try {
    const [{ Readability }, { JSDOM }] = await Promise.all([
      import('@mozilla/readability'),
      import('jsdom'),
    ]);
    const dom = new JSDOM(input.raw, { url: input.finalUrl });
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) {
      logReadabilityFallback('解析器未返回文章内容');
      return null;
    }

    const text = normalizeText(article.textContent || dom.window.document.body.textContent || '');
    if (text.length === 0) {
      logReadabilityFallback('解析器返回的文章正文为空');
      return null;
    }

    return { text, title: article.title?.trim() ?? '' };
  } catch (error) {
    logReadabilityFallback('可读性解析失败，已回退到容器提取', error);
    return null;
  }
}

function logReadabilityFallback(message: string, error?: unknown): void {
  if (process.env.OPEN_WEBSEARCH_DEBUG !== '1') {
    return;
  }
  if (error === undefined) {
    console.warn(`[open-websearch/readability] ${message}`);
    return;
  }
  console.warn(`[open-websearch/readability] ${message}`, error);
}
